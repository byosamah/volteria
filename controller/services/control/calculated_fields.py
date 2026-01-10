"""
Calculated Fields

Computes derived metrics from device readings:
- Total Solar (sum of all inverters)
- Total Load (sum of all load meters)
- Total DG (sum of all generators)
- Implied DG (Load - Solar)
- Energy totals (cumulative)
"""

from datetime import datetime, timezone
from typing import Any

from common.config import CalculatedField, DeviceType
from common.logging_setup import get_service_logger

logger = get_service_logger("control.calc_fields")


class CalculatedFieldsProcessor:
    """
    Computes calculated fields from device readings.

    Supports:
    - sum: Sum values from multiple devices
    - difference: Difference between two sums
    - cumulative: Accumulated energy over time
    - average: Average across devices
    - max/min: Maximum/minimum across devices
    """

    def __init__(self):
        # Energy accumulators for cumulative fields
        self._energy_accumulators: dict[str, float] = {}
        self._last_power_readings: dict[str, tuple[datetime, float]] = {}

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

    def compute_standard_totals(
        self,
        readings: dict[str, dict],
        device_types: dict[str, str],
    ) -> dict[str, float]:
        """
        Compute standard totals (solar, load, DG) without field definitions.

        This is a convenience method for the control loop.
        """
        results = {
            "total_solar_kw": 0.0,
            "total_load_kw": 0.0,
            "total_dg_kw": 0.0,
        }

        for device_id, device_readings in readings.items():
            device_type = device_types.get(device_id)

            # Look for power reading
            power = None
            for key in ["active_power_kw", "total_power_kw", "power_kw"]:
                if key in device_readings:
                    reading = device_readings[key]
                    if isinstance(reading, dict):
                        power = reading.get("value")
                    else:
                        power = reading
                    break

            if power is None:
                continue

            if device_type == "inverter":
                results["total_solar_kw"] += power
            elif device_type == "load_meter":
                results["total_load_kw"] += power
            elif device_type == "dg":
                results["total_dg_kw"] += power

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
