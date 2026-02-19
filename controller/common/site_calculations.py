"""
Site Calculations - Common Module

Pure functions for computing site-level calculations from device readings
using register_role. Used by both device service (for logging) and control
service (for algorithm).
"""

import json
import math
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from common.logging_setup import get_service_logger
from common.state import SharedState

logger = get_service_logger("common.site_calc")


# =============================================================================
# DeltaTracker — module-level singleton for energy counter tracking
# =============================================================================

# Any decrease in counter value > this threshold = meter reset.
# Energy counters only go up; any real decrease means the meter was
# reset to zero. 1 kWh tolerance handles float32 rounding noise.
_COUNTER_RESET_THRESHOLD = 1.0  # kWh


class DeltaTracker:
    """
    Tracks kWh counter deltas per field per device over time windows.
    Emits COMPLETED window totals (not running totals).

    On window transition, computes the old window's total and holds it
    stable for the entire next window. This ensures cloud downsampling
    (which picks the first reading per bucket) always captures the
    correct total.

    Handles non-24/7 sites: state persists across overnight shutdowns
    (7-day staleness limit). As long as the controller ran at any point
    during a window, the delta for that period is captured.

    Handles meter resets: if the counter value drops (meter reset to 0),
    energy is split into segments — (pre-reset delta) + (post-reset delta).
    No energy is silently lost.

    State: {field_id: {device_id: {"window_key": str, "first": float,
            "latest": float, "accumulated": float}}}
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

        Handles meter resets: if counter value decreases, the energy
        before the reset is accumulated as a completed segment, and
        tracking continues from the post-reset value.
        """
        if field_id not in self._state:
            self._state[field_id] = {}

        device_state = self._state[field_id].get(device_id)

        if device_state is None or device_state["window_key"] != window_key:
            # Window transition — compute completed total from old window
            if device_state is not None:
                final_segment = max(0.0, device_state["latest"] - device_state["first"])
                completed = device_state.get("accumulated", 0.0) + final_segment
                self._completed.setdefault(field_id, {})[device_id] = completed
                # Carry old latest as new first — consecutive windows are
                # perfectly contiguous, no energy falls between the cracks.
                new_first = device_state["latest"]
                # If meter reset happened during the gap (value << old latest),
                # start fresh from post-reset value instead of stale carry-forward.
                if value < new_first - _COUNTER_RESET_THRESHOLD:
                    new_first = value
            else:
                new_first = value  # first window ever, no carry-over

            # Start new window
            self._state[field_id][device_id] = {
                "window_key": window_key,
                "first": new_first,
                "latest": value,
                "accumulated": 0.0,
            }
        else:
            # Same window — check for meter reset, then update latest
            if value < device_state["latest"] - _COUNTER_RESET_THRESHOLD:
                # Meter reset detected — counter went backwards.
                # Complete current segment and start a new one.
                segment = max(0.0, device_state["latest"] - device_state["first"])
                device_state["accumulated"] = device_state.get("accumulated", 0.0) + segment
                device_state["first"] = value  # new segment from post-reset value
                device_state["latest"] = value
                logger.info(
                    f"DeltaTracker: meter reset detected for {field_id}/{device_id[:8]}, "
                    f"segment={segment:.1f} kWh accumulated"
                )
            else:
                device_state["latest"] = value

        # Return COMPLETED window's total (not running total)
        return self._completed.get(field_id, {}).get(device_id, 0.0)

    def get_completed(self, field_id: str, device_id: str) -> float:
        """Return completed delta for a device without updating state."""
        return self._completed.get(field_id, {}).get(device_id, 0.0)

    def to_dict(self) -> dict:
        """Serialize state for persistence."""
        return {
            "state": self._state,
            "completed": self._completed,
            "saved_at": datetime.now(timezone.utc).isoformat(),
        }

    def restore(self, data: dict, max_age_seconds: int = 604800) -> bool:
        """
        Restore state from persisted dict.
        Returns True if restored, False if skipped (missing/stale data).
        max_age_seconds: 7 days default — counter values are absolute (don't
        go stale). Sites that don't run 24/7 need state preserved across
        overnight shutdowns. Reset detection handles meter replacements.
        """
        if not data or "state" not in data or "completed" not in data:
            return False

        saved_at = data.get("saved_at")
        if saved_at:
            try:
                save_time = datetime.fromisoformat(saved_at)
                age = (datetime.now(timezone.utc) - save_time).total_seconds()
                if age > max_age_seconds:
                    logger.info(f"DeltaTracker state too old ({age:.0f}s), starting fresh")
                    return False
            except (ValueError, TypeError):
                return False

        self._state = data["state"]
        self._completed = data["completed"]
        trackers = sum(len(v) for v in self._state.values())
        completed = sum(len(v) for v in self._completed.values())
        logger.info(f"DeltaTracker restored: {trackers} trackers, {completed} completed deltas")
        return True

    def reset(self):
        """Clear all tracked state."""
        self._state.clear()
        self._completed.clear()


# Module-level singleton
_delta_tracker = DeltaTracker()

# Persistence paths
_TMPFS_STATE_KEY = "delta_tracker"  # SharedState key (tmpfs, survives process restart)
_DISK_STATE_PATH = Path("/opt/volteria/data/delta_tracker_state.json")  # Survives reboot


def save_delta_state(to_disk: bool = False) -> None:
    """Save DeltaTracker state. Called periodically (tmpfs) and on shutdown (disk)."""
    data = _delta_tracker.to_dict()

    # Always save to tmpfs (fast, <1ms)
    SharedState.write(_TMPFS_STATE_KEY, data)

    if to_disk:
        try:
            _DISK_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = _DISK_STATE_PATH.with_suffix(".tmp")
            with open(tmp_path, "w") as f:
                json.dump(data, f)
                f.flush()
                if os.name != "nt":
                    os.fsync(f.fileno())
            tmp_path.replace(_DISK_STATE_PATH)
            logger.info("DeltaTracker state saved to disk")
        except Exception as e:
            logger.warning(f"Failed to save DeltaTracker state to disk: {e}")


def restore_delta_state() -> bool:
    """
    Restore DeltaTracker state on startup.
    Tries tmpfs first (process restart), then disk (reboot).
    """
    # Try tmpfs first (newer, survives process restart)
    data = SharedState.read(_TMPFS_STATE_KEY, use_cache=False)
    if data and _delta_tracker.restore(data):
        logger.info("DeltaTracker restored from tmpfs")
        return True

    # Try disk (survives reboot)
    if _DISK_STATE_PATH.exists():
        try:
            with open(_DISK_STATE_PATH, "r") as f:
                data = json.load(f)
            if _delta_tracker.restore(data):
                logger.info("DeltaTracker restored from disk")
                return True
        except (json.JSONDecodeError, IOError) as e:
            logger.warning(f"Failed to read DeltaTracker disk state: {e}")

    logger.info("DeltaTracker starting fresh (no valid saved state)")
    return False


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
            # Update tracker with fresh reading (triggers window transitions)
            _delta_tracker.get_delta(field_id, device_id, value, window_key)
        # Always include completed delta — even if device currently offline,
        # its last completed window total is valid and should be counted.
        completed = _delta_tracker.get_completed(field_id, device_id)
        if completed > 0:
            total += completed
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
        value = reading.get("value")
    elif isinstance(reading, (int, float)):
        value = float(reading)
    else:
        return None

    if value is not None and isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None

    return value
