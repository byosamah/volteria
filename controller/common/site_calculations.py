"""
Site Calculations - Common Module

Pure functions for computing site-level calculations from device readings
using register_role. Used by both device service (for logging) and control
service (for algorithm).
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from common.logging_setup import get_service_logger

logger = get_service_logger("common.site_calc")


# =============================================================================
# DeltaTracker — module-level singleton for energy counter tracking
# =============================================================================

class DeltaTracker:
    """
    Tracks kWh counter deltas per field per device over time windows.
    Emits COMPLETED window totals (not running totals).

    On window transition, computes the old window's total and holds it
    stable for the entire next window. This ensures cloud downsampling
    (which picks the first reading per bucket) always captures the
    correct total.

    State: {field_id: {device_id: {"window_key": str, "first": float, "latest": float}}}
    Completed: {field_id: {device_id: float}}  — last completed window's total

    Window keys:
      - hour: "2026-02-15T14" (ISO date + hour)
      - day:  "2026-02-15"   (ISO date)
    """

    def __init__(self):
        self._state: dict[str, dict[str, dict]] = {}
        self._completed: dict[str, dict[str, float]] = {}

    def get_delta(
        self,
        field_id: str,
        device_id: str,
        value: float,
        window_key: str,
    ) -> float:
        """
        Track a counter reading and return the completed window's total.

        Returns 0 until the first window completes. After that, returns
        the total from the most recently completed window (stable value).
        """
        if field_id not in self._state:
            self._state[field_id] = {}

        device_state = self._state[field_id].get(device_id)

        if device_state is None or device_state["window_key"] != window_key:
            # Window transition — compute completed total from old window
            if device_state is not None:
                completed = device_state["latest"] - device_state["first"]
                self._completed.setdefault(field_id, {})[device_id] = max(0.0, completed)
                # Carry old latest as new first — consecutive windows are
                # perfectly contiguous, no energy falls between the cracks.
                new_first = device_state["latest"]
            else:
                new_first = value  # first window ever, no carry-over

            # Start new window
            self._state[field_id][device_id] = {
                "window_key": window_key,
                "first": new_first,
                "latest": value,
            }
        else:
            # Same window — update latest
            device_state["latest"] = value

        # Return COMPLETED window's total (not running total)
        return self._completed.get(field_id, {}).get(device_id, 0.0)

    def reset(self):
        """Clear all tracked state."""
        self._state.clear()
        self._completed.clear()


# Module-level singleton
_delta_tracker = DeltaTracker()


def _get_window_key(time_window: str, project_timezone: str) -> str:
    """
    Get the current window key based on time_window type and project timezone.

    Returns:
      - hour: "2026-02-15T14"
      - day:  "2026-02-15"
    """
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(project_timezone)
    except Exception:
        tz = timezone.utc

    # Look 3 seconds ahead so the window transition fires BEFORE the hour
    # boundary.  This ensures readings.json has the new completed total by
    # :00:00, avoiding the race with the logging service's first sample.
    # Precision loss: ~3s of a 3600s window = 0.08% — negligible.
    now = datetime.now(tz) + timedelta(seconds=3)

    if time_window == "hour":
        return now.strftime("%Y-%m-%dT%H")
    elif time_window == "day":
        return now.strftime("%Y-%m-%d")
    else:
        # Fallback: treat as day
        return now.strftime("%Y-%m-%d")


def build_role_index(device_configs: list[dict]) -> dict[str, list[tuple[str, str]]]:
    """
    Build index: {register_role: [(device_id, register_name), ...]}

    Scans all register types (logging, visualization, alarm) for register_role.
    """
    role_index: dict[str, list[tuple[str, str]]] = defaultdict(list)

    for device in device_configs:
        device_id = device.get("id")
        if not device_id:
            continue

        # Skip virtual devices (their registers ARE the computed outputs)
        if device.get("device_type") == "site_controller":
            continue

        # Check all register collections
        for reg_key in ("registers", "visualization_registers", "alarm_registers"):
            for reg in device.get(reg_key, []):
                role = reg.get("register_role")
                if role and role != "none":
                    role_index[role].append((device_id, reg.get("name", "")))

    return dict(role_index)


def compute_role_sum(
    readings: dict[str, dict],
    role_index: dict[str, list[tuple[str, str]]],
    register_role: str,
) -> float | None:
    """Sum all register values matching a register_role."""
    matches = role_index.get(register_role, [])
    if not matches:
        return None

    total = 0.0
    found_any = False

    for device_id, register_name in matches:
        device_readings = readings.get(device_id, {})
        value = _get_register_value(device_readings, register_name)
        if value is not None:
            total += value
            found_any = True

    return round(total, 2) if found_any else None


def compute_role_delta(
    readings: dict[str, dict],
    role_index: dict[str, list[tuple[str, str]]],
    register_role: str,
    field_id: str,
    time_window: str,
    project_timezone: str,
) -> float | None:
    """
    Compute delta (latest - first) for each device's kWh counter in the
    current time window, then sum across all devices.

    Returns None if no matching devices have readings.
    """
    matches = role_index.get(register_role, [])
    if not matches:
        return None

    window_key = _get_window_key(time_window, project_timezone)
    total = 0.0
    found_any = False

    for device_id, register_name in matches:
        device_readings = readings.get(device_id, {})
        value = _get_register_value(device_readings, register_name)
        if value is not None:
            delta = _delta_tracker.get_delta(field_id, device_id, value, window_key)
            total += delta
            found_any = True

    return round(total, 2) if found_any else None


def compute_site_calculations(
    readings: dict[str, dict],
    device_configs: list[dict],
    site_calculations: list[dict],
    project_timezone: str = "UTC",
) -> dict[str, dict]:
    """
    Compute site-level calculations using register_role.

    Args:
        readings: {device_id: {register_name: {value: X, ...}}}
        device_configs: List of device config dicts (with registers containing register_role)
        site_calculations: List of site calculation definitions:
            [{"field_id": str, "name": str, "register_role": str, "type": str,
              "unit": str, "time_window": str (for delta)}]
        project_timezone: IANA timezone string (e.g. "Asia/Dubai")

    Returns:
        {field_id: {"value": float, "name": str, "unit": str}}
    """
    if not site_calculations:
        return {}

    role_index = build_role_index(device_configs)

    results = {}
    for calc_def in site_calculations:
        field_id = calc_def.get("field_id", "")
        calc_type = calc_def.get("type", "sum")

        try:
            if calc_type == "sum":
                value = compute_role_sum(
                    readings, role_index, calc_def.get("register_role", "")
                )
            elif calc_type == "delta":
                value = compute_role_delta(
                    readings,
                    role_index,
                    calc_def.get("register_role", ""),
                    field_id,
                    calc_def.get("time_window", "hour"),
                    project_timezone,
                )
            else:
                logger.debug(f"Calc type '{calc_type}' not yet implemented for {field_id}")
                continue

            if value is not None:
                results[field_id] = {
                    "value": value,
                    "name": calc_def.get("name", field_id),
                    "unit": calc_def.get("unit", ""),
                }
        except Exception as e:
            logger.warning(f"Error computing site calc {field_id}: {e}")

    return results


def _get_register_value(device_readings: dict, register_name: str) -> float | None:
    """Extract register value from device readings."""
    if register_name not in device_readings:
        return None

    reading = device_readings[register_name]

    if isinstance(reading, dict):
        return reading.get("value")
    elif isinstance(reading, (int, float)):
        return float(reading)

    return None
