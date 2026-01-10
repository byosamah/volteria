"""
Safe Mode Handler

Implements safe mode logic:
- Type 1: Time-based - triggers when device stops responding
- Type 2: Rolling Average - triggers when both conditions met:
  1. Solar avg > threshold% of load
  2. Device stopped communicating
"""

from datetime import datetime, timezone, timedelta
from collections import deque

from common.config import SafeModeSettings, SafeModeType
from common.state import SharedState
from common.logging_setup import get_service_logger
from .state import SafeModeState, ControlState

logger = get_service_logger("control.safe_mode")


class SafeModeHandler:
    """
    Handles safe mode triggering and recovery.

    Type 1: Time-based
    - Triggers when ANY device stops responding for timeout_s seconds
    - Sets solar limit to safe_mode_power_limit_kw

    Type 2: Rolling Average (Recommended)
    - Keeps rolling window of power readings
    - Triggers only when BOTH:
      1. Solar avg > threshold_pct% of load (high reverse risk)
      2. Device stopped communicating for timeout_s seconds
    """

    def __init__(self, settings: SafeModeSettings | None = None):
        self.settings = settings or SafeModeSettings()
        self._state = SafeModeState()

        # Rolling window for Type 2
        self._window_size = self.settings.rolling_window_min * 60  # seconds
        self._power_readings: deque[tuple[datetime, float, float]] = deque()

    def update_settings(self, settings: SafeModeSettings) -> None:
        """Update safe mode settings"""
        self.settings = settings
        self._window_size = settings.rolling_window_min * 60

    def check_and_trigger(
        self,
        state: ControlState,
        device_status: dict[str, bool],
    ) -> bool:
        """
        Check safe mode conditions and trigger if needed.

        Args:
            state: Current control state
            device_status: Dict mapping device_id to is_online

        Returns:
            True if safe mode should be active
        """
        if not self.settings.enabled:
            return False

        # Check for external trigger (e.g., from service failure)
        external_trigger = SharedState.read("safe_mode_trigger")
        if external_trigger.get("triggered"):
            self._trigger(
                external_trigger.get("reason", "External trigger"),
                external_trigger.get("service"),
            )
            return True

        # Add current reading to window
        now = datetime.now(timezone.utc)
        self._power_readings.append((
            now,
            state.total_load_kw,
            state.solar_output_kw,
        ))

        # Trim old readings
        cutoff = now - timedelta(seconds=self._window_size)
        while self._power_readings and self._power_readings[0][0] < cutoff:
            self._power_readings.popleft()

        # Check based on safe mode type
        if self.settings.type == SafeModeType.TIME_BASED:
            return self._check_time_based(device_status)
        else:
            return self._check_rolling_average(state, device_status)

    def _check_time_based(self, device_status: dict[str, bool]) -> bool:
        """
        Type 1: Time-based safe mode.

        Triggers when ANY critical device is offline.
        """
        # Check if any device is offline
        offline_devices = [
            device_id for device_id, is_online in device_status.items()
            if not is_online
        ]

        if offline_devices:
            # Check how long devices have been offline
            device_offline_times = SharedState.read("device_offline_times")

            for device_id in offline_devices:
                offline_since = device_offline_times.get(device_id)
                if offline_since:
                    offline_duration = (
                        datetime.now(timezone.utc) -
                        datetime.fromisoformat(offline_since)
                    ).total_seconds()

                    if offline_duration >= self.settings.timeout_s:
                        self._trigger(
                            f"Device offline for {offline_duration:.0f}s",
                            device_id,
                        )
                        return True

        # No trigger - reset if was active
        if self._state.active:
            self._check_recovery(device_status)

        return self._state.active

    def _check_rolling_average(
        self,
        state: ControlState,
        device_status: dict[str, bool],
    ) -> bool:
        """
        Type 2: Rolling Average safe mode.

        Triggers only when BOTH conditions met:
        1. Solar avg > threshold% of load
        2. Device stopped communicating
        """
        # Check if any device is offline
        offline_devices = [
            device_id for device_id, is_online in device_status.items()
            if not is_online
        ]

        if not offline_devices:
            # All devices online - no trigger
            if self._state.active:
                self._check_recovery(device_status)
            return self._state.active

        # Check device offline duration
        device_offline_long_enough = False
        device_offline_times = SharedState.read("device_offline_times")

        for device_id in offline_devices:
            offline_since = device_offline_times.get(device_id)
            if offline_since:
                offline_duration = (
                    datetime.now(timezone.utc) -
                    datetime.fromisoformat(offline_since)
                ).total_seconds()

                if offline_duration >= self.settings.timeout_s:
                    device_offline_long_enough = True
                    break

        if not device_offline_long_enough:
            return self._state.active

        # Calculate rolling averages
        if len(self._power_readings) < 10:
            # Not enough data
            return self._state.active

        avg_load = sum(r[1] for r in self._power_readings) / len(self._power_readings)
        avg_solar = sum(r[2] for r in self._power_readings) / len(self._power_readings)

        # Check threshold
        if avg_load > 0:
            solar_ratio = (avg_solar / avg_load) * 100
        else:
            solar_ratio = 100 if avg_solar > 0 else 0

        if solar_ratio >= self.settings.threshold_pct:
            self._trigger(
                f"High reverse risk: solar {solar_ratio:.0f}% of load, device offline",
            )
            return True

        return self._state.active

    def _trigger(self, reason: str, service: str | None = None) -> None:
        """Trigger safe mode"""
        if self._state.active:
            return  # Already active

        self._state.trigger(reason, service)

        logger.warning(
            f"Safe mode TRIGGERED: {reason}",
            extra={
                "reason": reason,
                "service": service,
            },
        )

        # Update shared state
        SharedState.write("safe_mode_state", self._state.to_dict())

    def _check_recovery(self, device_status: dict[str, bool]) -> None:
        """Check if safe mode can be recovered"""
        # All devices must be online to recover
        all_online = all(device_status.values())

        if all_online:
            logger.info("Safe mode recovery: all devices online")
            self._state.reset()
            SharedState.write("safe_mode_state", self._state.to_dict())
            SharedState.delete("safe_mode_trigger")

    def get_safe_limit(self) -> float:
        """Get safe mode power limit"""
        if self._state.active:
            return self.settings.power_limit_kw
        return float("inf")

    def get_safe_limit_pct(self, solar_capacity: float) -> float:
        """Get safe mode limit as percentage"""
        if not self._state.active:
            return 100.0

        if solar_capacity <= 0:
            return 0.0

        return (self.settings.power_limit_kw / solar_capacity) * 100

    def is_active(self) -> bool:
        """Check if safe mode is active"""
        return self._state.active

    def get_state(self) -> SafeModeState:
        """Get current safe mode state"""
        return self._state

    def reset(self) -> None:
        """Force reset safe mode"""
        logger.info("Safe mode manually reset")
        self._state.reset()
        SharedState.write("safe_mode_state", self._state.to_dict())
        SharedState.delete("safe_mode_trigger")
