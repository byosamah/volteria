"""
Threshold Alarm Evaluator

Evaluates values against alarm threshold conditions defined in templates.
Works with controller templates and device templates to check if values
trigger alarms based on configured thresholds.

Example alarm definition:
{
    "id": "high_cpu_temp",
    "name": "High CPU Temperature",
    "source_type": "device_info",
    "source_key": "cpu_temp_celsius",
    "conditions": [
        {"operator": ">", "value": 70, "severity": "warning", "message": "Temp above 70C"},
        {"operator": ">", "value": 85, "severity": "critical", "message": "Temp critical"}
    ],
    "enabled_by_default": true,
    "cooldown_seconds": 300
}
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Callable

logger = logging.getLogger(__name__)


# Severity ordering (highest to lowest)
SEVERITY_ORDER = {
    "critical": 4,
    "major": 3,
    "warning": 2,
    "info": 1,
}


@dataclass
class ThresholdCondition:
    """A single threshold condition."""
    operator: str       # ">", ">=", "<", "<=", "==", "!="
    value: float
    severity: str       # "info", "warning", "major", "critical"
    message: str


@dataclass
class AlarmDefinition:
    """Definition of a threshold-based alarm."""
    id: str
    name: str
    description: str
    source_type: str    # "modbus_register", "device_info", "calculated_field", "heartbeat"
    source_key: str
    conditions: list[ThresholdCondition]
    enabled_by_default: bool
    cooldown_seconds: int


@dataclass
class SiteOverride:
    """Site-specific override for an alarm."""
    alarm_definition_id: str
    enabled: Optional[bool]
    conditions_override: Optional[list[ThresholdCondition]]
    cooldown_seconds_override: Optional[int]


@dataclass
class EvaluationResult:
    """Result of evaluating a value against alarm conditions."""
    triggered: bool
    severity: Optional[str]
    message: Optional[str]
    alarm_id: str
    alarm_name: str
    value: float


class ThresholdAlarmEvaluator:
    """
    Evaluates values against threshold conditions.

    Features:
    - Load alarm definitions from templates
    - Apply site-specific overrides
    - Evaluate values and detect threshold crossings
    - Track cooldowns per alarm
    - Return evaluation results for alarm generation
    """

    def __init__(
        self,
        alarm_callback: Optional[Callable[[str, str, str, str, Optional[str]], None]] = None
    ):
        """
        Initialize the threshold alarm evaluator.

        Args:
            alarm_callback: Optional callback for raising alarms
                           (alarm_id, message, severity, alarm_type, device_name)
        """
        # Store alarm definitions keyed by definition ID
        self._definitions: dict[str, AlarmDefinition] = {}

        # Store site overrides keyed by definition ID
        self._overrides: dict[str, SiteOverride] = {}

        # Track last alarm time per definition ID for cooldown
        self._last_alarm: dict[str, datetime] = {}

        # Optional callback to raise alarms
        self._alarm_callback = alarm_callback

        logger.info("Threshold alarm evaluator initialized")

    def load_alarm_definitions(self, definitions: list[dict]):
        """
        Load alarm definitions from template data.

        Args:
            definitions: List of alarm definition dictionaries
        """
        for defn in definitions:
            try:
                conditions = [
                    ThresholdCondition(
                        operator=c["operator"],
                        value=float(c["value"]),
                        severity=c["severity"],
                        message=c.get("message", "")
                    )
                    for c in defn.get("conditions", [])
                ]

                alarm_def = AlarmDefinition(
                    id=defn["id"],
                    name=defn["name"],
                    description=defn.get("description", ""),
                    source_type=defn["source_type"],
                    source_key=defn["source_key"],
                    conditions=conditions,
                    enabled_by_default=defn.get("enabled_by_default", True),
                    cooldown_seconds=defn.get("cooldown_seconds", 300)
                )

                self._definitions[alarm_def.id] = alarm_def
                logger.debug(f"Loaded alarm definition: {alarm_def.id}")

            except (KeyError, TypeError) as e:
                logger.warning(f"Invalid alarm definition: {e}")

        logger.info(f"Loaded {len(self._definitions)} alarm definitions")

    def load_site_overrides(self, overrides: list[dict]):
        """
        Load site-specific overrides.

        Args:
            overrides: List of site override dictionaries
        """
        for ovr in overrides:
            try:
                conditions_override = None
                if ovr.get("conditions_override"):
                    conditions_override = [
                        ThresholdCondition(
                            operator=c["operator"],
                            value=float(c["value"]),
                            severity=c["severity"],
                            message=c.get("message", "")
                        )
                        for c in ovr["conditions_override"]
                    ]

                site_override = SiteOverride(
                    alarm_definition_id=ovr["alarm_definition_id"],
                    enabled=ovr.get("enabled"),
                    conditions_override=conditions_override,
                    cooldown_seconds_override=ovr.get("cooldown_seconds_override")
                )

                self._overrides[site_override.alarm_definition_id] = site_override
                logger.debug(f"Loaded site override for: {site_override.alarm_definition_id}")

            except (KeyError, TypeError) as e:
                logger.warning(f"Invalid site override: {e}")

        logger.info(f"Loaded {len(self._overrides)} site overrides")

    def _get_effective_config(self, alarm_id: str) -> tuple[bool, list[ThresholdCondition], int]:
        """
        Get effective configuration for an alarm, applying overrides.

        Returns:
            Tuple of (enabled, conditions, cooldown_seconds)
        """
        defn = self._definitions.get(alarm_id)
        if not defn:
            return (False, [], 300)

        override = self._overrides.get(alarm_id)

        # Determine enabled state
        if override and override.enabled is not None:
            enabled = override.enabled
        else:
            enabled = defn.enabled_by_default

        # Determine conditions
        if override and override.conditions_override:
            conditions = override.conditions_override
        else:
            conditions = defn.conditions

        # Determine cooldown
        if override and override.cooldown_seconds_override is not None:
            cooldown = override.cooldown_seconds_override
        else:
            cooldown = defn.cooldown_seconds

        return (enabled, conditions, cooldown)

    def _is_in_cooldown(self, alarm_id: str, cooldown_seconds: int) -> bool:
        """Check if alarm is in cooldown period."""
        last_time = self._last_alarm.get(alarm_id)
        if last_time is None:
            return False

        elapsed = (datetime.now() - last_time).total_seconds()
        return elapsed < cooldown_seconds

    def _evaluate_condition(self, value: float, condition: ThresholdCondition) -> bool:
        """
        Evaluate a single condition against a value.

        Returns:
            True if condition is triggered
        """
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
            return abs(value - threshold) < 0.001  # Float comparison
        elif op == "!=":
            return abs(value - threshold) >= 0.001
        else:
            logger.warning(f"Unknown operator: {op}")
            return False

    def evaluate(
        self,
        alarm_id: str,
        value: float,
        device_name: Optional[str] = None,
        force: bool = False
    ) -> EvaluationResult:
        """
        Evaluate a value against an alarm's threshold conditions.

        Args:
            alarm_id: The alarm definition ID
            value: The value to check
            device_name: Optional device name for context
            force: Bypass cooldown check

        Returns:
            EvaluationResult with trigger status and details
        """
        defn = self._definitions.get(alarm_id)
        if not defn:
            return EvaluationResult(
                triggered=False,
                severity=None,
                message=None,
                alarm_id=alarm_id,
                alarm_name="Unknown",
                value=value
            )

        enabled, conditions, cooldown = self._get_effective_config(alarm_id)

        # Check if alarm is enabled
        if not enabled:
            return EvaluationResult(
                triggered=False,
                severity=None,
                message=f"Alarm disabled",
                alarm_id=alarm_id,
                alarm_name=defn.name,
                value=value
            )

        # Check cooldown
        if not force and self._is_in_cooldown(alarm_id, cooldown):
            return EvaluationResult(
                triggered=False,
                severity=None,
                message=f"In cooldown",
                alarm_id=alarm_id,
                alarm_name=defn.name,
                value=value
            )

        # Sort conditions by severity (highest first) to find worst triggered condition
        sorted_conditions = sorted(
            conditions,
            key=lambda c: SEVERITY_ORDER.get(c.severity, 0),
            reverse=True
        )

        # Find the highest severity condition that triggers
        triggered_condition = None
        for condition in sorted_conditions:
            if self._evaluate_condition(value, condition):
                triggered_condition = condition
                break  # Highest severity that matches

        if triggered_condition:
            # Record alarm time
            self._last_alarm[alarm_id] = datetime.now()

            # Format message with value
            message = triggered_condition.message
            if not message:
                message = f"{defn.name}: {value}"

            # Call alarm callback if provided
            if self._alarm_callback:
                self._alarm_callback(
                    alarm_id,
                    message,
                    triggered_condition.severity,
                    "threshold_alarm",
                    device_name
                )

            return EvaluationResult(
                triggered=True,
                severity=triggered_condition.severity,
                message=message,
                alarm_id=alarm_id,
                alarm_name=defn.name,
                value=value
            )

        return EvaluationResult(
            triggered=False,
            severity=None,
            message=None,
            alarm_id=alarm_id,
            alarm_name=defn.name,
            value=value
        )

    def evaluate_by_source(
        self,
        source_type: str,
        source_key: str,
        value: float,
        device_name: Optional[str] = None
    ) -> list[EvaluationResult]:
        """
        Evaluate a value against all alarms with matching source.

        Args:
            source_type: The source type (e.g., "device_info", "modbus_register")
            source_key: The source key (e.g., "cpu_temp_celsius")
            value: The value to check
            device_name: Optional device name

        Returns:
            List of EvaluationResults for matching alarms
        """
        results = []

        for alarm_id, defn in self._definitions.items():
            if defn.source_type == source_type and defn.source_key == source_key:
                result = self.evaluate(alarm_id, value, device_name)
                results.append(result)

        return results

    def get_alarm_ids_by_source(self, source_type: str, source_key: str) -> list[str]:
        """
        Get alarm definition IDs that match a source.

        Args:
            source_type: The source type
            source_key: The source key

        Returns:
            List of matching alarm definition IDs
        """
        return [
            alarm_id
            for alarm_id, defn in self._definitions.items()
            if defn.source_type == source_type and defn.source_key == source_key
        ]

    def clear_cooldowns(self, alarm_id: Optional[str] = None):
        """
        Clear cooldown for alarm(s).

        Args:
            alarm_id: Specific alarm to clear, or None for all
        """
        if alarm_id:
            if alarm_id in self._last_alarm:
                del self._last_alarm[alarm_id]
                logger.debug(f"Cleared cooldown for: {alarm_id}")
        else:
            self._last_alarm.clear()
            logger.debug("Cleared all cooldowns")

    def get_status(self) -> dict:
        """
        Get evaluator status for monitoring.

        Returns:
            Dictionary with status information
        """
        return {
            "definitions_loaded": len(self._definitions),
            "overrides_applied": len(self._overrides),
            "active_cooldowns": len(self._last_alarm),
            "alarm_ids": list(self._definitions.keys())
        }
