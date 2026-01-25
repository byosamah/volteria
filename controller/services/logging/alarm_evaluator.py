"""
Alarm Evaluator

Evaluates threshold alarms based on readings and alarm definitions.
"""

from datetime import datetime, timezone
from typing import Any
from dataclasses import dataclass, field

from common.config import AlarmDefinition, AlarmCondition
from common.logging_setup import get_service_logger, log_alarm

logger = get_service_logger("logging.alarm_eval")


@dataclass
class AlarmState:
    """State for tracking alarm cooldowns"""
    alarm_id: str
    last_triggered: datetime | None = None
    trigger_count: int = 0
    is_active: bool = False


@dataclass
class TriggeredAlarm:
    """A triggered alarm"""
    alarm_id: str
    name: str
    severity: str
    message: str
    source_type: str
    source_key: str
    value: float
    threshold: float
    operator: str = ""  # >, <, >=, <=, ==, !=
    device_id: str | None = None
    device_name: str | None = None
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def get_formatted_message(self) -> str:
        """Return user message only.

        Condition details (register, operator, threshold) are displayed
        in a separate Condition column in the UI, extracted from alarm_type.
        """
        return self.message or f"{self.source_key} alarm"


class AlarmEvaluator:
    """
    Evaluates alarm conditions against readings.

    Features:
    - Threshold-based alarms (>, >=, <, <=, ==, !=)
    - Multiple conditions per alarm (triggers on first match)
    - Cooldown support (don't re-trigger too quickly)
    - Device-specific and global alarms
    """

    def __init__(self):
        self._alarm_states: dict[str, AlarmState] = {}
        self._definitions: list[AlarmDefinition] = []

    def update_definitions(self, definitions: list[AlarmDefinition]) -> None:
        """
        Update the alarm definitions.

        Args:
            definitions: New list of alarm definitions
        """
        self._definitions = definitions
        logger.debug(f"Updated alarm definitions: {len(definitions)} definitions")

    def evaluate(
        self,
        readings: dict[str, Any],
        alarm_definitions: list[AlarmDefinition],
        device_name: str | None = None,
        device_id: str | None = None,
    ) -> list[TriggeredAlarm]:
        """
        Evaluate alarm conditions against readings.

        Args:
            readings: Dict of current readings {key: value}
            alarm_definitions: List of alarm definitions to check
            device_name: Optional device name for device alarms
            device_id: Optional device ID

        Returns:
            List of triggered alarms
        """
        triggered = []
        now = datetime.now(timezone.utc)

        for alarm_def in alarm_definitions:
            if not alarm_def.enabled_by_default:
                continue

            # Use device info from alarm definition if available, else from params
            alarm_device_id = alarm_def.device_id or device_id
            alarm_device_name = alarm_def.device_name or device_name

            # Get the value to check (pass device_id for device-specific lookups)
            value = self._get_value(readings, alarm_def.source_type, alarm_def.source_key, alarm_device_id)
            if value is None:
                continue

            # Check each condition
            for condition in alarm_def.conditions:
                if self._check_condition(value, condition):
                    # Check cooldown
                    state_key = f"{alarm_device_id or 'global'}:{alarm_def.id}"
                    state = self._alarm_states.get(state_key)

                    if state and state.last_triggered:
                        elapsed = (now - state.last_triggered).total_seconds()
                        if elapsed < alarm_def.cooldown_seconds:
                            continue  # Still in cooldown

                    # Create triggered alarm
                    alarm = TriggeredAlarm(
                        alarm_id=alarm_def.id,
                        name=alarm_def.name,
                        severity=condition.severity,
                        message=condition.message,
                        source_type=alarm_def.source_type,
                        source_key=alarm_def.source_key,
                        value=value,
                        threshold=condition.value,
                        operator=condition.operator,
                        device_id=alarm_device_id,
                        device_name=alarm_device_name,
                        timestamp=now,
                    )
                    triggered.append(alarm)

                    # Update state
                    if state_key not in self._alarm_states:
                        self._alarm_states[state_key] = AlarmState(alarm_id=alarm_def.id)

                    self._alarm_states[state_key].last_triggered = now
                    self._alarm_states[state_key].trigger_count += 1
                    self._alarm_states[state_key].is_active = True

                    # Log alarm (use logger directly - ServiceLoggerAdapter is compatible)
                    log_alarm(
                        logger,
                        alarm_id=alarm_def.id,
                        severity=condition.severity,
                        message=condition.message,
                        device_name=alarm_device_name,
                    )

                    # Only trigger once per alarm definition
                    break

        return triggered

    def _get_value(
        self,
        readings: dict[str, Any],
        source_type: str,
        source_key: str,
        device_id: str | None = None,
    ) -> float | None:
        """
        Extract value from readings based on source type.

        Args:
            readings: Dict with control state values and optional device_registers
            source_type: Type of data source (modbus_register, device_info, etc.)
            source_key: Register name or field key
            device_id: Device ID for device-specific lookups
        """
        if source_type == "modbus_register":
            # Check device_registers dict first (new path for device alarms)
            device_registers = readings.get("device_registers", {})
            if device_registers:
                # Prefer specific device if device_id is provided
                if device_id and device_id in device_registers:
                    value = device_registers[device_id].get(source_key)
                    if value is not None:
                        return value
                # Fallback: search all devices for the register name
                for regs in device_registers.values():
                    if source_key in regs:
                        value = regs.get(source_key)
                        if value is not None:
                            return value

            # Legacy path: direct register reading from readings dict
            value = readings.get(source_key)
            if isinstance(value, dict):
                return value.get("value")
            return value

        elif source_type == "device_info":
            # Device info (like online status)
            return readings.get(source_key)

        elif source_type == "calculated_field":
            # Calculated field
            return readings.get(source_key)

        elif source_type == "heartbeat":
            # System metric (CPU, memory, etc.)
            return readings.get(source_key)

        return None

    def _check_condition(self, value: float, condition: AlarmCondition) -> bool:
        """Check if value matches condition"""
        op = condition.operator
        threshold = condition.value

        if op == ">":
            return value > threshold
        elif op == ">=":
            return value >= threshold
        elif op == "<":
            return value < threshold
        elif op == "<=":
            return value <= threshold
        elif op == "==":
            return value == threshold
        elif op == "!=":
            return value != threshold

        return False

    def clear_alarm(self, alarm_id: str, device_id: str | None = None) -> None:
        """Clear an active alarm"""
        state_key = f"{device_id or 'global'}:{alarm_id}"

        if state_key in self._alarm_states:
            self._alarm_states[state_key].is_active = False
            logger.debug(f"Cleared alarm: {alarm_id}")

    def get_active_alarms(self) -> list[str]:
        """Get list of currently active alarm IDs"""
        return [
            state.alarm_id
            for state in self._alarm_states.values()
            if state.is_active
        ]

    def reset_cooldown(self, alarm_id: str, device_id: str | None = None) -> None:
        """Reset cooldown for an alarm"""
        state_key = f"{device_id or 'global'}:{alarm_id}"

        if state_key in self._alarm_states:
            self._alarm_states[state_key].last_triggered = None
