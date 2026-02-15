"""
Site Calculations - Common Module

Pure functions for computing site-level calculations from device readings
using register_role. Used by both device service (for logging) and control
service (for algorithm).
"""

from collections import defaultdict

from common.logging_setup import get_service_logger

logger = get_service_logger("common.site_calc")


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


def compute_site_calculations(
    readings: dict[str, dict],
    device_configs: list[dict],
    site_calculations: list[dict],
) -> dict[str, dict]:
    """
    Compute site-level calculations using register_role.

    Args:
        readings: {device_id: {register_name: {value: X, ...}}}
        device_configs: List of device config dicts (with registers containing register_role)
        site_calculations: List of site calculation definitions:
            [{"field_id": str, "name": str, "register_role": str, "type": str, "unit": str}]

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
