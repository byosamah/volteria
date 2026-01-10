"""
Device Service (Layer 3) - Modbus Communication

Responsible for:
- Maintaining Modbus connections
- Polling devices for readings
- Executing write commands
- Tracking device status
"""

import asyncio
import os
import signal
from datetime import datetime, timezone
from pathlib import Path

import yaml
from aiohttp import web

from common.state import SharedState, set_service_health, get_config
from common.config import DeviceConfig, DeviceType, load_site_config
from common.logging_setup import get_service_logger

from .connection_pool import ConnectionPool
from .device_manager import DeviceManager
from .register_reader import RegisterReader
from .register_writer import RegisterWriter

logger = get_service_logger("device")

# Health server port
HEALTH_PORT = 8083


class DeviceService:
    """
    Device Service - Layer 3

    Manages all Modbus communication:
    - Connection pooling
    - Per-register polling at configured intervals
    - Write command execution with verification
    - Device status tracking
    """

    def __init__(self, config_path: str | None = None):
        self.config_path = config_path or self._find_config_path()

        # Initialize components
        self.connection_pool = ConnectionPool()
        self.device_manager = DeviceManager()
        self.register_reader = RegisterReader(
            connection_pool=self.connection_pool,
            device_manager=self.device_manager,
        )
        self.register_writer = RegisterWriter(
            connection_pool=self.connection_pool,
        )

        # Current configuration
        self._devices: list[DeviceConfig] = []
        self._start_time = datetime.now(timezone.utc)

        # Health server
        self._health_app: web.Application | None = None
        self._health_runner: web.AppRunner | None = None

        # State
        self._running = False
        self._poll_task: asyncio.Task | None = None
        self._shutdown_event = asyncio.Event()

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

    async def start(self) -> None:
        """Start the device service"""
        logger.info("Starting Device Service")

        self._running = True

        # Update service health
        set_service_health("device", {
            "status": "starting",
            "is_healthy": False,
        })

        # Load configuration
        await self._load_config()

        # Start connection pool
        await self.connection_pool.start()

        # Initialize polling
        await self.register_reader.start_polling(self._devices)

        # Start health server
        await self._start_health_server()

        # Start polling task
        self._poll_task = asyncio.create_task(self._poll_loop())

        # Update service health to running
        set_service_health("device", {
            "status": "running",
            "is_healthy": True,
            "started_at": self._start_time.isoformat(),
        })

        logger.info(
            f"Device Service started ({len(self._devices)} devices)",
            extra={"device_count": len(self._devices)},
        )

        # Setup signal handlers
        self._setup_signal_handlers()

        # Wait for shutdown
        await self._shutdown_event.wait()

    async def stop(self) -> None:
        """Stop the device service"""
        logger.info("Stopping Device Service")

        self._running = False
        self.register_reader.stop_polling()

        # Cancel poll task
        if self._poll_task:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass

        # Stop connection pool
        await self.connection_pool.stop()

        # Stop health server
        await self._stop_health_server()

        # Update service health
        set_service_health("device", {
            "status": "stopped",
            "is_healthy": False,
        })

        logger.info("Device Service stopped")

    def _setup_signal_handlers(self) -> None:
        """Setup graceful shutdown signal handlers"""
        loop = asyncio.get_event_loop()

        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, self._handle_shutdown)
            except NotImplementedError:
                signal.signal(sig, lambda s, f: self._handle_shutdown())

    def _handle_shutdown(self) -> None:
        """Handle shutdown signal"""
        logger.info("Received shutdown signal")
        self._shutdown_event.set()

    async def _load_config(self) -> None:
        """Load device configuration from shared state"""
        # Wait for config to be available
        for _ in range(30):
            config = get_config()
            if config and config.get("devices"):
                break
            await asyncio.sleep(1)
            logger.debug("Waiting for configuration...")

        config = get_config()
        if not config:
            logger.warning("No configuration available")
            return

        # Parse devices
        self._devices = []
        for device_data in config.get("devices", []):
            device = DeviceConfig(
                id=device_data["id"],
                name=device_data["name"],
                device_type=DeviceType(device_data["device_type"]),
                protocol=device_data.get("protocol", "tcp"),
                host=device_data.get("host", ""),
                port=device_data.get("port", 502),
                slave_id=device_data.get("slave_id", 1),
                registers=[],
                rated_power_kw=device_data.get("rated_power_kw"),
                rated_power_kva=device_data.get("rated_power_kva"),
            )

            # Parse registers
            from common.config import ModbusRegister, RegisterDataType
            for reg_data in device_data.get("registers", []):
                device.registers.append(ModbusRegister(
                    address=reg_data["address"],
                    name=reg_data["name"],
                    type=reg_data.get("type", "holding"),
                    datatype=RegisterDataType(reg_data.get("datatype", "uint16")),
                    access=reg_data.get("access", "read"),
                    scale=reg_data.get("scale", 1.0),
                    unit=reg_data.get("unit", ""),
                    poll_interval_ms=reg_data.get("poll_interval_ms", 1000),
                    log_to_cloud=reg_data.get("log_to_cloud", True),
                ))

            self._devices.append(device)
            self.device_manager.register_device(device)

        logger.info(f"Loaded {len(self._devices)} devices from config")

    async def _poll_loop(self) -> None:
        """Main polling loop"""
        poll_interval = 0.1  # 100ms base loop

        while self._running:
            try:
                # Poll all devices
                for device in self._devices:
                    if not self._running:
                        break

                    await self.register_reader.poll_device(device)

                # Update shared state with readings
                await self.device_manager.update_shared_state()

            except Exception as e:
                logger.error(f"Error in poll loop: {e}")

            await asyncio.sleep(poll_interval)

    async def write_solar_limit(
        self,
        device_id: str,
        limit_pct: float,
    ) -> bool:
        """
        Write solar limit to an inverter.

        Args:
            device_id: Device ID
            limit_pct: Limit percentage (0-100)

        Returns:
            True if write successful
        """
        # Find device
        device = next((d for d in self._devices if d.id == device_id), None)
        if not device:
            logger.error(f"Device not found: {device_id}")
            return False

        if device.device_type != DeviceType.INVERTER:
            logger.error(f"Device is not an inverter: {device.name}")
            return False

        result = await self.register_writer.write_solar_limit(
            device=device,
            limit_pct=limit_pct,
        )

        return result.success

    async def write_register(
        self,
        device_id: str,
        register_address: int,
        value: int,
        verify: bool = True,
    ) -> bool:
        """Write a register on a device"""
        device = next((d for d in self._devices if d.id == device_id), None)
        if not device:
            logger.error(f"Device not found: {device_id}")
            return False

        result = await self.register_writer.write_register(
            device=device,
            register_address=register_address,
            value=value,
            verify=verify,
        )

        return result.success

    def get_device_readings(self, device_id: str) -> dict:
        """Get latest readings for a device"""
        return self.device_manager.get_device_readings(device_id)

    def get_all_readings(self) -> dict:
        """Get all device readings"""
        return self.device_manager.get_all_readings()

    def get_device_status(self, device_id: str) -> dict | None:
        """Get device status"""
        status = self.device_manager.get_status(device_id)
        if status:
            return {
                "device_id": status.device_id,
                "device_name": status.device_name,
                "device_type": status.device_type.value,
                "is_online": status.is_online,
                "last_seen": status.last_seen.isoformat() if status.last_seen else None,
                "last_error": status.last_error,
            }
        return None

    async def _start_health_server(self) -> None:
        """Start the health check HTTP server"""
        self._health_app = web.Application()
        self._health_app.router.add_get("/health", self._health_handler)
        self._health_app.router.add_get("/readings", self._readings_handler)
        self._health_app.router.add_get("/status", self._status_handler)

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
        uptime = (datetime.now(timezone.utc) - self._start_time).total_seconds()
        device_count = self.device_manager.get_device_count()

        return web.json_response({
            "status": "healthy" if self._running else "unhealthy",
            "service": "device",
            "uptime": int(uptime),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "devices": device_count,
            "connections": self.connection_pool.get_stats(),
        })

    async def _readings_handler(self, request: web.Request) -> web.Response:
        """Return all device readings"""
        return web.json_response(self.get_all_readings())

    async def _status_handler(self, request: web.Request) -> web.Response:
        """Return all device status"""
        status = {}
        for device in self._devices:
            status[device.id] = self.get_device_status(device.id)
        return web.json_response(status)


async def main() -> None:
    """Main entry point"""
    service = DeviceService()

    try:
        await service.start()
    finally:
        await service.stop()


if __name__ == "__main__":
    asyncio.run(main())
