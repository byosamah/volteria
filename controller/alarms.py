"""
Alarm Manager

Handles generation and management of system alarms.

Alarm Types:
- communication_lost: Device stopped responding
- control_error: Error in control logic
- safe_mode_triggered: Safe mode was activated
- not_reporting: Device not sending data
- controller_offline: Site controller missed heartbeat (cloud-side)
- write_failed: Modbus write operation failed
- command_not_taken: Inverter didn't accept command
- threshold_alarm: Threshold condition exceeded (from templates)
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Optional, Callable

from storage.local_db import LocalDatabase, AlarmRecord
from alarm_evaluator import ThresholdAlarmEvaluator

logger = logging.getLogger(__name__)


class AlarmType(Enum):
    """Types of alarms that can be generated."""
    COMMUNICATION_LOST = "communication_lost"
    CONTROL_ERROR = "control_error"
    SAFE_MODE_TRIGGERED = "safe_mode_triggered"
    NOT_REPORTING = "not_reporting"
    WRITE_FAILED = "write_failed"
    COMMAND_NOT_TAKEN = "command_not_taken"
    THRESHOLD_ALARM = "threshold_alarm"


class Severity(Enum):
    """Alarm severity levels (ordered from low to high)."""
    INFO = "info"
    WARNING = "warning"
    MAJOR = "major"        # Between warning and critical
    CRITICAL = "critical"


@dataclass
class Alarm:
    """An alarm instance."""
    alarm_type: AlarmType
    severity: Severity
    message: str
    device_name: Optional[str] = None
    timestamp: datetime = None

    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.now()


class AlarmManager:
    """
    Manages alarm generation and deduplication.

    Features:
    - Generate alarms for various conditions
    - Deduplicate repeated alarms (cooldown period)
    - Store alarms in local database
    - Severity-based logging
    - Threshold-based alarms from templates
    """

    def __init__(
        self,
        local_db: LocalDatabase,
        cooldown_seconds: int = 300
    ):
        """
        Initialize alarm manager.

        Args:
            local_db: Local database for storing alarms
            cooldown_seconds: Minimum time between duplicate alarms
        """
        self.local_db = local_db
        self.cooldown_seconds = cooldown_seconds

        # Track last alarm time per type+device to prevent duplicates
        self._last_alarm: dict[str, datetime] = {}

        # Initialize threshold alarm evaluator with callback to raise_alarm
        self._threshold_evaluator = ThresholdAlarmEvaluator(
            alarm_callback=self._handle_threshold_alarm
        )

        logger.info(f"Alarm manager initialized (cooldown: {cooldown_seconds}s)")

    def _handle_threshold_alarm(
        self,
        alarm_id: str,
        message: str,
        severity: str,
        alarm_type: str,
        device_name: Optional[str]
    ):
        """
        Handle a threshold alarm from the evaluator.

        This is called by ThresholdAlarmEvaluator when a threshold is exceeded.
        """
        # Convert severity string to Severity enum
        severity_map = {
            "info": Severity.INFO,
            "warning": Severity.WARNING,
            "major": Severity.MAJOR,
            "critical": Severity.CRITICAL,
        }
        sev = severity_map.get(severity, Severity.WARNING)

        # Raise the alarm
        self.raise_alarm(
            alarm_type=AlarmType.THRESHOLD_ALARM,
            message=f"[{alarm_id}] {message}",
            device_name=device_name,
            severity=sev,
            force=True  # Evaluator handles its own cooldown
        )

    def _get_alarm_key(self, alarm_type: AlarmType, device_name: Optional[str]) -> str:
        """Get unique key for deduplication."""
        return f"{alarm_type.value}:{device_name or 'system'}"

    def _is_in_cooldown(self, alarm_type: AlarmType, device_name: Optional[str]) -> bool:
        """Check if alarm is in cooldown period."""
        key = self._get_alarm_key(alarm_type, device_name)
        last_time = self._last_alarm.get(key)

        if last_time is None:
            return False

        elapsed = (datetime.now() - last_time).total_seconds()
        return elapsed < self.cooldown_seconds

    def _record_alarm(self, alarm: Alarm):
        """Record alarm in local database."""
        record = AlarmRecord(
            timestamp=alarm.timestamp,
            alarm_type=alarm.alarm_type.value,
            device_name=alarm.device_name,
            message=alarm.message,
            severity=alarm.severity.value
        )
        self.local_db.insert_alarm(record)

        # Update cooldown tracker
        key = self._get_alarm_key(alarm.alarm_type, alarm.device_name)
        self._last_alarm[key] = alarm.timestamp

    # ============================================
    # ALARM GENERATION METHODS
    # ============================================

    def raise_alarm(
        self,
        alarm_type: AlarmType,
        message: str,
        device_name: Optional[str] = None,
        severity: Severity = Severity.WARNING,
        force: bool = False
    ):
        """
        Raise an alarm.

        Args:
            alarm_type: Type of alarm
            message: Descriptive message
            device_name: Related device (if any)
            severity: Alarm severity
            force: Bypass cooldown check
        """
        # Check cooldown (unless forced)
        if not force and self._is_in_cooldown(alarm_type, device_name):
            logger.debug(f"Alarm suppressed (cooldown): {alarm_type.value} - {device_name}")
            return

        alarm = Alarm(
            alarm_type=alarm_type,
            severity=severity,
            message=message,
            device_name=device_name
        )

        # Log based on severity
        if severity == Severity.CRITICAL:
            logger.error(f"ALARM [{severity.value}] {alarm_type.value}: {message}")
        elif severity == Severity.WARNING:
            logger.warning(f"ALARM [{severity.value}] {alarm_type.value}: {message}")
        else:
            logger.info(f"ALARM [{severity.value}] {alarm_type.value}: {message}")

        # Store in database
        self._record_alarm(alarm)

    # ============================================
    # CONVENIENCE METHODS
    # ============================================

    def communication_lost(self, device_name: str, reason: str = "No response"):
        """Device stopped responding."""
        self.raise_alarm(
            alarm_type=AlarmType.COMMUNICATION_LOST,
            message=f"Lost communication with {device_name}: {reason}",
            device_name=device_name,
            severity=Severity.CRITICAL
        )

    def control_error(self, message: str):
        """Error in control logic."""
        self.raise_alarm(
            alarm_type=AlarmType.CONTROL_ERROR,
            message=message,
            severity=Severity.CRITICAL
        )

    def safe_mode_triggered(self, reason: str, device_name: Optional[str] = None):
        """Safe mode was activated."""
        self.raise_alarm(
            alarm_type=AlarmType.SAFE_MODE_TRIGGERED,
            message=f"Safe mode activated: {reason}",
            device_name=device_name,
            severity=Severity.CRITICAL,
            force=True  # Always record safe mode triggers
        )

    def not_reporting(self, device_name: str, timeout_s: int):
        """Device not sending data."""
        self.raise_alarm(
            alarm_type=AlarmType.NOT_REPORTING,
            message=f"{device_name} has not reported for {timeout_s}s",
            device_name=device_name,
            severity=Severity.WARNING
        )

    def write_failed(self, device_name: str, register: str, error: str):
        """Modbus write operation failed."""
        self.raise_alarm(
            alarm_type=AlarmType.WRITE_FAILED,
            message=f"Failed to write {register} to {device_name}: {error}",
            device_name=device_name,
            severity=Severity.CRITICAL
        )

    def command_not_taken(
        self,
        device_name: str,
        expected: float,
        actual: float,
        register: str = "power_limit"
    ):
        """
        Inverter didn't accept command.

        The command was written successfully, but read-back shows
        a different value than expected.
        """
        self.raise_alarm(
            alarm_type=AlarmType.COMMAND_NOT_TAKEN,
            message=f"{device_name} {register}: expected {expected}%, got {actual}%",
            device_name=device_name,
            severity=Severity.CRITICAL
        )

    # ============================================
    # THRESHOLD ALARMS
    # ============================================

    def load_alarm_definitions(self, definitions: list[dict]):
        """
        Load alarm definitions from templates.

        Args:
            definitions: List of alarm definition dictionaries
        """
        self._threshold_evaluator.load_alarm_definitions(definitions)
        logger.info(f"Loaded {len(definitions)} alarm definitions")

    def load_site_overrides(self, overrides: list[dict]):
        """
        Load site-specific alarm overrides.

        Args:
            overrides: List of override dictionaries
        """
        self._threshold_evaluator.load_site_overrides(overrides)
        logger.info(f"Loaded {len(overrides)} site overrides")

    def check_threshold(
        self,
        alarm_id: str,
        value: float,
        device_name: Optional[str] = None
    ) -> bool:
        """
        Check a value against a specific alarm threshold.

        Args:
            alarm_id: The alarm definition ID
            value: The value to check
            device_name: Optional device name

        Returns:
            True if alarm was triggered
        """
        result = self._threshold_evaluator.evaluate(alarm_id, value, device_name)
        return result.triggered

    def check_thresholds_by_source(
        self,
        source_type: str,
        source_key: str,
        value: float,
        device_name: Optional[str] = None
    ) -> int:
        """
        Check a value against all matching threshold alarms.

        Args:
            source_type: The source type (e.g., "device_info")
            source_key: The source key (e.g., "cpu_temp_celsius")
            value: The value to check
            device_name: Optional device name

        Returns:
            Number of alarms triggered
        """
        results = self._threshold_evaluator.evaluate_by_source(
            source_type, source_key, value, device_name
        )
        return sum(1 for r in results if r.triggered)

    def get_threshold_evaluator_status(self) -> dict:
        """Get threshold evaluator status for monitoring."""
        return self._threshold_evaluator.get_status()

    # ============================================
    # STATUS
    # ============================================

    def get_recent_alarms(self, limit: int = 10) -> list[dict]:
        """
        Get recent alarms for display.

        Note: This returns from local tracking, not full database query.
        For full history, query the database directly.
        """
        # Return last alarm times for monitoring
        return [
            {
                "key": key,
                "last_triggered": ts.isoformat()
            }
            for key, ts in sorted(
                self._last_alarm.items(),
                key=lambda x: x[1],
                reverse=True
            )[:limit]
        ]

    def clear_cooldown(self, alarm_type: Optional[AlarmType] = None):
        """
        Clear cooldown for alarm type(s).

        Args:
            alarm_type: Specific type to clear, or None for all
        """
        if alarm_type is None:
            self._last_alarm.clear()
            logger.info("Cleared all alarm cooldowns")
        else:
            keys_to_remove = [
                k for k in self._last_alarm
                if k.startswith(alarm_type.value)
            ]
            for key in keys_to_remove:
                del self._last_alarm[key]
            logger.info(f"Cleared cooldown for {alarm_type.value}")

    def get_active_alarms_count(self) -> int:
        """
        Get count of currently active (recent) alarms.

        An alarm is considered "active" if it was triggered within the cooldown period.
        This is used for the site status header to indicate if there are ongoing issues.

        Returns:
            Number of active alarms
        """
        now = datetime.now()
        active_count = 0

        for key, last_time in self._last_alarm.items():
            elapsed = (now - last_time).total_seconds()
            if elapsed < self.cooldown_seconds:
                active_count += 1

        return active_count
