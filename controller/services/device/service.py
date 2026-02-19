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
from common.config import DeviceConfig, DeviceType, Protocol, load_site_config
from common.logging_setup import get_service_logger
from common.site_calculations import save_delta_state, restore_delta_state

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
        self._command_task: asyncio.Task | None = None
        self._config_watch_task: asyncio.Task | None = None
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

        # Restore DeltaTracker state (survives restarts)
        restore_delta_state()

        # Start connection pool
        await self.connection_pool.start()

        # Initialize polling
        await self.register_reader.start_polling(self._devices)

        # Start health server
        await self._start_health_server()

        # Start polling task
        self._poll_task = asyncio.create_task(self._poll_loop())

        # Start command queue task (processes write commands from control service)
        self._command_task = asyncio.create_task(self._command_queue_loop())

        # Start config watch task (hot-reload on config changes)
        self._config_watch_task = asyncio.create_task(self._config_watch_loop())

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

        # Cancel command task
        if self._command_task:
            self._command_task.cancel()
            try:
                await self._command_task
            except asyncio.CancelledError:
                pass

        # Cancel config watch task
        if self._config_watch_task:
            self._config_watch_task.cancel()
            try:
                await self._config_watch_task
            except asyncio.CancelledError:
                pass

        # Stop connection pool
        await self.connection_pool.stop()

        # Stop health server
        await self._stop_health_server()

        # Save DeltaTracker state to disk (survives reboot)
        save_delta_state(to_disk=True)

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
            # Skip devices without valid device_type
            device_type_str = device_data.get("device_type")
            if not device_type_str:
                logger.warning(
                    f"Skipping device {device_data.get('name', 'unknown')}: missing device_type"
                )
                continue

            try:
                device_type = DeviceType(device_type_str)
            except ValueError:
                logger.warning(
                    f"Skipping device {device_data.get('name', 'unknown')}: "
                    f"invalid device_type '{device_type_str}'"
                )
                continue

            # Skip virtual devices (computed, not polled via Modbus)
            if device_type == DeviceType.SITE_CONTROLLER:
                continue

            # Extract modbus settings (can be nested under "modbus" or at root level)
            modbus_config = device_data.get("modbus", {})

            device = DeviceConfig(
                id=device_data["id"],
                name=device_data["name"],
                device_type=device_type,
                protocol=Protocol(modbus_config.get("protocol") or device_data.get("protocol", "tcp")),
                host=modbus_config.get("host") or device_data.get("host", ""),
                port=modbus_config.get("port") or device_data.get("port", 502),
                slave_id=modbus_config.get("slave_id") or device_data.get("slave_id", 1),
                serial_port=modbus_config.get("serial_port") or device_data.get("serial_port", ""),
                baudrate=modbus_config.get("baudrate") or device_data.get("baudrate", 9600),
                parity=modbus_config.get("parity") or device_data.get("parity", "N"),
                stopbits=modbus_config.get("stopbits") or device_data.get("stopbits", 1),
                registers=[],
                rated_power_kw=device_data.get("rated_power_kw"),
                rated_power_kva=device_data.get("rated_power_kva"),
            )

            # Parse registers
            from common.config import ModbusRegister, RegisterDataType
            for reg_data in device_data.get("registers", []):
                try:
                    reg_datatype = RegisterDataType(reg_data.get("datatype", "uint16"))
                except ValueError:
                    logger.debug(f"Skipping register {reg_data.get('name')}: unsupported datatype {reg_data.get('datatype')}")
                    continue
                device.registers.append(ModbusRegister(
                    address=reg_data["address"],
                    name=reg_data["name"],
                    type=reg_data.get("type", "holding"),
                    datatype=reg_datatype,
                    access=reg_data.get("access", "read"),
                    scale=reg_data.get("scale", 1.0),
                    unit=reg_data.get("unit", ""),
                    size=reg_data.get("size", 0),
                    poll_interval_ms=reg_data.get("poll_interval_ms", 1000),
                    log_to_cloud=reg_data.get("log_to_cloud", True),
                ))

            # Also poll visualization + alarm registers (slower 5s interval)
            # Needed for Live Registers page on RTU Direct devices
            # (serial port is exclusively held — register_cli reads from SharedState)
            existing_addrs = {r.address for r in device.registers}
            for reg_list_key in ("visualization_registers", "alarm_registers"):
                for reg_data in device_data.get(reg_list_key, []) or []:
                    if reg_data.get("address") in existing_addrs:
                        continue
                    try:
                        datatype = RegisterDataType(reg_data.get("datatype", "uint16"))
                    except ValueError:
                        # Skip registers with unsupported datatypes (e.g. uint8_hi)
                        logger.debug(f"Skipping viz register {reg_data.get('name')}: unsupported datatype {reg_data.get('datatype')}")
                        continue
                    device.registers.append(ModbusRegister(
                        address=reg_data["address"],
                        name=reg_data["name"],
                        type=reg_data.get("type", "holding"),
                        datatype=datatype,
                        access=reg_data.get("access", "read"),
                        scale=reg_data.get("scale", 1.0),
                        unit=reg_data.get("unit", ""),
                        size=reg_data.get("size", 0),
                        poll_interval_ms=5000,
                        log_to_cloud=False,
                    ))
                    existing_addrs.add(reg_data["address"])

            self._devices.append(device)
            self.device_manager.register_device(device)
            if device.protocol == "rtu_direct":
                logger.info(f"Registered device: {device.name} serial={device.serial_port} baud={device.baudrate} slave_id={device.slave_id}")
            else:
                logger.info(f"Registered device: {device.name} host={device.host} port={device.port} slave_id={device.slave_id}")

        logger.info(f"Loaded {len(self._devices)} devices from config")

    async def _poll_loop(self) -> None:
        """Main polling loop"""
        poll_interval = 0.1  # 100ms base loop
        delta_save_counter = 0  # Save DeltaTracker state every ~60s

        while self._running:
            try:
                # Poll all devices
                for device in self._devices:
                    if not self._running:
                        break

                    # Skip if device is in backoff (exponential backoff for offline devices)
                    remaining = self.device_manager.get_backoff_remaining(device.id)
                    if remaining is not None and remaining > 0:
                        # Only log occasionally to avoid spam (every ~10s)
                        if int(remaining) % 10 == 0:
                            logger.debug(
                                f"Skipping {device.name}: backoff {remaining:.0f}s remaining"
                            )
                        continue

                    await self.register_reader.poll_device(device)

                # Update shared state with readings
                await self.device_manager.update_shared_state()

                # Periodically save DeltaTracker state to tmpfs (~every 60s)
                delta_save_counter += 1
                if delta_save_counter >= 600:  # 600 × 100ms = 60s
                    save_delta_state()
                    delta_save_counter = 0

            except Exception as e:
                logger.error(f"Error in poll loop: {e}")

            await asyncio.sleep(poll_interval)

    async def _command_queue_loop(self) -> None:
        """
        Process pending write commands from control service.

        Control service writes commands to SharedState 'write_commands'.
        This loop picks them up and executes them via register_writer.
        """
        command_interval = 0.1  # 100ms poll for commands

        while self._running:
            try:
                # Read pending commands from SharedState
                commands_data = SharedState.read("write_commands")
                pending_commands = commands_data.get("commands", [])

                if pending_commands:
                    # Process each command
                    processed_ids = []

                    for cmd in pending_commands:
                        device_id = cmd.get("device_id")
                        command_type = cmd.get("command")
                        value = cmd.get("value")
                        timestamp = cmd.get("timestamp")

                        if not device_id or not command_type:
                            processed_ids.append(timestamp)
                            continue

                        try:
                            if command_type == "write_solar_limit":
                                success = await self.write_solar_limit(
                                    device_id=device_id,
                                    limit_pct=float(value),
                                )
                                if success:
                                    logger.debug(
                                        f"Executed solar limit write: {value}% to {device_id}"
                                    )
                                else:
                                    logger.warning(
                                        f"Failed to write solar limit to {device_id}"
                                    )

                            elif command_type == "write_register":
                                register_address = cmd.get("register_address")
                                verify = cmd.get("verify", True)
                                success = await self.write_register(
                                    device_id=device_id,
                                    register_address=register_address,
                                    value=int(value),
                                    verify=verify,
                                )
                                if success:
                                    logger.debug(
                                        f"Executed register write: {register_address}={value} to {device_id}"
                                    )
                                else:
                                    logger.warning(
                                        f"Failed to write register {register_address} to {device_id}"
                                    )

                            processed_ids.append(timestamp)

                        except Exception as e:
                            logger.error(f"Error executing command {command_type}: {e}")
                            processed_ids.append(timestamp)

                    # Remove processed commands
                    if processed_ids:
                        remaining = [
                            cmd for cmd in pending_commands
                            if cmd.get("timestamp") not in processed_ids
                        ]
                        SharedState.write("write_commands", {"commands": remaining})

            except Exception as e:
                logger.error(f"Error in command queue loop: {e}")

            await asyncio.sleep(command_interval)

    async def _config_watch_loop(self) -> None:
        """
        Watch for config changes and reload when detected.

        Directly compares config content hash instead of relying on
        notification flags. Simpler and more reliable.
        """
        import hashlib
        import json

        watch_interval = 15.0  # Check every 15 seconds

        def compute_devices_hash(config: dict) -> str:
            """Compute hash of devices portion of config"""
            devices = config.get("devices", [])
            content = json.dumps(devices, sort_keys=True, default=str)
            return hashlib.md5(content.encode()).hexdigest()

        # Store current config hash
        current_hash = ""
        initial_config = get_config()
        if initial_config:
            current_hash = compute_devices_hash(initial_config)

        while self._running:
            try:
                # Read fresh config from SharedState
                config = SharedState.read_fresh("config")
                if not config:
                    await asyncio.sleep(watch_interval)
                    continue

                new_hash = compute_devices_hash(config)

                if new_hash != current_hash:
                    logger.info(f"Config change detected (hash: {current_hash[:8]} → {new_hash[:8]}), reloading...")

                    # Reload configuration
                    await self._load_config()

                    # Restart polling with new devices
                    self.register_reader.stop_polling()
                    await self.register_reader.start_polling(self._devices)

                    # Force SharedState update to clear stale register entries
                    # register_device() already created fresh DeviceStatus (empty readings)
                    # This ensures SharedState.readings doesn't contain old names
                    await self.device_manager.update_shared_state()

                    # Clear reading buffers for registers no longer in config
                    valid_keys = set()
                    for device in self._devices:
                        for reg in device.registers:
                            valid_keys.add(f"{device.id}:{reg.name}")
                    stale_keys = [k for k in self.device_manager._reading_buffers if k not in valid_keys]
                    for k in stale_keys:
                        del self.device_manager._reading_buffers[k]

                    current_hash = new_hash

                    logger.info(
                        f"Config reloaded: {len(self._devices)} devices",
                        extra={"device_count": len(self._devices)},
                    )

            except Exception as e:
                logger.error(f"Error in config watch loop: {e}")

            await asyncio.sleep(watch_interval)

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
