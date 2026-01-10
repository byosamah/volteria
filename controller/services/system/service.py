"""
System Service (Layer 1) - Always Alive

The system service is the foundation of the controller architecture.
It MUST always be running and is responsible for:
- Sending heartbeats to cloud
- Monitoring health of other services
- Handling OTA updates
- Processing reboot commands

This service runs as a systemd service with Restart=always.
"""

import asyncio
import os
import signal
from datetime import datetime, timezone
from pathlib import Path

import yaml
from aiohttp import web

from common.state import SharedState, set_service_health
from common.logging_setup import get_service_logger

from .heartbeat import HeartbeatSender
from .health_monitor import HealthMonitor
from .ota_updater import OTAUpdater
from .reboot_handler import RebootHandler
from .metrics_collector import MetricsCollector

logger = get_service_logger("system")

# Health server port
HEALTH_PORT = 8081


class SystemService:
    """
    System Service - Layer 1

    Always alive service responsible for:
    - Heartbeat (every 30 seconds)
    - Health monitoring of other services
    - OTA updates with manual approval
    - Reboot command handling
    """

    def __init__(self, config_path: str | None = None):
        self.config_path = config_path or self._find_config_path()
        self.config = self._load_config()

        # Extract configuration
        self.controller_id = self.config.get("controller", {}).get("id")
        self.site_id = self.config.get("site", {}).get("id")
        self.firmware_version = self.config.get("controller", {}).get("firmware_version", "2.0.0")
        self.hardware_type_id = self.config.get("controller", {}).get("hardware_type_id")

        # Cloud configuration
        cloud_config = self.config.get("cloud", {})
        self.supabase_url = cloud_config.get("url") or os.environ.get("SUPABASE_URL", "")
        self.supabase_key = cloud_config.get("key") or os.environ.get("SUPABASE_SERVICE_KEY", "")

        # Initialize components
        self.metrics_collector = MetricsCollector()

        self.heartbeat_sender = HeartbeatSender(
            controller_id=self.controller_id,
            site_id=self.site_id,
            supabase_url=self.supabase_url,
            supabase_key=self.supabase_key,
            firmware_version=self.firmware_version,
            interval_seconds=30,
        )

        self.health_monitor = HealthMonitor(
            on_safe_mode_trigger=self._on_safe_mode_trigger,
            on_alert=self._on_alert,
        )

        self.ota_updater = OTAUpdater(
            controller_id=self.controller_id,
            current_version=self.firmware_version,
            hardware_type_id=self.hardware_type_id or "",
            supabase_url=self.supabase_url,
            supabase_key=self.supabase_key,
        )

        self.reboot_handler = RebootHandler(
            controller_id=self.controller_id,
            supabase_url=self.supabase_url,
            supabase_key=self.supabase_key,
            heartbeat_callback=self.heartbeat_sender.send_immediate,
        )

        # Health server
        self._health_app: web.Application | None = None
        self._health_runner: web.AppRunner | None = None

        # Shutdown event
        self._shutdown_event = asyncio.Event()
        self._is_running = False

    def _find_config_path(self) -> str:
        """Find configuration file"""
        possible_paths = [
            "/etc/volteria/config.yaml",
            "/opt/volteria/config.yaml",
            Path(__file__).parent.parent.parent / "config.yaml",
        ]

        for path in possible_paths:
            path = Path(path)
            if path.exists():
                return str(path)

        return str(possible_paths[0])

    def _load_config(self) -> dict:
        """Load configuration from YAML file"""
        try:
            with open(self.config_path, "r") as f:
                return yaml.safe_load(f) or {}
        except FileNotFoundError:
            logger.warning(f"Config file not found: {self.config_path}")
            return {}
        except yaml.YAMLError as e:
            logger.error(f"Error parsing config: {e}")
            return {}

    async def start(self) -> None:
        """Start the system service"""
        logger.info("Starting System Service")

        self._is_running = True

        # Update service health
        set_service_health("system", {
            "status": "starting",
            "is_healthy": False,
        })

        # Check for post-reboot status
        await self.reboot_handler.check_post_reboot()

        # Start health server
        await self._start_health_server()

        # Start all components
        await self.heartbeat_sender.start()
        await self.health_monitor.start()
        await self.ota_updater.start()
        await self.reboot_handler.start()

        # Update service health to running
        set_service_health("system", {
            "status": "running",
            "is_healthy": True,
            "started_at": datetime.now(timezone.utc).isoformat(),
        })

        logger.info(
            f"System Service started (controller: {self.controller_id})",
            extra={
                "controller_id": self.controller_id,
                "site_id": self.site_id,
                "firmware_version": self.firmware_version,
            },
        )

        # Setup signal handlers
        self._setup_signal_handlers()

        # Wait for shutdown
        await self._shutdown_event.wait()

    async def stop(self) -> None:
        """Stop the system service"""
        logger.info("Stopping System Service")

        self._is_running = False

        # Stop all components
        await self.reboot_handler.stop()
        await self.ota_updater.stop()
        await self.health_monitor.stop()
        await self.heartbeat_sender.stop()

        # Stop health server
        await self._stop_health_server()

        # Update service health
        set_service_health("system", {
            "status": "stopped",
            "is_healthy": False,
        })

        logger.info("System Service stopped")

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
        self._shutdown_event.set()

    async def _start_health_server(self) -> None:
        """Start the health check HTTP server"""
        self._health_app = web.Application()
        self._health_app.router.add_get("/health", self._health_handler)

        self._health_runner = web.AppRunner(self._health_app)
        await self._health_runner.setup()

        site = web.TCPSite(self._health_runner, "127.0.0.1", HEALTH_PORT)
        await site.start()

        logger.info(f"Health server started on port {HEALTH_PORT}")

    async def _stop_health_server(self) -> None:
        """Stop the health check HTTP server"""
        if self._health_runner:
            await self._health_runner.cleanup()

    async def _health_handler(self, request: web.Request) -> web.Response:
        """Handle health check requests"""
        metrics = self.metrics_collector.collect()

        return web.json_response({
            "status": "healthy" if self._is_running else "unhealthy",
            "service": "system",
            "uptime": metrics.uptime_seconds,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "components": {
                "heartbeat": "running" if self.heartbeat_sender._running else "stopped",
                "health_monitor": "running" if self.health_monitor._running else "stopped",
                "ota_updater": "running" if self.ota_updater._running else "stopped",
                "reboot_handler": "running" if self.reboot_handler._running else "stopped",
            },
        })

    async def _on_safe_mode_trigger(self, service_name: str) -> None:
        """Callback when safe mode is triggered due to service failure"""
        logger.critical(
            f"Safe mode triggered due to {service_name} failure",
            extra={"trigger_service": service_name},
        )

        # Write safe mode trigger to shared state
        SharedState.write("safe_mode_trigger", {
            "triggered": True,
            "reason": f"Service {service_name} unrecoverable",
            "triggered_at": datetime.now(timezone.utc).isoformat(),
        })

        # Send immediate heartbeat with safe mode status
        await self.heartbeat_sender.send_immediate()

    async def _on_alert(self, service_name: str, message: str) -> None:
        """Callback for sending alerts"""
        logger.error(f"ALERT: {message}", extra={"service": service_name})

        # Write alert to pending alarms for cloud sync
        alerts = SharedState.read("pending_alerts")
        if "alerts" not in alerts:
            alerts["alerts"] = []

        alerts["alerts"].append({
            "type": "service_failure",
            "service": service_name,
            "message": message,
            "severity": "critical",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        SharedState.write("pending_alerts", alerts)


async def main() -> None:
    """Main entry point"""
    service = SystemService()

    try:
        await service.start()
    finally:
        await service.stop()


if __name__ == "__main__":
    asyncio.run(main())
