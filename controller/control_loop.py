"""
Control Loop - Zero-Feeding Algorithm

This module implements the main control logic that:
1. Reads data from load meters, DG controllers, and solar inverters
2. Calculates the optimal solar power limit to prevent DG reverse feeding
3. Writes power limits to solar inverters
4. Verifies commands were accepted
5. Logs data locally and syncs to cloud
6. Manages safe mode and alarms

Algorithm (zero_dg_reverse mode):
    load = sum(load_meter_readings)
    available_headroom = load - DG_RESERVE
    solar_limit = max(0, min(available_headroom, TOTAL_INVERTER_CAPACITY))
    inverter_limit_pct = (solar_limit / TOTAL_INVERTER_CAPACITY) * 100
"""

import asyncio
import logging
import struct
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from collections import deque

try:
    from pymodbus.client import AsyncModbusTcpClient
except ImportError:
    print("Error: pymodbus not installed. Run:")
    print("  pip install pymodbus>=3.6.0")
    raise

# Import new modules
from storage.local_db import LocalDatabase, ControlLogRecord
from storage.cloud_sync import CloudSync
from safe_mode import SafeModeManager, SafeModeType
from alarms import AlarmManager, AlarmType

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class ControlState:
    """
    Current state of the control system.
    Updated each control cycle.
    """
    # Readings from devices
    load_kw: float = 0.0           # Total load from meters
    dg_power_kw: float = 0.0       # Total DG output
    solar_output_kw: float = 0.0   # Current solar output

    # Calculated values
    available_headroom_kw: float = 0.0
    solar_limit_kw: float = 0.0
    solar_limit_pct: int = 100

    # Status
    safe_mode_active: bool = False
    last_update: float = 0.0
    cycle_count: int = 0

    # Configuration mode (based on available devices)
    # 'meter_inverter', 'dg_inverter', 'full_system'
    config_mode: str = "meter_inverter"

    # Device status
    load_meters_online: int = 0
    inverters_online: int = 0
    generators_online: int = 0


@dataclass
class DeviceConfig:
    """Configuration for a single device."""
    name: str
    template: str
    protocol: str
    slave_id: int
    # What this device measures for control logic
    # Values: load, sub_load, solar, generator, fuel, unknown
    measurement_type: str = "unknown"
    # TCP/Gateway settings
    ip: Optional[str] = None
    port: int = 502
    gateway_ip: Optional[str] = None
    gateway_port: int = 502
    # Optional overrides
    rated_power_kw: Optional[float] = None
    rated_power_kva: Optional[float] = None
    # Device ID from cloud (for reference)
    id: Optional[str] = None
    # Modbus registers configuration
    registers: Optional[list] = None
    # Polling interval in milliseconds
    logging_interval_ms: Optional[int] = None


class ModbusConnection:
    """
    Manages Modbus TCP connection to a device or gateway.

    This class handles connecting, reading, and writing to Modbus devices.
    """

    def __init__(self, host: str, port: int = 502):
        """
        Initialize the connection.

        Args:
            host: IP address or hostname
            port: Modbus TCP port (default 502)
        """
        self.host = host
        self.port = port
        self._client: Optional[AsyncModbusTcpClient] = None
        self._connected = False

    async def connect(self) -> bool:
        """
        Establish connection to the Modbus server.

        Returns:
            True if connected successfully
        """
        try:
            self._client = AsyncModbusTcpClient(
                host=self.host,
                port=self.port,
                timeout=5,
            )
            await self._client.connect()
            self._connected = self._client.connected
            if self._connected:
                logger.info(f"Connected to Modbus server at {self.host}:{self.port}")
            return self._connected
        except Exception as e:
            logger.error(f"Failed to connect to {self.host}:{self.port}: {e}")
            return False

    async def disconnect(self):
        """Close the connection."""
        if self._client:
            self._client.close()
            self._connected = False
            logger.info(f"Disconnected from {self.host}:{self.port}")

    async def read_holding_registers(
        self, address: int, count: int, slave_id: int
    ) -> Optional[list[int]]:
        """
        Read holding registers from a device.

        Args:
            address: Starting register address
            count: Number of registers to read
            slave_id: Modbus slave ID

        Returns:
            List of register values, or None on error
        """
        if not self._connected or not self._client:
            logger.warning("Not connected, cannot read registers")
            return None

        try:
            result = await self._client.read_holding_registers(
                address=address,
                count=count,
                slave=slave_id,
            )
            if result.isError():
                logger.error(f"Error reading registers: {result}")
                return None
            return list(result.registers)
        except Exception as e:
            logger.error(f"Exception reading registers: {e}")
            return None

    async def read_input_registers(
        self, address: int, count: int, slave_id: int
    ) -> Optional[list[int]]:
        """
        Read input registers from a device.

        Args:
            address: Starting register address
            count: Number of registers to read
            slave_id: Modbus slave ID

        Returns:
            List of register values, or None on error
        """
        if not self._connected or not self._client:
            logger.warning("Not connected, cannot read registers")
            return None

        try:
            result = await self._client.read_input_registers(
                address=address,
                count=count,
                slave=slave_id,
            )
            if result.isError():
                logger.error(f"Error reading input registers: {result}")
                return None
            return list(result.registers)
        except Exception as e:
            logger.error(f"Exception reading input registers: {e}")
            return None

    async def write_register(
        self, address: int, value: int, slave_id: int
    ) -> bool:
        """
        Write a single holding register.

        Args:
            address: Register address
            value: Value to write
            slave_id: Modbus slave ID

        Returns:
            True if write was successful
        """
        if not self._connected or not self._client:
            logger.warning("Not connected, cannot write register")
            return False

        try:
            result = await self._client.write_register(
                address=address,
                value=value,
                slave=slave_id,
            )
            if result.isError():
                logger.error(f"Error writing register: {result}")
                return False
            return True
        except Exception as e:
            logger.error(f"Exception writing register: {e}")
            return False

    @property
    def connected(self) -> bool:
        """Check if connected."""
        return self._connected


