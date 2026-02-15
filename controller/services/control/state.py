"""
Control State Dataclasses

Data structures for control algorithm state.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class ControlOutput:
    """Output from control algorithm"""
    solar_limit_pct: float = 100.0
    solar_limit_kw: float = 0.0
    battery_discharge_kw: float = 0.0
    reactive_power_kvar: float = 0.0
    actions: dict[str, bool] = field(default_factory=dict)
    # actions: {"write_inverter_limit": True, "charge_battery": False, ...}


@dataclass
class ControlState:
    """Complete control loop state"""
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Inputs
    total_load_kw: float = 0.0
    solar_output_kw: float = 0.0
    dg_power_kw: float = 0.0
    dg_reserve_kw: float = 0.0

    # Calculated
    available_headroom_kw: float = 0.0
    solar_capacity_kw: float = 0.0

    # Output
    solar_limit_pct: float = 100.0
    solar_limit_kw: float = 0.0

    # Safe mode
    safe_mode_active: bool = False
    safe_mode_reason: str | None = None

    # Status
    config_mode: str = "full_system"
    operation_mode: str = "zero_dg_reverse"

    # Device counts
    load_meters_online: int = 0
    inverters_online: int = 0
    generators_online: int = 0

    # Execution
    execution_time_ms: float = 0.0
    write_success: bool = True
    write_error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for logging"""
        result = {
            "timestamp": self.timestamp.isoformat(),
            "total_load_kw": self.total_load_kw,
            "solar_output_kw": self.solar_output_kw,
            "dg_power_kw": self.dg_power_kw,
            "dg_reserve_kw": self.dg_reserve_kw,
            "available_headroom_kw": self.available_headroom_kw,
            "solar_capacity_kw": self.solar_capacity_kw,
            "solar_limit_pct": self.solar_limit_pct,
            "solar_limit_kw": self.solar_limit_kw,
            "safe_mode_active": self.safe_mode_active,
            "safe_mode_reason": self.safe_mode_reason,
            "config_mode": self.config_mode,
            "operation_mode": self.operation_mode,
            "load_meters_online": self.load_meters_online,
            "inverters_online": self.inverters_online,
            "generators_online": self.generators_online,
            "execution_time_ms": self.execution_time_ms,
            "write_success": self.write_success,
            "write_error": self.write_error,
        }
        return result


@dataclass
class SafeModeState:
    """Safe mode state tracking"""
    active: bool = False
    triggered_at: datetime | None = None
    trigger_reason: str | None = None
    trigger_service: str | None = None

    # Rolling window data
    power_readings: list[tuple[datetime, float, float]] = field(default_factory=list)
    # (timestamp, load_kw, solar_kw)

    def is_triggered(self) -> bool:
        return self.active

    def trigger(self, reason: str, service: str | None = None) -> None:
        self.active = True
        self.triggered_at = datetime.now(timezone.utc)
        self.trigger_reason = reason
        self.trigger_service = service

    def reset(self) -> None:
        self.active = False
        self.triggered_at = None
        self.trigger_reason = None
        self.trigger_service = None

    def to_dict(self) -> dict:
        return {
            "active": self.active,
            "triggered_at": self.triggered_at.isoformat() if self.triggered_at else None,
            "trigger_reason": self.trigger_reason,
            "trigger_service": self.trigger_service,
        }
