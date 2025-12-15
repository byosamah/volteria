"""
Calculated Fields Manager

Computes calculated field values from device readings.
Handles aggregations, differences, and cumulative calculations.

Calculation Types:
- sum: Sum of values (Total Solar, Total Load)
- difference: A - B (DG Power = Load - Solar)
- cumulative: Rolling sum over time (Daily Energy)
- average: Average of values
- max: Maximum value
- min: Minimum value
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional, Callable
from collections import deque

logger = logging.getLogger(__name__)


@dataclass
class CalculatedFieldConfig:
    """Configuration for a calculated field."""
    field_id: str               # e.g., "total_solar_kw"
    name: str                   # e.g., "Total Solar Power"
    scope: str                  # "controller" or "device"
    calculation_type: str       # "sum", "difference", "cumulative", etc.
    calculation_config: dict    # Type-specific configuration
    device_types: list[str]     # For filtering devices
    unit: str
    time_window: Optional[str]  # For cumulative: "hour", "day", "month"


@dataclass
class CalculatedValue:
    """A computed calculated field value."""
    field_id: str
    value: float
    unit: str
    timestamp: datetime
    device_name: Optional[str] = None  # For device-scope fields


class CalculatedFieldsManager:
    """
    Manages calculation of derived values from device readings.

    Features:
    - Load field configurations from database
    - Compute controller-level aggregations
    - Track cumulative values with time windows
    - Provide values for logging and alarms
    """

    def __init__(self):
        """Initialize the calculated fields manager."""
        # Field configurations keyed by field_id
        self._configs: dict[str, CalculatedFieldConfig] = {}

        # Storage for cumulative calculations (field_id -> deque of (timestamp, value))
        self._cumulative_data: dict[str, deque] = {}

        # Last computed values
        self._values: dict[str, CalculatedValue] = {}

        # Time window mappings
        self._time_windows = {
            "hour": timedelta(hours=1),
            "day": timedelta(days=1),
            "week": timedelta(weeks=1),
            "month": timedelta(days=30),  # Approximate
            "year": timedelta(days=365),
        }

        logger.info("Calculated fields manager initialized")

    def load_field_configs(self, configs: list[dict]):
        """
        Load calculated field configurations.

        Args:
            configs: List of field configuration dictionaries
        """
        for cfg in configs:
            try:
                field_config = CalculatedFieldConfig(
                    field_id=cfg["field_id"],
                    name=cfg["name"],
                    scope=cfg.get("scope", "controller"),
                    calculation_type=cfg["calculation_type"],
                    calculation_config=cfg.get("calculation_config", {}),
                    device_types=cfg.get("device_types", []),
                    unit=cfg.get("unit", ""),
                    time_window=cfg.get("time_window")
                )

                self._configs[field_config.field_id] = field_config

                # Initialize cumulative storage if needed
                if field_config.calculation_type == "cumulative":
                    self._cumulative_data[field_config.field_id] = deque(maxlen=10000)

                logger.debug(f"Loaded field config: {field_config.field_id}")

            except (KeyError, TypeError) as e:
                logger.warning(f"Invalid field config: {e}")

        logger.info(f"Loaded {len(self._configs)} calculated field configs")

    def compute(
        self,
        field_id: str,
        device_values: dict[str, float],
        device_name: Optional[str] = None
    ) -> Optional[CalculatedValue]:
        """
        Compute a calculated field value.

        Args:
            field_id: The field to compute
            device_values: Dictionary of device_name -> value
            device_name: For device-scope fields

        Returns:
            CalculatedValue or None if computation fails
        """
        config = self._configs.get(field_id)
        if not config:
            logger.warning(f"Unknown field: {field_id}")
            return None

        calc_type = config.calculation_type
        calc_config = config.calculation_config
        now = datetime.now()

        # Filter values by device type if specified
        values = list(device_values.values())
        if config.device_types and len(config.device_types) > 0:
            # In real implementation, we'd filter by device type
            # For now, use all values
            pass

        try:
            if calc_type == "sum":
                result = sum(values) if values else 0.0

            elif calc_type == "difference":
                # Expects calculation_config with "minuend" and "subtrahend" field references
                minuend = calc_config.get("minuend", 0.0)
                subtrahend = calc_config.get("subtrahend", 0.0)

                # If strings, look up in device_values
                if isinstance(minuend, str) and minuend in device_values:
                    minuend = device_values[minuend]
                if isinstance(subtrahend, str) and subtrahend in device_values:
                    subtrahend = device_values[subtrahend]

                result = float(minuend) - float(subtrahend)

            elif calc_type == "cumulative":
                # Add current sum to cumulative tracker
                current_sum = sum(values) if values else 0.0
                cumulative_data = self._cumulative_data.get(field_id, deque(maxlen=10000))
                cumulative_data.append((now, current_sum))
                self._cumulative_data[field_id] = cumulative_data

                # Calculate sum within time window
                window = self._time_windows.get(config.time_window or "day", timedelta(days=1))
                cutoff = now - window

                result = sum(
                    val for ts, val in cumulative_data
                    if ts >= cutoff
                )

            elif calc_type == "average":
                result = sum(values) / len(values) if values else 0.0

            elif calc_type == "max":
                result = max(values) if values else 0.0

            elif calc_type == "min":
                result = min(values) if values else 0.0

            else:
                logger.warning(f"Unknown calculation type: {calc_type}")
                return None

            # Create and store result
            calc_value = CalculatedValue(
                field_id=field_id,
                value=result,
                unit=config.unit,
                timestamp=now,
                device_name=device_name
            )

            self._values[field_id] = calc_value
            return calc_value

        except Exception as e:
            logger.error(f"Error computing {field_id}: {e}")
            return None

    def compute_all(
        self,
        device_values: dict[str, float],
        scope: str = "controller"
    ) -> list[CalculatedValue]:
        """
        Compute all configured fields for a scope.

        Args:
            device_values: Dictionary of device_name -> value
            scope: "controller" or "device"

        Returns:
            List of computed CalculatedValues
        """
        results = []

        for field_id, config in self._configs.items():
            if config.scope == scope:
                result = self.compute(field_id, device_values)
                if result:
                    results.append(result)

        return results

    def get_value(self, field_id: str) -> Optional[float]:
        """
        Get the last computed value for a field.

        Args:
            field_id: The field to get

        Returns:
            The value or None
        """
        calc_value = self._values.get(field_id)
        return calc_value.value if calc_value else None

    def get_all_values(self) -> dict[str, float]:
        """
        Get all computed values as a dictionary.

        Returns:
            Dictionary of field_id -> value
        """
        return {
            field_id: calc.value
            for field_id, calc in self._values.items()
        }

    def reset_cumulative(self, field_id: Optional[str] = None):
        """
        Reset cumulative calculations.

        Args:
            field_id: Specific field to reset, or None for all
        """
        if field_id:
            if field_id in self._cumulative_data:
                self._cumulative_data[field_id].clear()
                logger.info(f"Reset cumulative data for: {field_id}")
        else:
            for data in self._cumulative_data.values():
                data.clear()
            logger.info("Reset all cumulative data")

    def get_status(self) -> dict:
        """
        Get manager status for monitoring.

        Returns:
            Dictionary with status information
        """
        return {
            "configs_loaded": len(self._configs),
            "values_computed": len(self._values),
            "cumulative_fields": len(self._cumulative_data),
            "field_ids": list(self._configs.keys()),
            "last_values": {
                field_id: {
                    "value": calc.value,
                    "unit": calc.unit,
                    "timestamp": calc.timestamp.isoformat()
                }
                for field_id, calc in self._values.items()
            }
        }


# Pre-defined system calculated fields
DEFAULT_CALCULATED_FIELDS = [
    {
        "field_id": "total_solar_kw",
        "name": "Total Solar Power",
        "scope": "controller",
        "calculation_type": "sum",
        "device_types": ["inverter"],
        "unit": "kW",
        "time_window": None,
        "calculation_config": {}
    },
    {
        "field_id": "total_load_kw",
        "name": "Total Load",
        "scope": "controller",
        "calculation_type": "sum",
        "device_types": ["load_meter"],
        "unit": "kW",
        "time_window": None,
        "calculation_config": {}
    },
    {
        "field_id": "total_dg_kw",
        "name": "Total DG Power",
        "scope": "controller",
        "calculation_type": "sum",
        "device_types": ["dg"],
        "unit": "kW",
        "time_window": None,
        "calculation_config": {}
    },
    {
        "field_id": "implied_dg_kw",
        "name": "Implied DG Power",
        "scope": "controller",
        "calculation_type": "difference",
        "device_types": [],
        "unit": "kW",
        "time_window": None,
        "calculation_config": {
            "minuend": "total_load_kw",
            "subtrahend": "total_solar_kw"
        }
    },
    {
        "field_id": "daily_solar_kwh",
        "name": "Daily Solar Energy",
        "scope": "controller",
        "calculation_type": "cumulative",
        "device_types": ["inverter"],
        "unit": "kWh",
        "time_window": "day",
        "calculation_config": {}
    },
    {
        "field_id": "daily_load_kwh",
        "name": "Daily Load Energy",
        "scope": "controller",
        "calculation_type": "cumulative",
        "device_types": ["load_meter"],
        "unit": "kWh",
        "time_window": "day",
        "calculation_config": {}
    }
]