class ControlLoop:
    """
    Main control loop implementing the zero-feeding algorithm.

    This class:
    1. Reads data from all devices
    2. Calculates optimal solar limit
    3. Writes limit to inverters
    4. Verifies commands
    5. Logs data
    """

    # Sungrow inverter registers
    REG_LIMIT_SWITCH = 5007    # 0xAA=Enable, 0x55=Disable
    REG_POWER_LIMIT = 5008     # 0-100%
    REG_ACTIVE_POWER = 5031    # Output (0.1 kW scale)

    # Meatrol meter registers
    REG_METER_POWER = 1032     # Total active power (float32, 2 registers)

    # Control codes
    LIMIT_ENABLE = 0xAA
    LIMIT_DISABLE = 0x55

    def __init__(self, config: dict):
        """
        Initialize the control loop.

        Args:
            config: Configuration dictionary (from config.yaml)
        """
        self.config = config
        self.state = ControlState()

        # Site info - sites are physical locations with controllers
        site_cfg = config.get("site", {})
        self.site_id = site_cfg.get("id", "")
        # Note: project_id is no longer used - sites architecture replaces projects with controllers

        # Control settings
        control_cfg = config.get("control", {})
        self.interval_ms = control_cfg.get("interval_ms", 1000)
        self.dg_reserve_kw = max(0, control_cfg.get("dg_reserve_kw", 50))  # Cannot be negative
        self.operation_mode = control_cfg.get("operation_mode", "zero_dg_reverse")

        # Logging settings
        logging_cfg = config.get("logging", {})
        self.local_interval_ms = logging_cfg.get("local_interval_ms", 1000)
        self.cloud_interval_ms = logging_cfg.get("cloud_sync_interval_ms", 5000)
        self.local_retention_days = logging_cfg.get("local_retention_days", 7)

        # Safe mode settings
        safe_mode_cfg = config.get("safe_mode", {})
        self.safe_mode_enabled = safe_mode_cfg.get("enabled", True)
        safe_mode_type_str = safe_mode_cfg.get("type", "rolling_average")
        self.safe_mode_timeout_s = safe_mode_cfg.get("timeout_s", 30)
        self.rolling_window_minutes = safe_mode_cfg.get("rolling_window_minutes", 3)
        self.threshold_pct = safe_mode_cfg.get("threshold_pct", 80)

        # Device configurations
        devices_cfg = config.get("devices", {})
        self.load_meters = [
            DeviceConfig(**m) for m in devices_cfg.get("load_meters", [])
        ]
        self.inverters = [
            DeviceConfig(**i) for i in devices_cfg.get("inverters", [])
        ]
        self.generators = [
            DeviceConfig(**g) for g in devices_cfg.get("generators", [])
        ]

        # Calculate total inverter capacity
        self.total_inverter_capacity_kw = sum(
            inv.rated_power_kw or 0 for inv in self.inverters
        )

        # Determine configuration mode based on available devices
        has_meters = len(self.load_meters) > 0
        has_dgs = len(self.generators) > 0
        has_inverters = len(self.inverters) > 0

        if has_meters and has_dgs:
            self.state.config_mode = "full_system"
        elif has_meters:
            self.state.config_mode = "meter_inverter"
        elif has_dgs:
            self.state.config_mode = "dg_inverter"

        # ============================================
        # INITIALIZE LOCAL DATABASE
        # ============================================
        # Use absolute path /data/ which is created by setup script
        # and allowed by systemd ProtectSystem=strict + ReadWritePaths=/data
        self.local_db = LocalDatabase(db_path="/data/controller.db")

        # ============================================
        # INITIALIZE ALARM MANAGER
        # ============================================
        self.alarm_manager = AlarmManager(
            local_db=self.local_db,
            cooldown_seconds=300  # 5 minute cooldown between duplicate alarms
        )

        # ============================================
        # INITIALIZE SAFE MODE MANAGER
        # ============================================
        if self.safe_mode_enabled:
            safe_mode_type = (
                SafeModeType.TIME_BASED if safe_mode_type_str == "time_based"
                else SafeModeType.ROLLING_AVERAGE
            )
            self.safe_mode_manager = SafeModeManager(
                mode_type=safe_mode_type,
                timeout_s=self.safe_mode_timeout_s,
                rolling_window_min=self.rolling_window_minutes,
                threshold_pct=self.threshold_pct,
                on_trigger=self._on_safe_mode_triggered
            )
        else:
            self.safe_mode_manager = None

        # ============================================
        # INITIALIZE CLOUD SYNC (if configured)
        # ============================================
        cloud_cfg = config.get("cloud", {})
        self.cloud_sync: Optional[CloudSync] = None
        if cloud_cfg.get("sync_enabled", False) and cloud_cfg.get("supabase_url"):
            self.cloud_sync = CloudSync(
                site_id=self.site_id,  # Primary: site is the physical location with controller
                supabase_url=cloud_cfg["supabase_url"],
                supabase_key=cloud_cfg.get("supabase_key", ""),
                local_db=self.local_db,
                sync_interval_ms=self.cloud_interval_ms
            )

        # Modbus connections (will be established on start)
        self._connections: dict[str, ModbusConnection] = {}

        # Running flag
        self._running = False
        self._last_device_update: dict[str, float] = {}

        # Heartbeat tracking
        self._last_heartbeat = time.time()
        self._heartbeat_interval = 300  # 5 minutes

        # Startup time for uptime calculation
        self._start_time = time.time()

        logger.info(f"Control loop initialized:")
        logger.info(f"  - Interval: {self.interval_ms}ms")
        logger.info(f"  - DG Reserve: {self.dg_reserve_kw} kW")
        logger.info(f"  - Operation Mode: {self.operation_mode}")
        logger.info(f"  - Config Mode: {self.state.config_mode}")
        logger.info(f"  - Load Meters: {len(self.load_meters)}")
        logger.info(f"  - Inverters: {len(self.inverters)}")
        logger.info(f"  - Generators: {len(self.generators)}")
        logger.info(f"  - Total Inverter Capacity: {self.total_inverter_capacity_kw} kW")
        logger.info(f"  - Safe Mode: {'Enabled' if self.safe_mode_enabled else 'Disabled'}")
        logger.info(f"  - Cloud Sync: {'Enabled' if self.cloud_sync else 'Disabled'}")

    # ============================================
    # DEVICE FILTERING BY MEASUREMENT TYPE
    # ============================================

    def get_devices_by_measurement_type(self, measurement_type: str) -> list[DeviceConfig]:
        """
        Get all devices that measure a specific type.

        Args:
            measurement_type: One of 'load', 'sub_load', 'solar', 'generator', 'fuel'

        Returns:
            List of DeviceConfig objects matching the measurement type
        """
        all_devices = self.load_meters + self.inverters + self.generators
        return [d for d in all_devices if d.measurement_type == measurement_type]

    def get_load_measurement_devices(self) -> list[DeviceConfig]:
        """Get devices that measure main site load."""
        return self.get_devices_by_measurement_type("load")

    def get_sub_load_measurement_devices(self) -> list[DeviceConfig]:
        """Get devices that measure sub-loads (partial loads)."""
        return self.get_devices_by_measurement_type("sub_load")

    def get_solar_measurement_devices(self) -> list[DeviceConfig]:
        """Get devices that measure solar output."""
        return self.get_devices_by_measurement_type("solar")

    def get_generator_measurement_devices(self) -> list[DeviceConfig]:
        """Get devices that measure generator output."""
        return self.get_devices_by_measurement_type("generator")

    def get_fuel_measurement_devices(self) -> list[DeviceConfig]:
        """Get devices that measure fuel levels."""
        return self.get_devices_by_measurement_type("fuel")

    def _on_safe_mode_triggered(self, reason: str, device: str):
        """Callback when safe mode is triggered."""
        self.alarm_manager.safe_mode_triggered(reason, device)

    async def _get_connection(self, host: str, port: int) -> ModbusConnection:
        """
        Get or create a Modbus connection.

        Args:
            host: IP address
            port: Port number

        Returns:
            ModbusConnection instance
        """
        key = f"{host}:{port}"
        if key not in self._connections:
            conn = ModbusConnection(host, port)
            await conn.connect()
            self._connections[key] = conn
        return self._connections[key]

    def _float32_from_registers(self, high: int, low: int) -> float:
        """
        Convert two 16-bit registers to a float32 value.

        Args:
            high: High word (first register)
            low: Low word (second register)

        Returns:
            Float value
        """
        packed = struct.pack('>HH', high, low)
        value, = struct.unpack('>f', packed)
        return value

    async def _read_load_meters(self) -> float:
        """
        Read total load from all load meters.

        Returns:
            Total load in kW
        """
        total_load = 0.0
        online_count = 0

        for meter in self.load_meters:
            try:
                # Get connection
                host = meter.gateway_ip or meter.ip
                port = meter.gateway_port if meter.gateway_ip else meter.port
                if not host:
                    continue

                conn = await self._get_connection(host, port)
                if not conn.connected:
                    continue

                # Read power register (float32 = 2 registers)
                result = await conn.read_holding_registers(
                    address=self.REG_METER_POWER,
                    count=2,
                    slave_id=meter.slave_id,
                )

                if result and len(result) >= 2:
                    # Convert to float (W) then to kW
                    power_w = self._float32_from_registers(result[0], result[1])
                    power_kw = power_w / 1000.0
                    total_load += power_kw
                    online_count += 1
                    self._last_device_update[meter.name] = time.time()
                    logger.debug(f"{meter.name}: {power_kw:.1f} kW")

            except Exception as e:
                logger.error(f"Error reading {meter.name}: {e}")

        self.state.load_meters_online = online_count
        return total_load

    async def _read_inverters(self) -> float:
        """
        Read total solar output from all inverters.

        Returns:
            Total solar output in kW
        """
        total_solar = 0.0
        online_count = 0

        for inverter in self.inverters:
            try:
                # Get connection
                host = inverter.gateway_ip or inverter.ip
                port = inverter.gateway_port if inverter.gateway_ip else inverter.port
                if not host:
                    continue

                conn = await self._get_connection(host, port)
                if not conn.connected:
                    continue

                # Read active power (input register, 0.1 kW scale)
                result = await conn.read_input_registers(
                    address=self.REG_ACTIVE_POWER,
                    count=1,
                    slave_id=inverter.slave_id,
                )

                if result and len(result) >= 1:
                    power_kw = result[0] / 10.0  # Scale: 0.1 kW
                    total_solar += power_kw
                    online_count += 1
                    self._last_device_update[inverter.name] = time.time()
                    logger.debug(f"{inverter.name}: {power_kw:.1f} kW")

            except Exception as e:
                logger.error(f"Error reading {inverter.name}: {e}")

        self.state.inverters_online = online_count
        return total_solar

    async def _write_inverter_limit(self, inverter: DeviceConfig, limit_pct: int) -> bool:
        """
        Write power limit to an inverter and verify.

        Args:
            inverter: Inverter configuration
            limit_pct: Power limit percentage (0-100)

        Returns:
            True if command was verified
        """
        try:
            # Get connection
            host = inverter.gateway_ip or inverter.ip
            port = inverter.gateway_port if inverter.gateway_ip else inverter.port
            if not host:
                return False

            conn = await self._get_connection(host, port)
            if not conn.connected:
                self.alarm_manager.write_failed(
                    inverter.name, "connection", "Not connected"
                )
                return False

            # 1. Enable power limitation
            success = await conn.write_register(
                address=self.REG_LIMIT_SWITCH,
                value=self.LIMIT_ENABLE,
                slave_id=inverter.slave_id,
            )
            if not success:
                self.alarm_manager.write_failed(
                    inverter.name, "limit_switch", "Failed to enable limit switch"
                )
                return False

            # 2. Write power limit
            success = await conn.write_register(
                address=self.REG_POWER_LIMIT,
                value=limit_pct,
                slave_id=inverter.slave_id,
            )
            if not success:
                self.alarm_manager.write_failed(
                    inverter.name, "power_limit", "Failed to write power limit"
                )
                return False

            # 3. Wait for inverter to process
            await asyncio.sleep(0.2)  # 200ms delay

            # 4. Read back to verify
            result = await conn.read_holding_registers(
                address=self.REG_POWER_LIMIT,
                count=1,
                slave_id=inverter.slave_id,
            )

            if result and len(result) >= 1:
                read_value = result[0]
                if abs(read_value - limit_pct) > 1:  # Allow 1% tolerance
                    self.alarm_manager.command_not_taken(
                        inverter.name, limit_pct, read_value, "power_limit"
                    )
                    return False

            logger.info(f"{inverter.name}: Limit set to {limit_pct}% (verified)")
            return True

        except Exception as e:
            logger.error(f"Error writing to {inverter.name}: {e}")
            self.alarm_manager.write_failed(
                inverter.name, "power_limit", str(e)
            )
            return False

    def _check_safe_mode(self) -> bool:
        """
        Check if safe mode should be triggered.

        Uses the SafeModeManager for proper tracking and alarm generation.

        Returns:
            True if safe mode should be active
        """
        if not self.safe_mode_manager:
            return False

        # Update device status in safe mode manager
        for name, last_update in self._last_device_update.items():
            is_online = (time.time() - last_update) < self.safe_mode_timeout_s
            self.safe_mode_manager.update_device_status(name, is_online)

        # Record power readings for rolling average
        self.safe_mode_manager.record_power(
            solar_kw=self.state.solar_output_kw,
            load_kw=self.state.load_kw
        )

        # Check safe mode conditions
        state = self.safe_mode_manager.check()
        return state.is_active

    async def _run_cycle(self):
        """
        Run a single control cycle.

        This is the main control algorithm.
        """
        cycle_start = time.time()
        self.state.cycle_count += 1

        # 1. Read load from meters
        self.state.load_kw = await self._read_load_meters()

        # 2. Read current solar output
        self.state.solar_output_kw = await self._read_inverters()

        # 3. Check safe mode conditions
        self.state.safe_mode_active = self._check_safe_mode()

        # 4. Calculate solar limit
        if self.state.safe_mode_active:
            # Safe mode: stop all solar
            self.state.solar_limit_kw = 0.0
            self.state.solar_limit_pct = 0
            logger.warning("SAFE MODE ACTIVE - Solar limited to 0%")
        else:
            # Normal operation: zero-feeding algorithm
            # available_headroom = load - DG_RESERVE
            self.state.available_headroom_kw = max(
                0,
                self.state.load_kw - self.dg_reserve_kw
            )

            # solar_limit = min(available_headroom, total_inverter_capacity)
            self.state.solar_limit_kw = min(
                self.state.available_headroom_kw,
                self.total_inverter_capacity_kw
            )

            # Convert to percentage
            if self.total_inverter_capacity_kw > 0:
                self.state.solar_limit_pct = int(
                    (self.state.solar_limit_kw / self.total_inverter_capacity_kw) * 100
                )
            else:
                self.state.solar_limit_pct = 0

        # 5. Write limit to all inverters
        for inverter in self.inverters:
            success = await self._write_inverter_limit(inverter, self.state.solar_limit_pct)
            if not success:
                # Alarm already raised in _write_inverter_limit
                pass

        # 6. Calculate DG power (for logging)
        # DG power = load - solar_output
        self.state.dg_power_kw = max(0, self.state.load_kw - self.state.solar_output_kw)

        # Update timing
        self.state.last_update = cycle_start
        cycle_time_ms = (time.time() - cycle_start) * 1000

        # 7. Log to local database
        self._log_to_database()

        # Log status to console
        logger.info(
            f"Cycle {self.state.cycle_count}: "
            f"Load={self.state.load_kw:.1f}kW, "
            f"Solar={self.state.solar_output_kw:.1f}kW ({self.state.solar_limit_pct}% limit), "
            f"DG={self.state.dg_power_kw:.1f}kW, "
            f"Reserve={self.dg_reserve_kw}kW, "
            f"Time={cycle_time_ms:.0f}ms"
        )

    def _log_to_database(self):
        """Log current state to local SQLite database."""
        record = ControlLogRecord(
            timestamp=datetime.now(),
            total_load_kw=self.state.load_kw,
            dg_power_kw=self.state.dg_power_kw,
            solar_output_kw=self.state.solar_output_kw,
            solar_limit_pct=self.state.solar_limit_pct,
            available_headroom_kw=self.state.available_headroom_kw,
            safe_mode_active=self.state.safe_mode_active,
            config_mode=self.state.config_mode,
            load_meters_online=self.state.load_meters_online,
            inverters_online=self.state.inverters_online,
            generators_online=self.state.generators_online
        )
        self.local_db.insert_log(record)

    async def run(self):
        """
        Start the control loop.

        This runs continuously until stopped.
        Also manages cloud sync and heartbeats.
        """
        logger.info("Starting control loop...")
        self._running = True

        # Start cloud sync in background if enabled
        sync_task = None
        if self.cloud_sync:
            sync_task = asyncio.create_task(self.cloud_sync.start())
            logger.info("Cloud sync started in background")

        try:
            while self._running:
                await self._run_cycle()

                # Send heartbeat periodically
                await self._maybe_send_heartbeat()

                # Cleanup old data periodically (once per hour)
                if self.state.cycle_count % 3600 == 0:
                    self.local_db.cleanup_old_data(self.local_retention_days)

                # Wait for next cycle
                await asyncio.sleep(self.interval_ms / 1000.0)

        except asyncio.CancelledError:
            logger.info("Control loop cancelled")
        except Exception as e:
            logger.error(f"Control loop error: {e}")
            self.alarm_manager.control_error(str(e))
            raise
        finally:
            # Stop cloud sync
            if self.cloud_sync:
                self.cloud_sync.stop()
                if sync_task:
                    sync_task.cancel()
                    try:
                        await sync_task
                    except asyncio.CancelledError:
                        pass
                await self.cloud_sync.close()

            # Clean up connections
            for conn in self._connections.values():
                await conn.disconnect()
            logger.info("Control loop stopped")

    async def _maybe_send_heartbeat(self):
        """Send heartbeat to cloud if interval has passed."""
        if not self.cloud_sync:
            return

        now = time.time()
        if now - self._last_heartbeat >= self._heartbeat_interval:
            uptime = int(now - self._start_time)
            await self.cloud_sync.send_heartbeat(
                firmware_version="1.0.0",
                uptime_seconds=uptime
            )
            self._last_heartbeat = now

    def stop(self):
        """Stop the control loop."""
        self._running = False

    def get_status(self) -> dict:
        """Get current control state as dictionary."""
        status = {
            "cycle_count": self.state.cycle_count,
            "load_kw": self.state.load_kw,
            "dg_power_kw": self.state.dg_power_kw,
            "solar_output_kw": self.state.solar_output_kw,
            "solar_limit_pct": self.state.solar_limit_pct,
            "available_headroom_kw": self.state.available_headroom_kw,
            "dg_reserve_kw": self.dg_reserve_kw,
            "safe_mode_active": self.state.safe_mode_active,
            "config_mode": self.state.config_mode,
            "load_meters_online": self.state.load_meters_online,
            "inverters_online": self.state.inverters_online,
            "generators_online": self.state.generators_online,
            "uptime_seconds": int(time.time() - self._start_time),
        }

        # Add safe mode details if manager exists
        if self.safe_mode_manager:
            status["safe_mode"] = self.safe_mode_manager.get_status()

        # Add cloud sync status if enabled
        if self.cloud_sync:
            status["cloud_sync"] = self.cloud_sync.get_status()

        # Add database stats
        status["database"] = self.local_db.get_stats()

        return status


# For testing the control loop standalone
if __name__ == "__main__":
    import yaml

    # Load configuration
    with open("config.yaml", "r") as f:
        config = yaml.safe_load(f)

    # Create and run control loop
    loop = ControlLoop(config)

    try:
        asyncio.run(loop.run())
    except KeyboardInterrupt:
        print("\nStopped by user")
