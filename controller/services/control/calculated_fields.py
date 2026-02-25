"""
Calculated Fields

Computes derived metrics from device readings:
- Site-level calculations using register_role (Total Load, Total DG, Total Solar)
- Legacy totals (backward compat for control algorithm)
- Custom field definitions (sum, difference, cumulative, average, max, min)
"""

from datetime import datetime, timezone
from typing import Any

from common.config import CalculatedField, DeviceType
from common.logging_setup import get_service_logger
from common.site_calculations import (
    build_role_index,
    compute_role_sum,
    compute_site_calculations as _compute_site_calculations_common,
)

logger = get_service_logger("control.calc_fields")

# Device type sets for control totals — must match all DB/frontend device types
SOLAR_TYPES = {"inverter", "wind_turbine", "bess"}
LOAD_TYPES = {"load_meter", "load", "energy_meter", "subload"}
DG_TYPES = {"dg", "diesel_generator", "diesel_generator_controller"}
GG_TYPES = {"gas_generator_controller", "gas_generator"}
GENERATOR_TYPES = DG_TYPES | GG_TYPES  # Union of both


class CalculatedFieldsProcessor:
    """
    Computes calculated fields from device readings.

    Two modes:
    1. Site calculations (register_role-based): compute_site_calculations()
    2. Legacy field definitions: compute_all() / compute_standard_totals()

    Supports calc types: sum, difference, cumulative, average, max, min, delta (Phase 2)
    """

    def __init__(self):
        # Energy accumulators for cumulative fields
        self._energy_accumulators: dict[str, float] = {}
        self._last_power_readings: dict[str, tuple[datetime, float]] = {}
        # Delta window start values for energy calculations (Phase 2)
        # {field_id: {device_id: first_reading_value}}
        self._window_start_values: dict[str, dict[str, float]] = {}
        # Role index cache (rebuilt on config change)
        self._role_index: dict[str, list[tuple[str, str]]] | None = None
        self._role_index_config_hash: str | None = None

    # =========================================================================
    # Site Calculations (register_role-based)
    # =========================================================================

    def compute_site_calculations(
        self,
        readings: dict[str, dict],
        device_configs: list[dict],
        site_calculations: list[dict],
        project_timezone: str = "UTC",
    ) -> dict[str, dict]:
        """Delegate to common.site_calculations module."""
        return _compute_site_calculations_common(
            readings, device_configs, site_calculations,
            project_timezone=project_timezone,
        )

    # =========================================================================
    # Legacy field definitions
    # =========================================================================

    def compute_all(
        self,
        readings: dict[str, dict],
        device_types: dict[str, str],
        field_definitions: list[CalculatedField],
    ) -> dict[str, float]:
        """
        Compute all calculated fields.

        Args:
            readings: Dict mapping device_id to register readings
            device_types: Dict mapping device_id to device_type
            field_definitions: List of calculated field definitions

        Returns:
            Dict mapping field_id to computed value
        """
        results = {}

        for field_def in field_definitions:
            try:
                value = self._compute_field(
                    field_def=field_def,
                    readings=readings,
                    device_types=device_types,
                )
                if value is not None:
                    results[field_def.field_id] = value
            except Exception as e:
                logger.warning(
                    f"Error computing {field_def.field_id}: {e}"
                )

        return results

    def compute_reactive_totals(
        self,
        readings: dict[str, dict],
        device_types: dict[str, str],
    ) -> dict[str, float]:
        """
        Compute site-level reactive power totals from load meters.

        Returns total_reactive_var, total_reactive_kvar, and site_power_factor.
        """
        import math

        total_reactive_var = 0.0
        total_active_w = 0.0
        found_reactive = False

        for device_id, device_readings in readings.items():
            device_type = device_types.get(device_id)
            if device_type not in LOAD_TYPES:
                continue

            for key in device_readings:
                key_lower = key.lower()
                # Match reactive power registers: "reactive power", "react power"
                if "reactive" in key_lower and "power" in key_lower and "factor" not in key_lower:
                    reading = device_readings[key]
                    value = reading.get("value") if isinstance(reading, dict) else reading
                    if value is not None:
                        total_reactive_var += float(value)
                        found_reactive = True
                    break

        # Get active power from load meters for PF calculation
        for device_id, device_readings in readings.items():
            device_type = device_types.get(device_id)
            if device_type not in LOAD_TYPES:
                continue

            for key in device_readings:
                key_lower = key.lower()
                if ("active" in key_lower and "power" in key_lower) or \
                   ("act" in key_lower and "power" in key_lower and "react" not in key_lower and "factor" not in key_lower):
                    reading = device_readings[key]
                    value = reading.get("value") if isinstance(reading, dict) else reading
                    if value is not None:
                        total_active_w += float(value)
                    break

        total_reactive_kvar = total_reactive_var / 1000.0
        # Site PF = P / sqrt(P² + Q²)
        s = math.sqrt(total_active_w ** 2 + total_reactive_var ** 2)
        site_pf = (total_active_w / s) if s > 0 else 1.0

        return {
            "total_reactive_var": round(total_reactive_var, 2),
            "total_reactive_kvar": round(total_reactive_kvar, 2),
            "site_power_factor": round(site_pf, 4),
        }

    def compute_standard_totals(
        self,
        readings: dict[str, dict],
        device_types: dict[str, str],
    ) -> dict[str, float]:
        """
        Compute standard totals (solar, load, generators) without field definitions.

        Returns separate DG, GG, and combined generator totals.
        This is a convenience method for the control loop.
        """
        results = {
            "total_solar_kw": 0.0,
            "total_load_kw": 0.0,
            "total_dg_kw": 0.0,
            "total_gg_kw": 0.0,
            "total_generator_kw": 0.0,
        }

        for device_id, device_readings in readings.items():
            device_type = device_types.get(device_id)

            # Look for active power reading (register names vary by template)
            power = None
            for key in device_readings:
                key_lower = key.lower()
                # Match: "active_power_kw", "Total Active Power", "Act power", etc.
                if ("active" in key_lower and "power" in key_lower) or \
                   ("act" in key_lower and "power" in key_lower and "react" not in key_lower and "factor" not in key_lower):
                    reading = device_readings[key]
                    if isinstance(reading, dict):
                        power = reading.get("value")
                    else:
                        power = reading
                    break

            if power is None:
                continue

            if device_type in SOLAR_TYPES:
                results["total_solar_kw"] += power
            elif device_type in LOAD_TYPES:
                results["total_load_kw"] += power
            elif device_type in DG_TYPES:
                results["total_dg_kw"] += power
                results["total_generator_kw"] += power
            elif device_type in GG_TYPES:
                results["total_gg_kw"] += power
                results["total_generator_kw"] += power

        # Round values
        for key in results:
            results[key] = round(results[key], 2)

        return results

    def _compute_field(
        self,
        field_def: CalculatedField,
        readings: dict[str, dict],
        device_types: dict[str, str],
    ) -> float | None:
        """Compute a single calculated field"""
        calc_type = field_def.calculation_type

        if calc_type == "sum":
            return self._compute_sum(field_def, readings, device_types)
        elif calc_type == "difference":
            return self._compute_difference(field_def, readings, device_types)
        elif calc_type == "cumulative":
            return self._compute_cumulative(field_def, readings, device_types)
        elif calc_type == "average":
            return self._compute_average(field_def, readings, device_types)
        elif calc_type == "max":
            return self._compute_max(field_def, readings, device_types)
        elif calc_type == "min":
            return self._compute_min(field_def, readings, device_types)
        else:
            logger.warning(f"Unknown calculation type: {calc_type}")
            return None

    def _compute_sum(
        self,
        field_def: CalculatedField,
        readings: dict[str, dict],
        device_types: dict[str, str],
    ) -> float:
        """Sum values from matching devices"""
        total = 0.0

        for device_id, device_readings in readings.items():
            device_type = device_types.get(device_id)

            if device_type not in field_def.source_devices:
                continue

            value = self._get_register_value(
                device_readings,
                field_def.source_register,
            )
            if value is not None:
                total += value

        return round(total, 2)

    def _compute_difference(
        self,
        field_def: CalculatedField,
        readings: dict[str, dict],
        device_types: dict[str, str],
    ) -> float:
        """Compute difference between device types"""
        # For difference, source_devices should have 2 types:
        # [minuend_type, subtrahend_type]
        if len(field_def.source_devices) != 2:
            return 0.0

        minuend_type, subtrahend_type = field_def.source_devices

        minuend = 0.0
        subtrahend = 0.0

        for device_id, device_readings in readings.items():
            device_type = device_types.get(device_id)

            value = self._get_register_value(
                device_readings,
                field_def.source_register,
            )
            if value is None:
                continue

            if device_type == minuend_type:
                minuend += value
            elif device_type == subtrahend_type:
                subtrahend += value

        return round(minuend - subtrahend, 2)

    def _compute_cumulative(
        self,
        field_def: CalculatedField,
        readings: dict[str, dict],
        device_types: dict[str, str],
    ) -> float:
        """Compute cumulative energy using trapezoidal integration"""
        now = datetime.now(timezone.utc)

        # Get current power
        current_power = self._compute_sum(field_def, readings, device_types)

        # Get previous reading
        prev_reading = self._last_power_readings.get(field_def.field_id)

        if prev_reading:
            prev_time, prev_power = prev_reading
            time_diff_hours = (now - prev_time).total_seconds() / 3600

            # Trapezoidal integration
            avg_power = (current_power + prev_power) / 2
            energy_kwh = avg_power * time_diff_hours

            # Add to accumulator
            self._energy_accumulators[field_def.field_id] = (
                self._energy_accumulators.get(field_def.field_id, 0.0) + energy_kwh
            )

        # Update last reading
        self._last_power_readings[field_def.field_id] = (now, current_power)

        return round(self._energy_accumulators.get(field_def.field_id, 0.0), 2)

    def _compute_average(
        self,
        field_def: CalculatedField,
        readings: dict[str, dict],
        device_types: dict[str, str],
    ) -> float | None:
        """Compute average across matching devices"""
        values = []

        for device_id, device_readings in readings.items():
            device_type = device_types.get(device_id)

            if device_type not in field_def.source_devices:
                continue

            value = self._get_register_value(
                device_readings,
                field_def.source_register,
            )
            if value is not None:
                values.append(value)

        if not values:
            return None

        return round(sum(values) / len(values), 2)

    def _compute_max(
        self,
        field_def: CalculatedField,
        readings: dict[str, dict],
        device_types: dict[str, str],
    ) -> float | None:
        """Compute maximum across matching devices"""
        values = []

        for device_id, device_readings in readings.items():
            device_type = device_types.get(device_id)

            if device_type not in field_def.source_devices:
                continue

            value = self._get_register_value(
                device_readings,
                field_def.source_register,
            )
            if value is not None:
                values.append(value)

        if not values:
            return None

        return max(values)

    def _compute_min(
        self,
        field_def: CalculatedField,
        readings: dict[str, dict],
        device_types: dict[str, str],
    ) -> float | None:
        """Compute minimum across matching devices"""
        values = []

        for device_id, device_readings in readings.items():
            device_type = device_types.get(device_id)

            if device_type not in field_def.source_devices:
                continue

            value = self._get_register_value(
                device_readings,
                field_def.source_register,
            )
            if value is not None:
                values.append(value)

        if not values:
            return None

        return min(values)

    def _get_register_value(
        self,
        device_readings: dict,
        register_name: str,
    ) -> float | None:
        """Extract register value from device readings"""
        if register_name not in device_readings:
            return None

        reading = device_readings[register_name]

        if isinstance(reading, dict):
            return reading.get("value")
        elif isinstance(reading, (int, float)):
            return float(reading)

        return None

    def reset_energy_accumulators(self) -> None:
        """Reset energy accumulators (e.g., at midnight)"""
        self._energy_accumulators.clear()
        self._last_power_readings.clear()
        logger.info("Energy accumulators reset")
