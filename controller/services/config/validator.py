"""
Configuration Validator

Validates configuration against operation mode requirements.
"""

from typing import Any

from common.config import OperationMode
from common.logging_setup import get_service_logger

logger = get_service_logger("config.validator")


# Required settings per operation mode
MODE_REQUIREMENTS: dict[str, list[str]] = {
    "zero_dg_reverse": ["dg_reserve_kw"],
    "zero_dg_pf": ["dg_reserve_kw", "target_power_factor"],
    "zero_dg_reactive": ["max_reactive_kvar"],
    "peak_shaving": ["peak_threshold_kw", "battery_reserve_pct"],
}

# Required device types per operation mode
MODE_DEVICE_REQUIREMENTS: dict[str, list[str]] = {
    "zero_dg_reverse": ["inverter"],  # + load_meter OR dg
    "zero_dg_pf": ["inverter", "dg"],
    "zero_dg_reactive": ["inverter", "dg"],
    "peak_shaving": ["load_meter", "battery"],
}


class ConfigValidator:
    """Validates site configuration"""

    def validate(self, config: dict[str, Any]) -> tuple[bool, list[str]]:
        """
        Validate configuration.

        Args:
            config: Configuration dictionary

        Returns:
            Tuple of (is_valid, list of error messages)
        """
        errors: list[str] = []

        # Basic required fields
        if not config.get("id"):
            errors.append("Missing site ID")

        if not config.get("operation_mode"):
            errors.append("Missing operation mode")

        # Validate mode-specific settings
        operation_mode = config.get("operation_mode", "zero_dg_reverse")
        mode_errors = self._validate_mode_settings(config, operation_mode)
        errors.extend(mode_errors)

        # Validate devices
        device_errors = self._validate_devices(config, operation_mode)
        errors.extend(device_errors)

        # Validate control settings
        control_errors = self._validate_control_settings(config)
        errors.extend(control_errors)

        # Validate safe mode settings
        safe_mode_errors = self._validate_safe_mode(config)
        errors.extend(safe_mode_errors)

        is_valid = len(errors) == 0

        if not is_valid:
            logger.warning(
                f"Config validation failed: {len(errors)} errors",
                extra={"errors": errors},
            )
        else:
            logger.debug("Config validation passed")

        return is_valid, errors

    def _validate_mode_settings(
        self,
        config: dict[str, Any],
        operation_mode: str,
    ) -> list[str]:
        """Validate operation mode-specific settings"""
        errors = []

        required_settings = MODE_REQUIREMENTS.get(operation_mode, [])
        mode_settings = config.get("mode_settings", {})

        for setting in required_settings:
            value = mode_settings.get(setting)
            if value is None:
                errors.append(f"Missing required setting for {operation_mode}: {setting}")
            elif isinstance(value, (int, float)) and value < 0:
                errors.append(f"Invalid {setting}: must be non-negative")

        # DG reserve specific validation
        if "dg_reserve_kw" in mode_settings:
            dg_reserve = mode_settings["dg_reserve_kw"]
            if dg_reserve is not None and dg_reserve < 0:
                errors.append("DG reserve cannot be negative (minimum: 0 kW)")

        return errors

    def _validate_devices(
        self,
        config: dict[str, Any],
        operation_mode: str,
    ) -> list[str]:
        """Validate device configuration"""
        errors = []
        devices = config.get("devices", [])

        if not devices:
            errors.append("No devices configured")
            return errors

        # Check required device types
        required_types = MODE_DEVICE_REQUIREMENTS.get(operation_mode, [])
        device_types = set(d.get("device_type") for d in devices)

        # Special case: zero_dg_reverse needs inverter + (load_meter OR dg)
        if operation_mode == "zero_dg_reverse":
            if "inverter" not in device_types:
                errors.append("At least one inverter is required")
            if "load_meter" not in device_types and "dg" not in device_types:
                errors.append("At least one load meter or DG controller is required")
        else:
            for required_type in required_types:
                if required_type not in device_types:
                    errors.append(f"Missing required device type: {required_type}")

        # Validate each device
        for i, device in enumerate(devices):
            device_errors = self._validate_device(device, i)
            errors.extend(device_errors)

        return errors

    def _validate_device(self, device: dict, index: int) -> list[str]:
        """Validate a single device configuration"""
        errors = []
        device_name = device.get("name", f"device[{index}]")

        if not device.get("id"):
            errors.append(f"{device_name}: Missing device ID")

        if not device.get("device_type"):
            errors.append(f"{device_name}: Missing device type")

        # Validate connection settings
        protocol = device.get("protocol", "tcp")

        if protocol in ["tcp", "rtu_gateway"]:
            if not device.get("host"):
                errors.append(f"{device_name}: Missing host/IP address")

            port = device.get("port")
            if port and (port < 1 or port > 65535):
                errors.append(f"{device_name}: Invalid port number")

        slave_id = device.get("slave_id")
        if slave_id is not None and (slave_id < 1 or slave_id > 247):
            errors.append(f"{device_name}: Invalid slave ID (must be 1-247)")

        # Validate registers
        registers = device.get("registers", [])
        if not registers:
            errors.append(f"{device_name}: No registers configured")
        else:
            for j, reg in enumerate(registers):
                if reg.get("address") is None:
                    errors.append(f"{device_name}: Register[{j}] missing address")

        return errors

    def _validate_control_settings(self, config: dict[str, Any]) -> list[str]:
        """Validate control settings"""
        errors = []

        interval_ms = config.get("control_interval_ms", 1000)
        if interval_ms < 100:
            errors.append("Control interval too fast (minimum 100ms)")
        if interval_ms > 60000:
            errors.append("Control interval too slow (maximum 60s)")

        return errors

    def _validate_safe_mode(self, config: dict[str, Any]) -> list[str]:
        """Validate safe mode settings"""
        errors = []
        safe_mode = config.get("safe_mode", {})

        if safe_mode.get("enabled", True):
            timeout = safe_mode.get("timeout_s", 30)
            if timeout < 5:
                errors.append("Safe mode timeout too short (minimum 5s)")
            if timeout > 300:
                errors.append("Safe mode timeout too long (maximum 300s)")

            threshold = safe_mode.get("threshold_pct", 80)
            if threshold < 0 or threshold > 100:
                errors.append("Safe mode threshold must be 0-100%")

        return errors

    def get_config_mode(self, config: dict[str, Any]) -> str:
        """
        Determine config mode based on available devices.

        Returns:
            'meter_inverter', 'dg_inverter', or 'full_system'
        """
        devices = config.get("devices", [])
        device_types = set(d.get("device_type") for d in devices)

        has_load_meter = "load_meter" in device_types
        has_inverter = "inverter" in device_types
        has_dg = "dg" in device_types

        if has_load_meter and has_inverter and has_dg:
            return "full_system"
        elif has_dg and has_inverter:
            return "dg_inverter"
        elif has_load_meter and has_inverter:
            return "meter_inverter"
        else:
            return "unknown"
