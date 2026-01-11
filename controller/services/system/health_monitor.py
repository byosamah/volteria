"""
Health Monitor

Monitors the health of other services with the 3x restart policy.
After 3 failed restarts, triggers safe mode and alerts.
"""

import asyncio
from datetime import datetime, timezone
from dataclasses import dataclass, field
from typing import Callable, Awaitable

import httpx

from common.state import SharedState, set_service_health
from common.logging_setup import get_service_logger

logger = get_service_logger("system.health_monitor")


@dataclass
class ServiceInfo:
    """Service configuration for monitoring"""
    name: str
    port: int
    critical: bool = True
    health_endpoint: str = "/health"
    restart_command: str | None = None


@dataclass
class ServiceStatus:
    """Current status of a service"""
    name: str
    status: str  # running, stopped, error, starting
    is_healthy: bool
    uptime_seconds: int | None = None
    last_error: str | None = None
    restart_count: int = 0
    last_check: str = ""


class HealthMonitor:
    """
    Monitors service health with 3x restart policy.

    Policy:
    1. Service fails → Auto restart (attempt 1/3)
    2. Fails again → Auto restart (attempt 2/3)
    3. Fails again → Auto restart (attempt 3/3)
    4. Fails 4th time → Alert + trigger safe mode
    """

    SERVICES: list[ServiceInfo] = [
        ServiceInfo("config", 8082, critical=True),
        ServiceInfo("device", 8083, critical=True),
        ServiceInfo("control", 8084, critical=True),
        ServiceInfo("logging", 8085, critical=False),
    ]

    MAX_RESTART_ATTEMPTS = 3
    CHECK_INTERVAL_SECONDS = 10
    HEALTH_TIMEOUT_SECONDS = 5

    def __init__(
        self,
        on_safe_mode_trigger: Callable[[str], Awaitable[None]] | None = None,
        on_alert: Callable[[str, str], Awaitable[None]] | None = None,
    ):
        self._running = False
        self._task: asyncio.Task | None = None
        self._service_status: dict[str, ServiceStatus] = {}
        self._on_safe_mode_trigger = on_safe_mode_trigger
        self._on_alert = on_alert

        # Initialize status for all services
        for svc in self.SERVICES:
            self._service_status[svc.name] = ServiceStatus(
                name=svc.name,
                status="unknown",
                is_healthy=False,
            )

    async def start(self) -> None:
        """Start health monitoring"""
        self._running = True
        self._task = asyncio.create_task(self._monitor_loop())
        logger.info(f"Health monitor started (interval: {self.CHECK_INTERVAL_SECONDS}s)")

    async def stop(self) -> None:
        """Stop health monitoring"""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Health monitor stopped")

    async def _monitor_loop(self) -> None:
        """Main monitoring loop"""
        while self._running:
            for service_info in self.SERVICES:
                await self._check_service(service_info)

            # Update shared state with all service health
            await self._update_shared_health()

            await asyncio.sleep(self.CHECK_INTERVAL_SECONDS)

    async def _check_service(self, service_info: ServiceInfo) -> None:
        """Check a single service health"""
        status = self._service_status[service_info.name]

        try:
            is_healthy = await self._ping_health(service_info)

            if is_healthy:
                # Service is healthy - reset restart count
                status.status = "running"
                status.is_healthy = True
                status.restart_count = 0
                status.last_error = None
            else:
                await self._handle_unhealthy(service_info, status, "Health check failed")

        except Exception as e:
            await self._handle_unhealthy(service_info, status, str(e))

        status.last_check = datetime.now(timezone.utc).isoformat()

    async def _ping_health(self, service_info: ServiceInfo) -> bool:
        """Ping service health endpoint"""
        url = f"http://127.0.0.1:{service_info.port}{service_info.health_endpoint}"

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    url,
                    timeout=self.HEALTH_TIMEOUT_SECONDS,
                )

                if response.status_code == 200:
                    data = response.json()
                    status = self._service_status[service_info.name]
                    status.uptime_seconds = data.get("uptime")
                    return data.get("status") == "healthy"

            return False

        except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPError):
            return False

    async def _handle_unhealthy(
        self,
        service_info: ServiceInfo,
        status: ServiceStatus,
        error: str,
    ) -> None:
        """Handle unhealthy service - monitor and report only.

        Note: We don't restart services here because:
        1. Systemd handles restarts via Restart=on-failure
        2. NoNewPrivileges security hardening prevents sudo
        3. Having one restart mechanism (systemd) is cleaner
        """
        status.is_healthy = False
        status.last_error = error
        status.status = "error"

        # Track consecutive failures for alerting
        status.restart_count += 1

        if status.restart_count <= self.MAX_RESTART_ATTEMPTS:
            # Log warning - systemd will handle the restart
            logger.warning(
                f"Service {service_info.name} unhealthy "
                f"({status.restart_count}/{self.MAX_RESTART_ATTEMPTS} failures)",
                extra={
                    "service": service_info.name,
                    "failure_count": status.restart_count,
                    "error": error,
                },
            )
        else:
            # Multiple failures - alert but let systemd continue handling it
            if status.restart_count == self.MAX_RESTART_ATTEMPTS + 1:
                logger.error(
                    f"Service {service_info.name} has failed {status.restart_count} times",
                    extra={"service": service_info.name},
                )

                # Send alert
                if self._on_alert:
                    await self._on_alert(
                        service_info.name,
                        f"Service {service_info.name} repeatedly unhealthy: {error}",
                    )

                # Trigger safe mode for critical services
                if service_info.critical and self._on_safe_mode_trigger:
                    await self._on_safe_mode_trigger(service_info.name)

    async def _restart_service(self, service_info: ServiceInfo) -> None:
        """Restart a service via systemd"""
        import subprocess

        service_name = f"volteria-{service_info.name}"

        try:
            # Use systemctl to restart
            result = subprocess.run(
                ["sudo", "systemctl", "restart", service_name],
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode == 0:
                logger.info(f"Restarted service: {service_name}")
            else:
                logger.error(
                    f"Failed to restart {service_name}: {result.stderr}",
                    extra={"stderr": result.stderr},
                )

        except subprocess.TimeoutExpired:
            logger.error(f"Timeout restarting {service_name}")
        except FileNotFoundError:
            # systemctl not available (Windows dev)
            logger.warning(
                f"systemctl not available, cannot restart {service_name}"
            )

    async def _update_shared_health(self) -> None:
        """Update shared state with all service health"""
        health_data = {}

        for name, status in self._service_status.items():
            health_data[name] = {
                "status": status.status,
                "is_healthy": status.is_healthy,
                "uptime_seconds": status.uptime_seconds,
                "last_error": status.last_error,
                "restart_count": status.restart_count,
                "last_check": status.last_check,
            }

        SharedState.write("service_health", health_data)

    def get_status(self, service_name: str) -> ServiceStatus | None:
        """Get current status of a service"""
        return self._service_status.get(service_name)

    def get_all_status(self) -> dict[str, ServiceStatus]:
        """Get status of all services"""
        return self._service_status.copy()

    def are_critical_services_healthy(self) -> bool:
        """Check if all critical services are healthy"""
        for service_info in self.SERVICES:
            if service_info.critical:
                status = self._service_status.get(service_info.name)
                if status and not status.is_healthy:
                    return False
        return True
