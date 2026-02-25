"""
Control Algorithm - Pluggable Operation Modes

Modular control logic with pluggable operation modes.
New modes can be added by:
1. Create class extending OperationMode base class
2. Define mode_id, required_settings, required_device_types
3. Implement calculate() method
4. Register in OPERATION_MODES dictionary
"""

from abc import ABC, abstractmethod
from typing import Any

from common.logging_setup import get_service_logger
from .state import ControlOutput

logger = get_service_logger("control.algorithm")


class OperationMode(ABC):
    """Base class for all operation modes"""

    @property
    @abstractmethod
    def mode_id(self) -> str:
        """Unique identifier for this mode"""
        pass

    @property
    @abstractmethod
    def required_settings(self) -> list[str]:
        """Settings required for this mode (e.g., ['dg_reserve_kw'])"""
        pass

    @property
    @abstractmethod
    def required_device_types(self) -> list[str]:
        """Device types needed (e.g., ['load_meter', 'inverter'])"""
        pass

    @abstractmethod
    def calculate(self, readings: dict, config: dict) -> ControlOutput:
        """Execute control logic and return output"""
        pass


class ZeroGeneratorFeed(OperationMode):
    """
    Zero Generator Feed — prevent reverse power flow to generators (DG + GG).

    Off-grid mode: generators are the grid. Solar must never push power back.

    Load estimation fallback chain:
    1. Load meters (direct measurement, most accurate)
    2. Generator power (in off-grid, gen output ≈ load)
    3. Handled by control service (cached / safe mode)

    Algorithm:
    - estimated_load = best available source from fallback chain
    - headroom = estimated_load - generator_reserve
    - solar_limit = clamp(headroom, 0, solar_capacity)
    """

    mode_id = "zero_generator_feed"
    required_settings = ["dg_reserve_kw"]
    required_device_types = ["inverter"]  # + load_meter OR generator

    def calculate(self, readings: dict, config: dict) -> ControlOutput:
        # Get settings (top-level dg_reserve_kw is always correct)
        mode_settings = config.get("mode_settings", {})
        generator_reserve = config.get("dg_reserve_kw", mode_settings.get("dg_reserve_kw", 0))

        # Get readings
        total_load = readings.get("total_load_kw", 0.0)
        total_generator = readings.get("total_dg_kw", 0.0)
        solar_capacity = readings.get("solar_capacity_kw", 100.0)
        load_meters_online = readings.get("load_meters_online", 0)
        generators_online = readings.get("generators_online", 0)

        # Load estimation fallback chain
        estimated_load = 0.0
        load_source = "none"

        if load_meters_online > 0 and total_load > 0:
            # Priority 1: Load meters (direct measurement)
            estimated_load = total_load
            load_source = "load_meter"
        elif generators_online > 0 and total_generator > 0:
            # Priority 2: Generator power (off-grid: gen output ≈ load)
            estimated_load = total_generator
            load_source = "generator_fallback"
        # Priority 3 & 4 (cached / safe mode) handled by control service

        # Calculate available headroom
        available_headroom = estimated_load - generator_reserve

        # Calculate solar limit
        solar_limit_kw = max(0.0, min(available_headroom, solar_capacity))
        solar_limit_pct = (solar_limit_kw / solar_capacity * 100) if solar_capacity > 0 else 0.0

        # Clamp to valid range
        solar_limit_pct = max(0.0, min(100.0, solar_limit_pct))

        logger.debug(
            f"ZeroGenFeed: load={estimated_load:.1f}kW ({load_source}), "
            f"reserve={generator_reserve:.1f}kW, headroom={available_headroom:.1f}kW, "
            f"limit={solar_limit_pct:.1f}%"
        )

        return ControlOutput(
            solar_limit_pct=round(solar_limit_pct, 1),
            solar_limit_kw=round(solar_limit_kw, 2),
            load_source=load_source,
            actions={"write_inverter_limit": True},
        )


