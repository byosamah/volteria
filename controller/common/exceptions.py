"""
Custom Exception Classes for Volteria Controller

Hierarchical exception structure for error handling across services.
"""


class VolteriaError(Exception):
    """Base exception for all Volteria controller errors"""

    def __init__(self, message: str, recoverable: bool = True):
        self.message = message
        self.recoverable = recoverable
        super().__init__(message)


class ConfigError(VolteriaError):
    """Configuration-related errors"""

    def __init__(self, message: str, recoverable: bool = True):
        super().__init__(f"Config Error: {message}", recoverable)


class DeviceError(VolteriaError):
    """Device communication errors"""

    def __init__(
        self,
        message: str,
        device_id: str | None = None,
        device_name: str | None = None,
        recoverable: bool = True,
    ):
        self.device_id = device_id
        self.device_name = device_name
        super().__init__(f"Device Error: {message}", recoverable)


class CommunicationError(DeviceError):
    """Modbus/network communication errors"""

    def __init__(
        self,
        message: str,
        device_id: str | None = None,
        device_name: str | None = None,
        host: str | None = None,
        port: int | None = None,
    ):
        self.host = host
        self.port = port
        super().__init__(message, device_id, device_name, recoverable=True)


class ControlError(VolteriaError):
    """Control algorithm errors"""

    def __init__(self, message: str, recoverable: bool = False):
        super().__init__(f"Control Error: {message}", recoverable)


class SafeModeError(ControlError):
    """Safe mode triggered errors"""

    def __init__(self, message: str, trigger_reason: str):
        self.trigger_reason = trigger_reason
        super().__init__(f"Safe Mode: {message}", recoverable=True)


class WriteError(DeviceError):
    """Register write failed errors"""

    def __init__(
        self,
        message: str,
        device_id: str | None = None,
        device_name: str | None = None,
        register: int | None = None,
        value: int | None = None,
    ):
        self.register = register
        self.value = value
        super().__init__(message, device_id, device_name, recoverable=True)


class CommandNotTakenError(WriteError):
    """Inverter rejected limit command"""

    def __init__(
        self,
        device_id: str | None = None,
        device_name: str | None = None,
        register: int | None = None,
        expected_value: int | None = None,
        actual_value: int | None = None,
    ):
        self.expected_value = expected_value
        self.actual_value = actual_value
        message = f"Command not taken: expected {expected_value}, got {actual_value}"
        super().__init__(message, device_id, device_name, register, expected_value)


class SyncError(VolteriaError):
    """Cloud synchronization errors"""

    def __init__(self, message: str, operation: str | None = None):
        self.operation = operation
        super().__init__(f"Sync Error: {message}", recoverable=True)


class ServiceError(VolteriaError):
    """Service lifecycle errors"""

    def __init__(self, message: str, service_name: str, recoverable: bool = True):
        self.service_name = service_name
        super().__init__(f"Service [{service_name}]: {message}", recoverable)


class CircuitOpenError(VolteriaError):
    """Circuit breaker is open - too many failures"""

    def __init__(self, service_name: str, failure_count: int):
        self.service_name = service_name
        self.failure_count = failure_count
        super().__init__(
            f"Circuit open for {service_name} after {failure_count} failures",
            recoverable=False,
        )
