"""
Common Utilities

Shared modules used across all services:
- state.py - Shared file-based state management
- config.py - Configuration dataclasses
- exceptions.py - Custom exception classes
- logging_setup.py - Structured logging setup
"""

from .state import SharedState
from .config import (
    SiteConfig,
    DeviceConfig,
    ServiceConfig,
    ControllerConfig,
    ModbusRegister,
    AlarmDefinition,
    AlarmCondition,
    CalculatedField,
    ModeSettings,
    LoggingSettings,
    SafeModeSettings,
    OperationMode,
    ConfigMode,
    SafeModeType,
    DeviceType,
    Protocol,
    RegisterDataType,
    load_site_config,
)
from .exceptions import (
    VolteriaError,
    ConfigError,
    DeviceError,
    ControlError,
    CommunicationError,
    SafeModeError,
    WriteError,
    CommandNotTakenError,
    SyncError,
    ServiceError,
    CircuitOpenError,
)
from .logging_setup import (
    setup_logging,
    get_service_logger,
    LogContext,
    log_device_read,
    log_device_write,
    log_control_loop,
    log_alarm,
)

__all__ = [
    # State
    "SharedState",
    # Config
    "SiteConfig",
    "DeviceConfig",
    "ServiceConfig",
    "ControllerConfig",
    "ModbusRegister",
    "AlarmDefinition",
    "AlarmCondition",
    "CalculatedField",
    "ModeSettings",
    "LoggingSettings",
    "SafeModeSettings",
    "OperationMode",
    "ConfigMode",
    "SafeModeType",
    "DeviceType",
    "Protocol",
    "RegisterDataType",
    "load_site_config",
    # Exceptions
    "VolteriaError",
    "ConfigError",
    "DeviceError",
    "ControlError",
    "CommunicationError",
    "SafeModeError",
    "WriteError",
    "CommandNotTakenError",
    "SyncError",
    "ServiceError",
    "CircuitOpenError",
    # Logging
    "setup_logging",
    "get_service_logger",
    "LogContext",
    "log_device_read",
    "log_device_write",
    "log_control_loop",
    "log_alarm",
]
