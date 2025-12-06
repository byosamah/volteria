"""
Safe Mode Manager

Implements safety mechanisms to prevent reverse feeding when
communication is lost or system is in an unsafe state.

Two modes available:
1. Time-based: Triggers when any device stops reporting for timeout period
2. Rolling Average: Triggers when solar is high AND device is offline

When triggered, safe mode sets solar limit to 0% to prevent any
risk of reverse feeding to diesel generators.
"""

import logging
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional, Callable

logger = logging.getLogger(__name__)


class SafeModeType(Enum):
    """Safe mode trigger types."""
    TIME_BASED = "time_based"
    ROLLING_AVERAGE = "rolling_average"


@dataclass
class DeviceStatus:
    """Status of a device for safe mode tracking."""
    name: str
    device_type: str  # 'inverter', 'load_meter', 'dg'
    last_seen: datetime
    is_online: bool


@dataclass
class SafeModeState:
    """Current state of safe mode."""
    is_active: bool
    triggered_at: Optional[datetime]
    trigger_reason: Optional[str]
    affected_device: Optional[str]


class SafeModeManager:
    """
    Manages safe mode detection and activation.

    Safe mode is a protective mechanism that sets solar output to 0%
    when the system cannot reliably calculate the safe limit.
    """

    def __init__(
        self,
        mode_type: SafeModeType = SafeModeType.ROLLING_AVERAGE,
        timeout_s: int = 30,
        rolling_window_min: int = 3,
        threshold_pct: float = 80.0,
        on_trigger: Optional[Callable[[str, str], None]] = None
    ):
        """
        Initialize safe mode manager.

        Args:
            mode_type: Which safe mode algorithm to use
            timeout_s: Seconds before device is considered offline (time-based)
            rolling_window_min: Minutes for rolling average calculation
            threshold_pct: Solar % of load threshold for danger (rolling average)
            on_trigger: Callback when safe mode triggers (for alarms)
        """
        self.mode_type = mode_type
        self.timeout_s = timeout_s
        self.rolling_window_min = rolling_window_min
        self.threshold_pct = threshold_pct
        self.on_trigger = on_trigger

        # State tracking
        self.state = SafeModeState(
            is_active=False,
            triggered_at=None,
            trigger_reason=None,
            affected_device=None
        )

        # Device tracking
        self._device_last_seen: dict[str, datetime] = {}

        # Rolling average data (for rolling_average mode)
        # Each entry: (timestamp, solar_kw, load_kw)
        self._power_history: deque = deque(maxlen=600)  # 10 min at 1s intervals

        logger.info(f"Safe mode initialized: type={mode_type.value}, "
                   f"timeout={timeout_s}s, threshold={threshold_pct}%")

    # ============================================
    # DEVICE TRACKING
    # ============================================

    def update_device_status(self, name: str, is_online: bool):
        """
        Update device online status.

        Called by control loop after each device read.

        Args:
            name: Device name
            is_online: Whether device responded
        """
        if is_online:
            self._device_last_seen[name] = datetime.now()

    def get_offline_devices(self) -> list[str]:
        """
        Get list of devices that have been offline too long.

        Returns:
            List of device names that haven't responded within timeout
        """
        now = datetime.now()
        cutoff = now - timedelta(seconds=self.timeout_s)

        offline = []
        for name, last_seen in self._device_last_seen.items():
            if last_seen < cutoff:
                offline.append(name)

        return offline

    # ============================================
    # POWER TRACKING (for rolling average)
    # ============================================

    def record_power(self, solar_kw: float, load_kw: float):
        """
        Record power readings for rolling average calculation.

        Args:
            solar_kw: Current solar output
            load_kw: Current total load
        """
        self._power_history.append((
            datetime.now(),
            solar_kw,
            load_kw
        ))

    def get_rolling_average(self) -> tuple[float, float]:
        """
        Calculate rolling average of solar and load.

        Uses data from the last rolling_window_min minutes.

        Returns:
            Tuple of (avg_solar_kw, avg_load_kw)
        """
        if not self._power_history:
            return 0.0, 0.0

        cutoff = datetime.now() - timedelta(minutes=self.rolling_window_min)

        # Filter to window
        in_window = [
            (solar, load) for ts, solar, load in self._power_history
            if ts >= cutoff
        ]

        if not in_window:
            return 0.0, 0.0

        avg_solar = sum(s for s, l in in_window) / len(in_window)
        avg_load = sum(l for s, l in in_window) / len(in_window)

        return avg_solar, avg_load

    # ============================================
    # SAFE MODE CHECK
    # ============================================

    def check(self) -> SafeModeState:
        """
        Check if safe mode should be triggered.

        Call this every control cycle.

        Returns:
            Current safe mode state
        """
        if self.mode_type == SafeModeType.TIME_BASED:
            return self._check_time_based()
        else:
            return self._check_rolling_average()

    def _check_time_based(self) -> SafeModeState:
        """
        Time-based safe mode check.

        Triggers when any device stops responding for timeout period.
        """
        offline_devices = self.get_offline_devices()

        if offline_devices:
            # Trigger safe mode
            if not self.state.is_active:
                self._trigger(
                    reason=f"Device offline for {self.timeout_s}s",
                    device=offline_devices[0]
                )
        else:
            # Clear safe mode if all devices online
            if self.state.is_active:
                self._clear()

        return self.state

    def _check_rolling_average(self) -> SafeModeState:
        """
        Rolling average safe mode check.

        Triggers when BOTH conditions are met:
        1. Solar average > (load * threshold%)
        2. At least one device is offline

        This prevents false triggers during normal high-solar operation.
        """
        offline_devices = self.get_offline_devices()

        if not offline_devices:
            # All devices online - clear safe mode
            if self.state.is_active:
                self._clear()
            return self.state

        # At least one device offline - check solar ratio
        avg_solar, avg_load = self.get_rolling_average()

        # Avoid division by zero
        if avg_load <= 0:
            # No load data - can't calculate ratio
            # If device offline and no load data, trigger for safety
            if not self.state.is_active:
                self._trigger(
                    reason="Device offline and no load data",
                    device=offline_devices[0]
                )
            return self.state

        # Calculate solar as percentage of load
        solar_pct = (avg_solar / avg_load) * 100

        if solar_pct > self.threshold_pct:
            # High solar AND device offline - dangerous!
            if not self.state.is_active:
                self._trigger(
                    reason=f"Solar at {solar_pct:.1f}% of load (>{self.threshold_pct}%) "
                           f"with device offline",
                    device=offline_devices[0]
                )
        else:
            # Solar below threshold - can clear even if device offline
            # (low solar means low risk of reverse feeding)
            if self.state.is_active:
                logger.info(f"Solar at {solar_pct:.1f}% (below threshold), "
                           "clearing safe mode despite offline device")
                self._clear()

        return self.state

    # ============================================
    # STATE MANAGEMENT
    # ============================================

    def _trigger(self, reason: str, device: str):
        """Trigger safe mode."""
        self.state = SafeModeState(
            is_active=True,
            triggered_at=datetime.now(),
            trigger_reason=reason,
            affected_device=device
        )

        logger.warning(f"SAFE MODE TRIGGERED: {reason} (device: {device})")

        # Fire callback for alarm generation
        if self.on_trigger:
            self.on_trigger(reason, device)

    def _clear(self):
        """Clear safe mode."""
        duration = None
        if self.state.triggered_at:
            duration = (datetime.now() - self.state.triggered_at).total_seconds()

        self.state = SafeModeState(
            is_active=False,
            triggered_at=None,
            trigger_reason=None,
            affected_device=None
        )

        if duration:
            logger.info(f"Safe mode cleared (was active for {duration:.1f}s)")
        else:
            logger.info("Safe mode cleared")

    def force_clear(self):
        """
        Force clear safe mode.

        Use with caution - only for manual override or testing.
        """
        logger.warning("Safe mode FORCE CLEARED by manual override")
        self._clear()

    # ============================================
    # STATUS
    # ============================================

    def get_status(self) -> dict:
        """Get safe mode status for logging/display."""
        avg_solar, avg_load = self.get_rolling_average()

        return {
            "mode_type": self.mode_type.value,
            "is_active": self.state.is_active,
            "triggered_at": self.state.triggered_at.isoformat() if self.state.triggered_at else None,
            "trigger_reason": self.state.trigger_reason,
            "affected_device": self.state.affected_device,
            "offline_devices": self.get_offline_devices(),
            "rolling_avg_solar_kw": round(avg_solar, 2),
            "rolling_avg_load_kw": round(avg_load, 2),
            "threshold_pct": self.threshold_pct,
            "timeout_s": self.timeout_s
        }
