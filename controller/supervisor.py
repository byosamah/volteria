"""
Volteria Controller Supervisor

Master process that orchestrates all services:
- Starts services in correct order (layer by layer)
- Monitors service health via HTTP endpoints
- Restarts failed services (3x max, then safe mode)
- Reports overall status
"""

import asyncio
import signal
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from common.logging_setup import get_service_logger
from common.state import SharedState, set_service_health

logger = get_service_logger("supervisor")

# Service definitions: (name, port, critical, module_path)
# Critical services trigger safe mode if unrecoverable
SERVICES = [
    ("system", 8081, True, "services.system.service"),
    ("config", 8082, True, "services.config.service"),
    ("device", 8083, True, "services.device.service"),
    ("control", 8084, True, "services.control.service"),
    ("logging", 8085, False, "services.logging.service"),
]

# Recovery settings
MAX_RESTART_ATTEMPTS = 3
RESTART_COOLDOWN_S = 10
HEALTH_CHECK_INTERVAL_S = 10
STARTUP_TIMEOUT_S = 30


class ServiceProcess:
    """Represents a managed service process"""

    def __init__(
        self,
        name: str,
        port: int,
        critical: bool,
        module_path: str,
    ):
        self.name = name
        self.port = port
        self.critical = critical
        self.module_path = module_path

        self.process: subprocess.Popen | None = None
        self.restart_count = 0
        self.last_restart: datetime | None = None
        self.is_healthy = False
        self.last_error: str | None = None

    def start(self) -> bool:
        """Start the service process"""
        if self.process and self.process.poll() is None:
            logger.warning(f"Service {self.name} already running")
            return True

        try:
            # Start service as subprocess
            self.process = subprocess.Popen(
                [sys.executable, "-m", self.module_path],
                cwd=str(Path(__file__).parent),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            logger.info(f"Started service {self.name} (PID: {self.process.pid})")
            return True

        except Exception as e:
            self.last_error = str(e)
            logger.error(f"Failed to start {self.name}: {e}")
            return False

    def stop(self, graceful: bool = True) -> bool:
        """Stop the service process"""
        if not self.process:
            return True

        try:
            if graceful:
                self.process.terminate()
                try:
                    self.process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
            else:
                self.process.kill()
                self.process.wait()

            logger.info(f"Stopped service {self.name}")
            self.process = None
            return True

        except Exception as e:
            self.last_error = str(e)
            logger.error(f"Failed to stop {self.name}: {e}")
            return False

    def is_running(self) -> bool:
        """Check if process is running"""
        if not self.process:
            return False
        return self.process.poll() is None

    async def check_health(self) -> bool:
        """Check service health via HTTP endpoint"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"http://127.0.0.1:{self.port}/health",
                    timeout=5.0,
                )
                if response.status_code == 200:
                    data = response.json()
                    self.is_healthy = data.get("status") == "healthy"
                    return self.is_healthy

        except Exception as e:
            self.last_error = str(e)

        self.is_healthy = False
        return False

    def to_dict(self) -> dict:
        """Convert to dictionary for status reporting"""
        return {
            "name": self.name,
            "port": self.port,
            "critical": self.critical,
            "is_running": self.is_running(),
            "is_healthy": self.is_healthy,
            "restart_count": self.restart_count,
            "last_error": self.last_error,
            "pid": self.process.pid if self.process else None,
        }


class Supervisor:
    """
    Master process that orchestrates all controller services.

    Features:
    - Starts services in dependency order
    - Monitors health via HTTP endpoints
    - Auto-restarts failed services (3x max)
    - Triggers safe mode if critical service unrecoverable
    """

    def __init__(self):
        self._services: dict[str, ServiceProcess] = {}
        self._running = False
        self._shutdown_event = asyncio.Event()
        self._safe_mode_triggered = False
        self._start_time = datetime.now(timezone.utc)

        # Initialize service processes
        for name, port, critical, module_path in SERVICES:
            self._services[name] = ServiceProcess(
                name=name,
                port=port,
                critical=critical,
                module_path=module_path,
            )

    async def start(self) -> None:
        """Start the supervisor and all services"""
        logger.info("Starting Volteria Controller Supervisor")
        self._running = True

        # Setup signal handlers
        self._setup_signal_handlers()

        # Start services in order
        await self._start_all_services()

        # Start monitoring loop
        monitor_task = asyncio.create_task(self._monitor_loop())

        # Update supervisor status
        self._update_status()

        logger.info("Supervisor started, monitoring services")

        # Wait for shutdown signal
        await self._shutdown_event.wait()

        # Cleanup
        monitor_task.cancel()
        try:
            await monitor_task
        except asyncio.CancelledError:
            pass

        await self._stop_all_services()
        logger.info("Supervisor stopped")

    async def _start_all_services(self) -> None:
        """Start all services in order"""
        for name in ["system", "config", "device", "control", "logging"]:
            service = self._services[name]

            logger.info(f"Starting service: {name}")

            if not service.start():
                logger.error(f"Failed to start {name}")
                if service.critical:
                    await self._trigger_safe_mode(f"Critical service {name} failed to start")
                continue

            # Wait for service to become healthy
            healthy = await self._wait_for_health(service, timeout=STARTUP_TIMEOUT_S)

            if not healthy:
                logger.warning(f"Service {name} not healthy after startup")
                if service.critical:
                    await self._trigger_safe_mode(f"Critical service {name} not healthy")

            # Small delay between service starts
            await asyncio.sleep(1)

    async def _stop_all_services(self, graceful: bool = True) -> None:
        """Stop all services in reverse order"""
        for name in reversed(["system", "config", "device", "control", "logging"]):
            service = self._services[name]
            if service.is_running():
                logger.info(f"Stopping service: {name}")
                service.stop(graceful=graceful)
                await asyncio.sleep(0.5)

    async def _wait_for_health(self, service: ServiceProcess, timeout: float) -> bool:
        """Wait for service to become healthy"""
        start = datetime.now(timezone.utc)

        while (datetime.now(timezone.utc) - start).total_seconds() < timeout:
            if await service.check_health():
                return True
            await asyncio.sleep(1)

        return False

    async def _monitor_loop(self) -> None:
        """Continuous health monitoring loop"""
        restart_counts: dict[str, int] = {}

        while self._running:
            try:
                for name, service in self._services.items():
                    # Check if process is running
                    if not service.is_running():
                        logger.warning(f"Service {name} not running")
                        await self._handle_service_failure(service, restart_counts)
                        continue

                    # Check health endpoint
                    is_healthy = await service.check_health()

                    if not is_healthy:
                        logger.warning(f"Service {name} unhealthy")
                        await self._handle_service_failure(service, restart_counts)
                    else:
                        # Reset restart count on healthy
                        restart_counts[name] = 0

                # Update overall status
                self._update_status()

            except Exception as e:
                logger.error(f"Monitor loop error: {e}")

            await asyncio.sleep(HEALTH_CHECK_INTERVAL_S)

    async def _handle_service_failure(
        self,
        service: ServiceProcess,
        restart_counts: dict[str, int],
    ) -> None:
        """Handle a failed service with restart policy"""
        count = restart_counts.get(service.name, 0)

        if count < MAX_RESTART_ATTEMPTS:
            logger.warning(
                f"Restarting {service.name} (attempt {count + 1}/{MAX_RESTART_ATTEMPTS})"
            )

            # Stop if still running
            if service.is_running():
                service.stop(graceful=False)

            await asyncio.sleep(RESTART_COOLDOWN_S)

            # Restart
            if service.start():
                service.restart_count += 1
                restart_counts[service.name] = count + 1

                # Wait for health
                await self._wait_for_health(service, timeout=STARTUP_TIMEOUT_S)
            else:
                restart_counts[service.name] = count + 1

        else:
            # Max restarts exceeded
            logger.critical(
                f"Service {service.name} failed after {MAX_RESTART_ATTEMPTS} restarts"
            )

            if service.critical:
                await self._trigger_safe_mode(
                    f"Critical service {service.name} unrecoverable"
                )

    async def _trigger_safe_mode(self, reason: str) -> None:
        """Trigger safe mode due to critical failure"""
        if self._safe_mode_triggered:
            return

        self._safe_mode_triggered = True
        logger.critical(f"SAFE MODE TRIGGERED: {reason}")

        # Write safe mode state
        SharedState.write("safe_mode_override", {
            "active": True,
            "reason": reason,
            "triggered_at": datetime.now(timezone.utc).isoformat(),
            "triggered_by": "supervisor",
        })

        # Update status
        self._update_status()

    def _update_status(self) -> None:
        """Update supervisor status in shared state"""
        services_status = {}
        all_healthy = True
        all_critical_healthy = True

        for name, service in self._services.items():
            services_status[name] = {
                "status": "running" if service.is_healthy else "unhealthy",
                "pid": service.process.pid if service.process else None,
                "restart_count": service.restart_count,
            }

            if not service.is_healthy:
                all_healthy = False
                if service.critical:
                    all_critical_healthy = False

        uptime = (datetime.now(timezone.utc) - self._start_time).total_seconds()

        status = {
            "status": "healthy" if all_critical_healthy else "degraded",
            "is_healthy": all_healthy,
            "safe_mode_active": self._safe_mode_triggered,
            "uptime_seconds": int(uptime),
            "services": services_status,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        set_service_health("supervisor", status)

    def _setup_signal_handlers(self) -> None:
        """Setup graceful shutdown signal handlers"""
        loop = asyncio.get_event_loop()

        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, self._handle_shutdown)
            except NotImplementedError:
                # Windows doesn't support add_signal_handler
                signal.signal(sig, lambda s, f: self._handle_shutdown())

    def _handle_shutdown(self) -> None:
        """Handle shutdown signal"""
        logger.info("Received shutdown signal")
        self._running = False
        self._shutdown_event.set()

    def get_status(self) -> dict[str, Any]:
        """Get current supervisor status"""
        return {
            "running": self._running,
            "safe_mode": self._safe_mode_triggered,
            "uptime": (datetime.now(timezone.utc) - self._start_time).total_seconds(),
            "services": {
                name: service.to_dict()
                for name, service in self._services.items()
            },
        }


async def main() -> None:
    """Main entry point"""
    supervisor = Supervisor()

    try:
        await supervisor.start()
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    except Exception as e:
        logger.critical(f"Supervisor failed: {e}")
        raise


if __name__ == "__main__":
    asyncio.run(main())
