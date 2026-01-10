"""
Structured Logging Setup

Consistent logging configuration across all services.
Uses JSON format for structured logs in production.
"""

import logging
import sys
import os
from datetime import datetime, timezone
from typing import Any
import json


class JsonFormatter(logging.Formatter):
    """JSON log formatter for structured logging"""

    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "service": getattr(record, "service", "unknown"),
            "message": record.getMessage(),
            "logger": record.name,
        }

        # Add exception info if present
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)

        # Add extra fields
        for key, value in record.__dict__.items():
            if key not in (
                "name", "msg", "args", "levelname", "levelno", "pathname",
                "filename", "module", "exc_info", "exc_text", "stack_info",
                "lineno", "funcName", "created", "msecs", "relativeCreated",
                "thread", "threadName", "processName", "process", "service",
                "message", "taskName",
            ):
                log_data[key] = value

        return json.dumps(log_data)


class ServiceLoggerAdapter(logging.LoggerAdapter):
    """Logger adapter that adds service name to all logs"""

    def process(self, msg: str, kwargs: dict) -> tuple[str, dict]:
        kwargs.setdefault("extra", {})
        kwargs["extra"]["service"] = self.extra.get("service", "unknown")
        return msg, kwargs


def setup_logging(
    service_name: str,
    log_level: str = "INFO",
    json_format: bool = True,
) -> logging.Logger:
    """
    Set up structured logging for a service.

    Args:
        service_name: Name of the service (e.g., "system", "control")
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        json_format: Use JSON format (True for production, False for dev)

    Returns:
        Configured logger instance
    """
    # Get numeric log level
    numeric_level = getattr(logging, log_level.upper(), logging.INFO)

    # Create logger
    logger = logging.getLogger(f"volteria.{service_name}")
    logger.setLevel(numeric_level)

    # Clear existing handlers
    logger.handlers.clear()

    # Create handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(numeric_level)

    # Set formatter
    if json_format:
        formatter = JsonFormatter()
    else:
        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

    handler.setFormatter(formatter)
    logger.addHandler(handler)

    # Don't propagate to root logger
    logger.propagate = False

    return logger


def get_service_logger(service_name: str) -> ServiceLoggerAdapter:
    """
    Get a logger adapter with service context.

    Args:
        service_name: Name of the service

    Returns:
        Logger adapter with service name in all logs
    """
    # Check for environment variable override
    log_level = os.environ.get("VOLTERIA_LOG_LEVEL", "INFO")
    json_format = os.environ.get("VOLTERIA_LOG_FORMAT", "json").lower() == "json"

    logger = setup_logging(service_name, log_level, json_format)
    return ServiceLoggerAdapter(logger, {"service": service_name})


class LogContext:
    """
    Context manager for adding temporary context to logs.

    Usage:
        with LogContext(logger, device_id="abc", operation="read"):
            logger.info("Reading device")
    """

    def __init__(self, logger: logging.Logger, **context: Any):
        self.logger = logger
        self.context = context
        self._original_factory = None

    def __enter__(self):
        self._original_factory = logging.getLogRecordFactory()

        def record_factory(*args, **kwargs):
            record = self._original_factory(*args, **kwargs)
            for key, value in self.context.items():
                setattr(record, key, value)
            return record

        logging.setLogRecordFactory(record_factory)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        logging.setLogRecordFactory(self._original_factory)
        return False


# Convenience loggers for common operations
def log_device_read(
    logger: logging.Logger,
    device_name: str,
    register: str,
    value: Any,
    success: bool = True,
) -> None:
    """Log a device register read operation"""
    if success:
        logger.debug(
            f"Read {device_name}.{register} = {value}",
            extra={"device": device_name, "register": register, "value": value},
        )
    else:
        logger.warning(
            f"Failed to read {device_name}.{register}",
            extra={"device": device_name, "register": register},
        )


def log_device_write(
    logger: logging.Logger,
    device_name: str,
    register: str,
    value: Any,
    success: bool = True,
) -> None:
    """Log a device register write operation"""
    if success:
        logger.info(
            f"Write {device_name}.{register} = {value}",
            extra={"device": device_name, "register": register, "value": value},
        )
    else:
        logger.error(
            f"Failed to write {device_name}.{register} = {value}",
            extra={"device": device_name, "register": register, "value": value},
        )


def log_control_loop(
    logger: logging.Logger,
    solar_limit_pct: float,
    total_load_kw: float,
    solar_output_kw: float,
    execution_time_ms: float,
) -> None:
    """Log control loop execution"""
    logger.info(
        f"Control loop: limit={solar_limit_pct:.1f}%, load={total_load_kw:.1f}kW, "
        f"solar={solar_output_kw:.1f}kW, exec={execution_time_ms:.0f}ms",
        extra={
            "solar_limit_pct": solar_limit_pct,
            "total_load_kw": total_load_kw,
            "solar_output_kw": solar_output_kw,
            "execution_time_ms": execution_time_ms,
        },
    )


def log_alarm(
    logger: logging.Logger,
    alarm_id: str,
    severity: str,
    message: str,
    device_name: str | None = None,
) -> None:
    """Log an alarm event"""
    log_method = {
        "info": logger.info,
        "warning": logger.warning,
        "major": logger.error,
        "critical": logger.critical,
    }.get(severity, logger.warning)

    log_method(
        f"ALARM [{severity.upper()}] {alarm_id}: {message}",
        extra={
            "alarm_id": alarm_id,
            "severity": severity,
            "device": device_name,
        },
    )