class ZeroDGPowerFactor(OperationMode):
    """
    Maintain power factor on DG by controlling reactive power.

    Combines active power limiting with power factor correction.
    """

    mode_id = "zero_dg_pf"
    required_settings = ["dg_reserve_kw", "target_power_factor"]
    required_device_types = ["inverter", "dg"]

    def calculate(self, readings: dict, config: dict) -> ControlOutput:
        # Get settings
        mode_settings = config.get("mode_settings", {})
        dg_reserve = mode_settings.get("dg_reserve_kw", 10.0)
        target_pf = mode_settings.get("target_power_factor", 0.95)

        # Get readings
        total_dg = readings.get("total_dg_kw", 0.0)
        solar_capacity = readings.get("solar_capacity_kw", 100.0)

        # Calculate active power limit (same as zero_dg_reverse)
        available_headroom = total_dg - dg_reserve
        solar_limit_kw = max(0.0, min(available_headroom, solar_capacity))
        solar_limit_pct = (solar_limit_kw / solar_capacity * 100) if solar_capacity > 0 else 0.0

        # TODO: Calculate reactive power for PF correction
        # This would require Q measurement from DG and inverter capability
        reactive_power_kvar = 0.0

        return ControlOutput(
            solar_limit_pct=round(solar_limit_pct, 1),
            solar_limit_kw=round(solar_limit_kw, 2),
            reactive_power_kvar=reactive_power_kvar,
            actions={
                "write_inverter_limit": True,
                "write_reactive_power": reactive_power_kvar != 0,
            },
        )


class ZeroDGReactive(OperationMode):
    """
    Control reactive power to DG.

    Limits reactive power injection to prevent DG issues.
    """

    mode_id = "zero_dg_reactive"
    required_settings = ["max_reactive_kvar"]
    required_device_types = ["inverter", "dg"]

    def calculate(self, readings: dict, config: dict) -> ControlOutput:
        # Get settings
        mode_settings = config.get("mode_settings", {})
        max_reactive = mode_settings.get("max_reactive_kvar", 50.0)

        # Get readings
        solar_capacity = readings.get("solar_capacity_kw", 100.0)
        current_reactive = readings.get("total_reactive_kvar", 0.0)

        # Limit reactive power
        reactive_limit = min(abs(current_reactive), max_reactive)
        if current_reactive < 0:
            reactive_limit = -reactive_limit

        return ControlOutput(
            solar_limit_pct=100.0,  # No active power limit in this mode
            reactive_power_kvar=reactive_limit,
            actions={
                "write_reactive_power": True,
            },
        )


class PeakShaving(OperationMode):
    """
    Reduce peak demand from grid using battery.

    Discharges battery when load exceeds threshold.
    """

    mode_id = "peak_shaving"
    required_settings = ["peak_threshold_kw", "battery_reserve_pct"]
    required_device_types = ["load_meter", "battery"]

    def calculate(self, readings: dict, config: dict) -> ControlOutput:
        # Get settings
        mode_settings = config.get("mode_settings", {})
        peak_threshold = mode_settings.get("peak_threshold_kw", 500.0)
        battery_reserve = mode_settings.get("battery_reserve_pct", 20.0)

        # Get readings
        total_load = readings.get("total_load_kw", 0.0)
        battery_soc = readings.get("battery_soc_pct", 50.0)
        battery_capacity = readings.get("battery_capacity_kw", 100.0)

        # Calculate required battery discharge
        excess_load = total_load - peak_threshold

        if excess_load > 0 and battery_soc > battery_reserve:
            # Discharge battery to reduce peak
            discharge_kw = min(excess_load, battery_capacity)
        else:
            discharge_kw = 0.0

        return ControlOutput(
            solar_limit_pct=100.0,  # No solar limiting
            battery_discharge_kw=round(discharge_kw, 2),
            actions={
                "discharge_battery": discharge_kw > 0,
            },
        )


# Mode registry - add new modes here
OPERATION_MODES: dict[str, OperationMode] = {
    "zero_generator_feed": ZeroGeneratorFeed(),
    "zero_dg_reverse": ZeroGeneratorFeed(),  # Legacy alias
    "zero_dg_pf": ZeroDGPowerFactor(),
    "zero_dg_reactive": ZeroDGReactive(),
    "peak_shaving": PeakShaving(),
}


def get_mode(mode_id: str) -> OperationMode:
    """Get operation mode by ID"""
    if mode_id not in OPERATION_MODES:
        logger.warning(f"Unknown operation mode: {mode_id}, using zero_generator_feed")
        return OPERATION_MODES["zero_generator_feed"]
    return OPERATION_MODES[mode_id]


def validate_config_for_mode(mode_id: str, config: dict) -> list[str]:
    """Check if config has all required settings for the mode"""
    mode = get_mode(mode_id)
    errors = []

    mode_settings = config.get("mode_settings", {})

    for setting in mode.required_settings:
        if setting not in mode_settings or mode_settings[setting] is None:
            errors.append(f"Missing required setting: {setting}")

    return errors


def get_available_modes() -> list[dict]:
    """Get list of available operation modes"""
    return [
        {
            "mode_id": mode.mode_id,
            "required_settings": mode.required_settings,
            "required_device_types": mode.required_device_types,
        }
        for mode in OPERATION_MODES.values()
    ]
