"""
Logging Service (Layer 5) - Observability

Responsible for:
- Receiving and buffering control states
- RAM buffering device readings to reduce SSD/SD card wear
- Flushing to local SQLite (default every 60 seconds)
- Syncing to cloud with per-register downsampling (default every 3 minutes)
- Evaluating threshold alarms
- Data retention cleanup

Architecture:
    Device Service → SharedState (raw readings every 1s)
           ↓
    RAM BUFFER (sample every _local_sample_interval seconds)
           ↓
    LOCAL SQLITE (flush every _local_flush_interval seconds)
           ↓
    CLOUD SYNC (every _cloud_sync_interval seconds, downsampled per-register)
"""

import asyncio
import os
import signal
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collections import deque, defaultdict

import yaml
from aiohttp import web

from common.state import SharedState, set_service_health, get_config, get_control_state
from common.config import AlarmDefinition, AlarmCondition
from common.logging_setup import get_service_logger
from common.timestamp import get_aligned_now_iso
from common.scheduler import ScheduledLoop

from .local_db import LocalDatabase
from .cloud_sync import CloudSync, BackfillPhase
from .alarm_evaluator import AlarmEvaluator, TriggeredAlarm

logger = get_service_logger("logging")

# Health server port
HEALTH_PORT = 8085

# Default intervals (can be overridden by site config)
RETENTION_CHECK_INTERVAL_S = 3600  # Check retention every hour

# Health alert thresholds
ALERT_DRIFT_MS = 5000  # Warn if scheduler drift > 5 seconds
ALERT_BUFFER_SIZE = 5000  # Warn if buffer > 5000 readings
ALERT_CONSECUTIVE_ERRORS = 3  # Warn after 3 consecutive errors


class LoggingService:
    """
    Logging Service - Layer 5

    Implements 3-tier logging with RAM buffering:
    1. RAM buffer - Sample from SharedState every _local_sample_interval (default 1s)
    2. Local SQLite - Flush RAM buffer every _local_flush_interval (default 60s)
    3. Cloud sync - Sync with downsampling every _cloud_sync_interval (default 180s)

    RAM buffering reduces SSD/SD card wear by batching writes.
    Per-register downsampling reduces cloud storage costs.
    """

    def __init__(self, config_path: str | None = None):
        self.config_path = config_path or self._find_config_path()

        # Initialize components
        self.local_db = LocalDatabase()
        self.alarm_evaluator = AlarmEvaluator()

        # Cloud sync (initialized after config load)
        self.cloud_sync: CloudSync | None = None

        # In-memory buffers for aggregation (control state)
        self._load_buffer: deque[float] = deque(maxlen=1000)
        self._solar_buffer: deque[float] = deque(maxlen=1000)
        self._state_buffer: deque[dict] = deque(maxlen=100)

        # RAM buffer for device readings (reduces SSD/SD card wear)
        # Readings accumulate here and flush to SQLite periodically
        self._device_readings_buffer: list[dict] = []
        self._readings_buffer_lock = asyncio.Lock()  # Thread-safe buffer access

        # Configuration
        self._site_id: str | None = None
        self._local_sample_interval = 1  # Sample readings into RAM every N seconds
        self._local_flush_interval = 60  # Flush RAM to SQLite every N seconds
        self._cloud_sync_interval = 180  # Cloud sync every 3 minutes (default)
        self._retention_days = 7
        self._instant_sync_alarms = True
        self._local_enabled = True  # Enable local SQLite logging
        self._cloud_enabled = True  # Enable cloud sync
        self._alarm_definitions: list[AlarmDefinition] = []

        # Calculated fields to log: {field_id: {config, last_cloud_synced}}
        self._calculated_fields_to_log: dict[str, dict] = {}

        self._start_time = datetime.now(timezone.utc)

        # Observability: timing metrics
        self._last_sample_time: datetime | None = None
        self._last_flush_time: datetime | None = None
        self._last_cloud_sync_time: datetime | None = None

        # Observability: error counters
        self._sample_error_count = 0
        self._flush_error_count = 0
        self._cloud_error_count = 0

        # Observability: drift tracking (for scheduler phase)
        self._sample_drift_ms: float = 0
        self._flush_drift_ms: float = 0

        # Health alerting: track consecutive errors and alert cooldowns
        self._consecutive_sample_errors = 0
        self._consecutive_flush_errors = 0
        self._last_drift_alert: datetime | None = None
        self._last_buffer_alert: datetime | None = None
        self._last_error_alert: datetime | None = None

        # Delta filter: track last control log for change detection
        self._last_control_log: dict | None = None

        # Debug: store last computed register frequencies for diagnostics
        self._last_register_frequencies: dict[tuple[str, str], int] = {}
        self._last_devices_type: str = ""
        self._last_devices_count: int = 0
        self._last_downsample_results: dict[str, dict] = {}  # reg_name -> {input, output, freq}

        # Diagnostics: enhanced tracking for debug endpoint
        self._frequency_lookup_misses: int = 0  # Registers without frequency config
        self._buffer_peak_24h: int = 0  # Max buffer size in 24h window
        self._clock_buckets_created: int = 0  # Total buckets created for downsampling
        self._clock_duplicates_skipped: int = 0  # Duplicates skipped during downsampling
        self._last_config_hash: str = ""  # Last config hash for change tracking
        self._last_config_change_time: datetime | None = None  # When config last changed

        # Periodic summary: track last summary time (10-minute intervals)
        self._last_health_summary_time: datetime | None = None

        # Drift auto-resolve: track consecutive low-drift checks
        self._consecutive_low_drift_checks: int = 0

        # Alarm condition tracking: track which alarms are currently triggered
        # Used for auto-resolution when condition clears (value returns to normal
        # or threshold config changes)
        self._previously_triggered_ids: set[str] = set()

        # Health server
        self._health_app: web.Application | None = None
        self._health_runner: web.AppRunner | None = None

        # State
        self._running = False
        self._buffer_task: asyncio.Task | None = None  # Control state buffer
        self._cloud_sync_task: asyncio.Task | None = None
        self._retention_task: asyncio.Task | None = None
        self._config_watch_task: asyncio.Task | None = None
        self._shutdown_event = asyncio.Event()

        # Schedulers for precise-interval tasks (initialized in start())
        self._sample_scheduler: ScheduledLoop | None = None
        self._flush_scheduler: ScheduledLoop | None = None

    async def _run_db(self, func, *args):
        """Run a blocking local_db method in a thread to avoid blocking the event loop."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, func, *args)

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
        """Start the logging service"""
        logger.info("Starting Logging Service")

        self._running = True

        # Update service health
        set_service_health("logging", {
            "status": "starting",
            "is_healthy": False,
        })

        # Load configuration
        await self._load_config()

        # Start health server
        await self._start_health_server()

        # Start scheduled loops (precise timing)
        self._sample_scheduler = ScheduledLoop(
            self._local_sample_interval,
            self._sample_callback,
            name="sample",
        )
        self._flush_scheduler = ScheduledLoop(
            self._local_flush_interval,
            self._flush_callback,
            name="flush",
        )
        await self._sample_scheduler.start()
        await self._flush_scheduler.start()

        # Start background tasks (less timing-sensitive)
        self._buffer_task = asyncio.create_task(self._buffer_loop())
        self._cloud_sync_task = asyncio.create_task(self._cloud_sync_loop())
        self._retention_task = asyncio.create_task(self._retention_loop())
        self._config_watch_task = asyncio.create_task(self._config_watch_loop())

        # Update service health to running
        set_service_health("logging", {
            "status": "running",
            "is_healthy": True,
            "started_at": self._start_time.isoformat(),
        })

        logger.info(
            f"Logging Service started (sample: {self._local_sample_interval}s, "
            f"flush: {self._local_flush_interval}s, cloud: {self._cloud_sync_interval}s)",
        )

        # Setup signal handlers
        self._setup_signal_handlers()

        # Wait for shutdown
        await self._shutdown_event.wait()

    async def stop(self) -> None:
        """Stop the logging service"""
        logger.info("Stopping Logging Service")

        self._running = False

        # Stop schedulers
        if self._sample_scheduler:
            self._sample_scheduler.stop()
        if self._flush_scheduler:
            self._flush_scheduler.stop()

        # Flush any remaining readings to SQLite before stopping
        await self._flush_readings_to_sqlite()

        # Cancel tasks
        for task in [
            self._buffer_task,
            self._cloud_sync_task,
            self._retention_task,
            self._config_watch_task,
        ]:
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        # Final sync
        if self.cloud_sync:
            await self.cloud_sync.sync_all()

        # Stop health server
        await self._stop_health_server()

        # Update service health
        set_service_health("logging", {
            "status": "stopped",
            "is_healthy": False,
        })

        logger.info("Logging Service stopped")

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
        """Load configuration from shared state"""
        # Wait for config to be available
        for _ in range(30):
            config = get_config()
            if config and config.get("id"):
                break
            await asyncio.sleep(1)
            logger.debug("Waiting for configuration...")

        config = get_config()
        if not config:
            logger.warning("No configuration available, using defaults")
            return

        # Extract settings
        self._site_id = config.get("id")

        logging_config = config.get("logging", {})
        # RAM buffering: sample every N seconds, flush to SQLite every M seconds
        # Sample interval: how often to capture readings into RAM (default 1s)
        self._local_sample_interval = max(1, logging_config.get("local_sample_interval_s") or 1)
        # Flush interval: how often to write RAM buffer to SQLite (default 60s)
        # This reduces SSD/SD card wear by batching writes
        self._local_flush_interval = max(1, logging_config.get("local_flush_interval_s") or 60)
        # Cloud sync interval (default 180s = 3 minutes)
        self._cloud_sync_interval = max(1, logging_config.get("cloud_sync_interval_s") or 180)
        self._retention_days = logging_config.get("local_retention_days", 7)
        self._instant_sync_alarms = logging_config.get("instant_sync_alarms", True)
        self._local_enabled = logging_config.get("local_enabled", True)
        self._cloud_enabled = logging_config.get("cloud_enabled", True)

        # Load alarm definitions
        self._alarm_definitions = []
        for device in config.get("devices", []):
            for alarm_def in device.get("alarm_definitions", []):
                self._alarm_definitions.append(self._parse_alarm_definition(alarm_def))

        # Convert alarm_registers.thresholds to alarm_definitions
        # This enables device register threshold alarms configured in the frontend
        for device in config.get("devices", []):
            device_id = device.get("id")
            device_name = device.get("name")

            # Build address-to-name lookup from registers (what device service actually reads)
            # This ensures alarm source_key matches the name used in SharedState
            registers = device.get("registers", [])
            address_to_name = {
                (r.get("address"), r.get("type")): r.get("name")
                for r in registers if r.get("address") is not None
            }

            for alarm_reg in device.get("alarm_registers", []):
                thresholds = alarm_reg.get("thresholds") or []
                if not thresholds:
                    continue
                # Look up actual register name by address+type, fall back to alarm_reg name
                alarm_addr = alarm_reg.get("address")
                alarm_type = alarm_reg.get("type")
                reg_name = address_to_name.get((alarm_addr, alarm_type)) or alarm_reg.get("name", "")
                alarm_def = {
                    "id": f"reg_{device_id}_{reg_name}",
                    "name": f"{reg_name} Alarm",
                    "source_type": "modbus_register",
                    "source_key": reg_name,
                    "device_id": device_id,
                    "device_name": device_name,
                    "conditions": [
                        {
                            "operator": t.get("operator", ">"),
                            "value": t.get("value", 0),
                            "severity": t.get("severity", "warning"),
                            "message": t.get("message") or f"{reg_name} {t.get('operator', '>')} {t.get('value', 0)}"
                        }
                        for t in thresholds
                    ],
                    "cooldown_seconds": 300,
                }
                self._alarm_definitions.append(self._parse_alarm_definition(alarm_def))

        # Load device-level calculated fields to log
        for device in config.get("devices", []):
            device_id = device.get("id")
            if not device_id:
                continue
            for calc_field in device.get("calculated_fields", []):
                if calc_field.get("storage_mode") == "log":
                    field_id = calc_field.get("field_id")
                    if field_id:
                        self._calculated_fields_to_log[f"{device_id}:{field_id}"] = {
                            "config": calc_field,
                            "device_id": device_id,
                            "last_cloud_synced": None,
                        }

        # Load site-level calculated fields
        for calc_field in config.get("calculated_fields", []):
            if calc_field.get("storage_mode", "log") == "log":
                field_id = calc_field.get("field_id")
                if field_id:
                    self._calculated_fields_to_log[f"site:{field_id}"] = {
                        "config": calc_field,
                        "device_id": None,
                        "last_cloud_synced": None,
                    }

        # Count registers from config (read fresh, no caching)
        register_count = sum(
            len(device.get("registers", []))
            for device in config.get("devices", [])
        )
        logger.info(
            f"Loaded logging config: {register_count} registers, "
            f"{len(self._calculated_fields_to_log)} calc fields, "
            f"local={self._local_enabled}, cloud={self._cloud_enabled}"
        )

        # Initialize cloud sync
        full_config = SharedState.read("controller_config")
        cloud_config = full_config.get("cloud", {}) if isinstance(full_config, dict) else {}
        supabase_url = cloud_config.get("supabase_url") or os.environ.get("SUPABASE_URL", "")
        supabase_key = cloud_config.get("supabase_key") or os.environ.get("SUPABASE_SERVICE_KEY", "")
        backend_url = cloud_config.get("backend_url") or os.environ.get("BACKEND_URL", "")

        if supabase_url and supabase_key and self._site_id:
            self.cloud_sync = CloudSync(
                site_id=self._site_id,
                supabase_url=supabase_url,
                supabase_key=supabase_key,
                local_db=self.local_db,
            )

        logger.info(f"Config loaded: {len(self._alarm_definitions)} alarm definitions")

    def _parse_alarm_definition(self, data: dict) -> AlarmDefinition:
        """Parse alarm definition from dict"""
        conditions = [
            AlarmCondition(
                operator=c.get("operator", ">"),
                value=c.get("value", 0),
                severity=c.get("severity", "warning"),
                message=c.get("message", ""),
            )
            for c in data.get("conditions", [])
        ]

        return AlarmDefinition(
            id=data.get("id", ""),
            name=data.get("name", ""),
            source_type=data.get("source_type", "modbus_register"),
            source_key=data.get("source_key", ""),
            conditions=conditions,
            enabled_by_default=data.get("enabled_by_default", True),
            cooldown_seconds=data.get("cooldown_seconds", 300),
            description=data.get("description", ""),
            device_id=data.get("device_id"),
            device_name=data.get("device_name"),
        )

    async def _buffer_loop(self) -> None:
        """Collect control states into buffer"""
        while self._running:
            try:
                # Get latest control state
                state = get_control_state()
                if state:
                    self._state_buffer.append(state)

                    # Add to min/max buffers
                    load = state.get("total_load_kw", 0)
                    solar = state.get("solar_output_kw", 0)
                    self._load_buffer.append(load)
                    self._solar_buffer.append(solar)

                    # Note: Device register alarms are evaluated in _sample_callback()
                    # which has access to device_readings. Evaluating here without
                    # device_readings would clear _previously_triggered_ids and
                    # cause instant auto-resolution of device alarms.

            except Exception as e:
                logger.error(f"Buffer loop error: {e}")

            await asyncio.sleep(1)  # Check every second

    async def _sample_callback(self) -> None:
        """
        Scheduler callback for sampling device readings into RAM buffer.

        Called by ScheduledLoop at precise _local_sample_interval intervals.
        Also evaluates device register alarms against current readings.
        """
        # Skip if local logging is disabled
        if not self._local_enabled:
            return

        try:
            # Sample readings and get them back for alarm evaluation
            device_readings = await self._sample_readings_to_buffer()
            self._last_sample_time = datetime.now(timezone.utc)
            if self._sample_scheduler:
                self._sample_drift_ms = self._sample_scheduler.drift_ms
            # Reset consecutive errors on success
            self._consecutive_sample_errors = 0

            # Evaluate device register alarms against current readings
            if device_readings and self._alarm_definitions:
                state = get_control_state() or {}
                await self._evaluate_alarms(state, device_readings)
        except Exception as e:
            self._sample_error_count += 1
            self._consecutive_sample_errors += 1
            logger.error(f"Sample callback error: {e}")

    async def _flush_callback(self) -> None:
        """
        Scheduler callback for flushing RAM buffer to SQLite.

        Called by ScheduledLoop at precise _local_flush_interval intervals.
        Also checks logging service health and raises alarms if needed.
        """
        # Handle disabled state
        if not self._local_enabled:
            # Clear buffer to prevent memory growth when disabled
            async with self._readings_buffer_lock:
                self._device_readings_buffer.clear()
            self._state_buffer.clear()
            self._load_buffer.clear()
            self._solar_buffer.clear()
            return

        # Get buffer count for health check
        async with self._readings_buffer_lock:
            buffer_count = len(self._device_readings_buffer)

        # Skip flush if buffer is empty (idle optimization)
        if buffer_count == 0 and not self._state_buffer:
            # Still check health even when idle
            await self._check_logging_health(buffer_count)
            return

        try:
            await self._flush_readings_to_sqlite()
            self._last_flush_time = datetime.now(timezone.utc)
            if self._flush_scheduler:
                self._flush_drift_ms = self._flush_scheduler.drift_ms
            # Reset consecutive errors on success
            self._consecutive_flush_errors = 0
        except Exception as e:
            self._flush_error_count += 1
            self._consecutive_flush_errors += 1
            logger.error(f"Flush callback error: {e}")

        # Check logging health and raise alarms if needed
        await self._check_logging_health(buffer_count)

    # Legacy loop methods kept for reference (now replaced by scheduler callbacks)
    async def _sample_loop(self) -> None:
        """
        Sample device readings into RAM buffer.

        Runs every _local_sample_interval seconds (default 1s).
        Readings accumulate in RAM to reduce disk writes.
        The _local_flush_loop periodically writes buffer to SQLite.
        """
        while self._running:
            # Check if local logging is disabled FIRST
            if not self._local_enabled:
                await asyncio.sleep(1)  # Check again in 1s
                continue

            await asyncio.sleep(self._local_sample_interval)

            try:
                await self._sample_readings_to_buffer()
                self._last_sample_time = datetime.now(timezone.utc)
            except Exception as e:
                self._sample_error_count += 1
                logger.error(f"Sample loop error: {e}")

    async def _sample_readings_to_buffer(self) -> dict | None:
        """
        Sample current device readings into RAM buffer.

        Iterates SharedState readings (whatever device service wrote).
        Register names come from SharedState, not config, to ensure
        we log what the device service actually produced.

        Timestamps are aligned to the sample interval boundary, ensuring
        all readings from the same cycle have identical timestamps for
        easy cross-device correlation.

        Buffer is flushed to SQLite by _local_flush_loop.

        Returns:
            dict: Device readings for alarm evaluation {device_id: {register_name: value}}
        """
        # Get device readings from shared state
        readings_state = SharedState.read("readings")
        if not readings_state or not readings_state.get("devices"):
            logger.debug("FLOW[sample]: No readings in SharedState")
            return None

        # Align timestamp to sample interval boundary
        # This ensures all readings from this cycle have identical timestamps
        # e.g., with 1s interval: 10:30:17.234 → 10:30:17.000
        current_timestamp = get_aligned_now_iso(self._local_sample_interval)

        # Count readings being sampled
        device_count = len(readings_state.get("devices", {}))
        reading_count = sum(
            len(d.get("readings", {}))
            for d in readings_state.get("devices", {}).values()
        )
        logger.debug(f"FLOW[sample]: {reading_count} readings from {device_count} devices @ {current_timestamp}")

        # Read config for unit lookups and register filtering
        # Only log registers that exist in current config (source of truth)
        config = get_config() or {}
        register_units: dict[tuple[str, str], str] = {}
        config_registers: set[tuple[str, str]] = set()
        for device in config.get("devices", []):
            device_id = device.get("id")
            if device_id:
                for reg in device.get("registers", []):
                    reg_name = reg.get("name")
                    if reg_name:
                        register_units[(device_id, reg_name)] = reg.get("unit", "")
                        config_registers.add((device_id, reg_name))

        # Iterate SharedState readings, filtered by current config
        async with self._readings_buffer_lock:
            for device_id, device_data in readings_state.get("devices", {}).items():
                for register_name, reading in device_data.get("readings", {}).items():
                    # Only log registers in current config (skip renamed/removed)
                    if config_registers and (device_id, register_name) not in config_registers:
                        continue

                    # Get unit from config if available
                    unit = register_units.get((device_id, register_name), "")

                    self._device_readings_buffer.append({
                        "site_id": self._site_id,
                        "device_id": device_id,
                        "register_name": register_name,  # From SharedState
                        "value": reading.get("value"),
                        "unit": unit,
                        "timestamp": current_timestamp,  # Always use aligned timestamp
                    })

        # Prevent unbounded memory growth (max 10000 readings ~= 2-3 MB)
        async with self._readings_buffer_lock:
            if len(self._device_readings_buffer) > 10000:
                excess = len(self._device_readings_buffer) - 10000
                self._device_readings_buffer = self._device_readings_buffer[excess:]
                logger.warning(f"RAM buffer overflow, dropped {excess} oldest readings")

        # Build device_readings dict for alarm evaluation
        # Structure: {device_id: {register_name: value}}
        device_readings: dict[str, dict[str, float | None]] = {}
        for device_id, device_data in readings_state.get("devices", {}).items():
            device_readings[device_id] = {
                reg_name: reg_data.get("value")
                for reg_name, reg_data in device_data.get("readings", {}).items()
                if reg_data.get("value") is not None
            }

        return device_readings

    async def _local_flush_loop(self) -> None:
        """
        Flush RAM buffer to local SQLite periodically.

        Runs every _local_flush_interval seconds (default 60s).
        Writes all buffered readings to SQLite in one batch,
        reducing SSD/SD card wear compared to writing every second.
        """
        while self._running:
            # Check if local logging is disabled FIRST
            if not self._local_enabled:
                # Clear buffer to prevent memory growth when disabled
                async with self._readings_buffer_lock:
                    self._device_readings_buffer.clear()
                self._state_buffer.clear()
                self._load_buffer.clear()
                self._solar_buffer.clear()
                await asyncio.sleep(1)  # Check again in 1s
                continue

            await asyncio.sleep(self._local_flush_interval)

            # Skip flush if buffer is empty (idle optimization)
            async with self._readings_buffer_lock:
                buffer_count = len(self._device_readings_buffer)
            if buffer_count == 0 and not self._state_buffer:
                continue

            try:
                await self._flush_readings_to_sqlite()
                self._last_flush_time = datetime.now(timezone.utc)
            except Exception as e:
                self._flush_error_count += 1
                logger.error(f"Local flush error: {e}")

    # Maximum buffer age in seconds (5x flush interval = ~5 min at 60s flush)
    MAX_BUFFER_AGE_S = 300

    async def _flush_readings_to_sqlite(self) -> None:
        """
        Flush RAM buffer to SQLite with failure handling.

        Writes all buffered device readings to local database.
        If SQLite write fails (after retries), keeps buffer for next attempt.
        Buffer is capped at MAX_BUFFER_AGE_S (5 min) to prevent unbounded growth.
        Also writes control log summary.
        """
        # Get buffer contents (don't clear yet)
        async with self._readings_buffer_lock:
            readings_batch = self._device_readings_buffer.copy()

        # Try to write device readings to SQLite (in thread to avoid blocking event loop)
        write_success = True
        if readings_batch:
            try:
                count = await self._run_db(self.local_db.insert_device_readings_batch, readings_batch)
                logger.debug(f"Flushed {count} readings to SQLite")
            except Exception as e:
                write_success = False
                logger.error(f"SQLite flush failed, keeping {len(readings_batch)} readings in buffer: {e}")

        # Only clear buffer if write succeeded
        if write_success:
            async with self._readings_buffer_lock:
                self._device_readings_buffer.clear()
        else:
            # Check buffer age - don't let it grow unbounded
            # Estimate: at 1s sampling, 300s = 300 samples per register
            # With ~10 registers = ~3000 readings max from this interval
            # 5 min worth = ~18000 readings (safety limit is 10000 in _sample_readings_to_buffer)
            async with self._readings_buffer_lock:
                buffer_size = len(self._device_readings_buffer)
                max_readings = int(self.MAX_BUFFER_AGE_S / self._local_sample_interval) * 100
                if buffer_size > max_readings:
                    excess = buffer_size - max_readings
                    self._device_readings_buffer = self._device_readings_buffer[excess:]
                    logger.warning(
                        f"Buffer exceeded {self.MAX_BUFFER_AGE_S}s limit, "
                        f"dropped {excess} oldest readings"
                    )

        # Write control log summary (aggregated state)
        await self._write_control_log_summary()

    async def _cloud_sync_loop(self) -> None:
        """
        Sync local data to cloud with per-register frequency filtering.

        - Control logs and alarms: sync ALL unsynced records
        - Device readings: sync based on each register's logging_frequency
        - Cloud health monitoring: raise CLOUD_SYNC_OFFLINE alarm after 1 hour offline
        """
        while self._running:
            # Check if cloud sync is disabled FIRST
            if not self._cloud_enabled:
                await asyncio.sleep(1)  # Check again in 1s
                continue

            # Accelerated sync during backfill (30s instead of 180s)
            if self.cloud_sync and self.cloud_sync.backfill.phase != BackfillPhase.NORMAL:
                await asyncio.sleep(30)  # 6x faster during backfill
            else:
                await asyncio.sleep(self._cloud_sync_interval)

            if not self.cloud_sync:
                logger.debug("FLOW[cloud]: No cloud_sync instance")
                continue

            sync_success = False
            try:
                # Sync control_logs and alarms (all unsynced)
                logs_synced = await self.cloud_sync.sync_logs()
                alarms_synced = await self.cloud_sync.sync_alarms()

                # Sync alarm resolutions FROM cloud TO local (bidirectional sync)
                # This ensures UI resolutions are reflected locally for deduplication
                await self.cloud_sync.sync_resolved_alarms()

                # Sync device_readings with per-register frequency filtering
                readings_synced = await self._sync_device_readings_filtered()

                total = logs_synced + alarms_synced + readings_synced
                self._last_cloud_sync_time = datetime.now(timezone.utc)

                # Cloud sync summary with [CLOUD] prefix for easy filtering
                if total > 0 or self.cloud_sync._duplicate_count > 0:
                    cloud_stats = self.cloud_sync.get_stats()
                    logger.info(
                        f"[CLOUD] uploaded={readings_synced}, logs={logs_synced}, alarms={alarms_synced}, "
                        f"duplicates={cloud_stats.get('duplicate_count', 0)}, "
                        f"empty_batches={cloud_stats.get('empty_batch_count', 0)}"
                    )
                elif total == 0:
                    logger.debug("FLOW[cloud]: No data to sync this cycle")

                # Mark sync as successful (at least one operation completed without error)
                sync_success = True
                self.cloud_sync.record_sync_success()

            except Exception as e:
                self._cloud_error_count += 1
                self.cloud_sync.record_sync_failure()
                logger.error(f"[ERROR] Cloud sync failed: {e}")

            # Check cloud health and raise/resolve alarms
            await self._check_cloud_offline_alarm()

    async def _sync_device_readings_filtered(self) -> int:
        """
        Sync device readings with per-register frequency downsampling.

        Reads config FRESH each sync cycle - no caching.

        All unsynced readings are processed in a batch (e.g., every 3 minutes).
        Each register is downsampled based on its logging_frequency:
        - Register with freq=1s: all readings sent (1 per second)
        - Register with freq=10s: every 10th reading sent
        - Register with freq=60s: every 60th reading sent

        This reduces cloud storage while maintaining configurable data density
        per register. Local SQLite keeps full resolution for local analysis.

        Returns:
            Number of readings synced to cloud
        """
        if not self.cloud_sync:
            return 0

        # Count pending to determine strategy
        pending_count = await self._run_db(self.local_db.get_unsynced_device_readings_count)
        if pending_count == 0:
            # Reset backfill state when fully caught up
            if self.cloud_sync.backfill.phase != BackfillPhase.NORMAL:
                elapsed = ""
                if self.cloud_sync.backfill.started_at:
                    elapsed_s = (datetime.now(timezone.utc) - self.cloud_sync.backfill.started_at).total_seconds()
                    elapsed = f" in {elapsed_s / 60:.1f} minutes"
                logger.info(
                    f"[CLOUD] Backfill complete: {self.cloud_sync.backfill.synced_count} "
                    f"readings recovered{elapsed}"
                )
                self.cloud_sync.backfill.reset()
            return 0

        # Two-phase backfill strategy:
        # Phase RECENT_FIRST: sync newest 5000 (dashboard shows current state quickly)
        # Phase FILLING_GAPS or NORMAL: sync oldest 5000 (fill gaps chronologically)
        if pending_count > CloudSync.BACKFILL_THRESHOLD and not self.cloud_sync.backfill.recent_synced:
            # First cycle after detecting backfill: sync newest
            unsynced = await self._run_db(self.local_db.get_unsynced_device_readings_newest, 5000)
        else:
            # Normal or gap-filling: sync oldest first
            unsynced = await self._run_db(self.local_db.get_unsynced_device_readings, 5000)

        if not unsynced:
            return 0

        # Tag readings with source for cloud tracking
        source = "backfill" if self.cloud_sync.backfill.phase != BackfillPhase.NORMAL else "live"
        for reading in unsynced:
            reading["source"] = source

        # Read FRESH config for logging_frequency lookups
        config = get_config()
        register_frequencies: dict[tuple[str, str], int] = {}
        if config:
            # Flatten devices - handles both dict format and flat list format
            # Dict format: {sensors: [...], inverters: [...], load_meters: [...]}
            # Flat list format: [device1, device2, ...]
            devices_raw = config.get("devices", [])
            all_devices: list = []

            if isinstance(devices_raw, dict):
                # Dict format: iterate values and extend
                for category_name, device_list in devices_raw.items():
                    if isinstance(device_list, list):
                        all_devices.extend(device_list)
                        logger.debug(f"Extracted {len(device_list)} devices from '{category_name}'")
            elif isinstance(devices_raw, list):
                # Flat list format (legacy or processed config)
                all_devices = devices_raw
                logger.debug(f"Using flat device list with {len(all_devices)} devices")
            else:
                logger.warning(f"Unexpected devices format: {type(devices_raw)}")

            self._last_devices_type = type(devices_raw).__name__
            self._last_devices_count = len(all_devices)

            # Extract logging_frequency for each register
            for device in all_devices:
                device_id = device.get("id")
                if not device_id:
                    continue
                for reg in device.get("registers", []):
                    reg_name = reg.get("name")
                    if reg_name:
                        # logging_frequency in seconds, default 60s, minimum 1s
                        freq = max(1, reg.get("logging_frequency") or 60)
                        register_frequencies[(device_id, reg_name)] = freq

            # Store for debug endpoint
            self._last_register_frequencies = register_frequencies.copy()

            # Log non-default frequencies (debug only)
            non_default = {k: v for k, v in register_frequencies.items() if v != 60}
            if non_default:
                logger.debug(f"Non-default frequencies: {len(non_default)} registers")

        # Group by (device_id, register_name)
        grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
        for reading in unsynced:
            key = (reading["device_id"], reading["register_name"])
            grouped[key].append(reading)

        # Downsample each register based on its logging_frequency
        to_sync: list[dict] = []
        all_reading_ids: list = []  # Track all IDs to mark as synced

        for (device_id, register_name), readings in grouped.items():
            # Collect all reading IDs (will mark all as synced after upload)
            all_reading_ids.extend([r["id"] for r in readings])

            # Get logging_frequency from config (default 60s)
            key = (device_id, register_name)
            frequency = register_frequencies.get(key, 60)

            # Track frequency lookup misses (registers not in config)
            if key not in register_frequencies:
                self._frequency_lookup_misses += 1
                # Log warning for first 10 misses only (don't spam)
                if self._frequency_lookup_misses <= 10:
                    logger.warning(
                        f"[FREQ] No logging_frequency for {device_id[:8]}:{register_name}, "
                        f"using default 60s"
                    )

            # Sort readings by timestamp (oldest first for proper sampling)
            sorted_readings = sorted(readings, key=lambda r: r.get("timestamp", ""))

            # Downsample: select readings at logging_frequency intervals
            selected = self._downsample_readings(sorted_readings, frequency)
            self._last_downsample_results[register_name] = {
                "input_count": len(readings),
                "output_count": len(selected),
                "frequency": frequency,
            }

            to_sync.extend(selected)

        # Push all downsampled readings to cloud in one batch
        synced_count = 0
        if to_sync:
            synced_count = await self.cloud_sync.sync_specific_readings(
                readings=to_sync,
                all_reading_ids=all_reading_ids,  # Mark ALL as synced
                total_pending=len(unsynced),  # For backfill progress tracking
            )

        if synced_count > 0:
            logger.debug(
                f"Cloud sync: {synced_count} readings uploaded "
                f"(downsampled from {len(unsynced)} local readings)"
            )

        return synced_count

    def _parse_timestamp_to_epoch(self, ts_str: str) -> float:
        """
        Parse ISO timestamp string to epoch seconds.

        Args:
            ts_str: ISO format timestamp (e.g., "2024-01-15T10:30:00.000Z")

        Returns:
            Epoch seconds, or 0 if parsing fails
        """
        if not ts_str:
            return 0
        try:
            if "T" in ts_str:
                # ISO format: 2024-01-15T10:30:00.000Z
                dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                return dt.timestamp()
            return float(ts_str)
        except (ValueError, TypeError):
            return 0

    def _downsample_readings(
        self,
        readings: list[dict],
        frequency_seconds: int,
    ) -> list[dict]:
        """
        Downsample readings to clock-aligned buckets.

        Uses wall-clock bucket selection instead of relative intervals.
        Each reading is assigned to a bucket based on floor division of
        its timestamp by the frequency. Only one reading per bucket is
        selected, and its timestamp is aligned to the bucket boundary.

        Examples for 15-min frequency (900s):
        - Reading at 21:00:05 → bucket 21:00:00 → selected, timestamp = 21:00:00
        - Reading at 21:01:23 → bucket 21:00:00 → skipped (bucket already has reading)
        - Reading at 21:15:02 → bucket 21:15:00 → selected, timestamp = 21:15:00

        Clock alignment examples by frequency:
        - 5s: :00, :05, :10, :15, :20...
        - 60s (1min): :00:00, :01:00, :02:00...
        - 900s (15min): :00:00, :15:00, :30:00, :45:00
        - 3600s (1hr): 00:00:00, 01:00:00, 02:00:00...

        Args:
            readings: List of readings sorted by timestamp (oldest first)
            frequency_seconds: Target interval between readings (bucket size)

        Returns:
            List of selected readings with clock-aligned timestamps
        """
        if not readings:
            return []

        if frequency_seconds <= 1:
            # No downsampling needed, return all readings as-is
            return readings

        selected: list[dict] = []
        selected_buckets: set[int] = set()
        duplicates_in_batch = 0

        for reading in readings:
            # Parse timestamp to epoch seconds
            ts = self._parse_timestamp_to_epoch(reading.get("timestamp", ""))
            if ts == 0:
                # Skip readings with invalid timestamps
                continue

            # Calculate clock-aligned bucket
            # Example: ts=1705693205 (21:00:05), freq=900 → bucket=1705693200 (21:00:00)
            bucket = int(ts // frequency_seconds) * frequency_seconds

            if bucket not in selected_buckets:
                # Create reading with aligned bucket timestamp
                aligned_reading = reading.copy()
                aligned_ts = datetime.fromtimestamp(bucket, timezone.utc).isoformat()
                aligned_reading["timestamp"] = aligned_ts
                selected.append(aligned_reading)
                selected_buckets.add(bucket)
                self._clock_buckets_created += 1
            else:
                duplicates_in_batch += 1

        # Track total duplicates skipped
        self._clock_duplicates_skipped += duplicates_in_batch

        return selected

    async def _retention_loop(self) -> None:
        """
        Periodic data retention cleanup.

        Only runs between 2-4 AM local time to avoid impacting
        performance during peak hours. Checks every hour.
        """
        while self._running:
            await asyncio.sleep(RETENTION_CHECK_INTERVAL_S)

            # Only run cleanup between 2-4 AM local time (off-peak)
            # This avoids VACUUM/cleanup impacting daytime performance
            now = datetime.now()
            if not (2 <= now.hour < 4):
                logger.debug(f"Skipping retention cleanup (hour={now.hour}, off-peak=2-4)")
                continue

            try:
                deleted = await self._run_db(self.local_db.cleanup_old_data, self._retention_days)
                if deleted > 0:
                    logger.info(f"Retention cleanup: deleted {deleted} old records")
            except Exception as e:
                logger.error(f"Retention cleanup error: {e}")

    async def _config_watch_loop(self) -> None:
        """
        Watch for config changes and reload when detected.

        Directly compares config content hash instead of relying on
        notification flags. Simpler and more reliable.
        """
        import hashlib
        import json as json_module

        watch_interval = 15.0  # Check every 15 seconds

        def compute_config_hash(config: dict) -> str:
            """Compute hash of logging-relevant config content"""
            content = {
                "devices": config.get("devices", []),
                "logging": config.get("logging", {}),
                "calculated_fields": config.get("calculated_fields", []),
            }
            content_str = json_module.dumps(content, sort_keys=True, default=str)
            return hashlib.md5(content_str.encode()).hexdigest()

        # Store current config hash
        current_hash = ""
        initial_config = get_config()
        if initial_config:
            current_hash = compute_config_hash(initial_config)

        while self._running:
            try:
                # Read fresh config from SharedState
                config = SharedState.read_fresh("config")
                if not config:
                    await asyncio.sleep(watch_interval)
                    continue

                new_hash = compute_config_hash(config)

                if new_hash != current_hash:
                    # Track config change for diagnostics
                    self._last_config_hash = new_hash
                    self._last_config_change_time = datetime.now(timezone.utc)

                    # Count devices and registers for detailed logging
                    devices_raw = config.get("devices", [])
                    if isinstance(devices_raw, dict):
                        device_count = sum(len(d) for d in devices_raw.values() if isinstance(d, list))
                        device_types = list(devices_raw.keys())
                    else:
                        device_count = len(devices_raw)
                        device_types = ["flat_list"]

                    old_register_count = sum(
                        len(device.get("registers", []))
                        for device in (get_config() or {}).get("devices", [])
                    )

                    # Capture old alarm definition IDs before reload
                    old_def_ids = {d.id for d in self._alarm_definitions}

                    # Reload configuration
                    await self._load_config()

                    # Reload alarm definitions
                    self.alarm_evaluator.update_definitions(self._alarm_definitions)

                    # Auto-resolve orphan alarms (definitions that no longer exist)
                    new_def_ids = {d.id for d in self._alarm_definitions}
                    orphaned_ids = old_def_ids - new_def_ids
                    for alarm_id in orphaned_ids:
                        count = await self._run_db(
                            self.local_db.resolve_alarms_by_type, alarm_id
                        )
                        if count > 0:
                            logger.info(
                                f"[CONFIG] Auto-resolved {count} orphan alarm(s): {alarm_id}"
                            )
                        # Always sync orphan resolution to cloud (even if local count=0,
                        # cloud may have unresolved alarm from before)
                        if self.cloud_sync:
                            await self.cloud_sync.resolve_alarm_in_cloud(alarm_id)

                    # Re-evaluate all definitions to handle threshold changes
                    # (same definition ID, but threshold operator/value changed)
                    # Example: user changes "< 45" to "> 45" - condition may no longer be met
                    await self._reevaluate_alarms_after_config_change()

                    current_hash = new_hash

                    # Count registers fresh from config
                    new_register_count = sum(
                        len(device.get("registers", []))
                        for device in config.get("devices", [])
                    )

                    # Detailed config change logging with [CONFIG] prefix
                    logger.info(
                        f"[CONFIG] Changed: devices={device_count} ({','.join(device_types)}), "
                        f"registers={new_register_count} (was {old_register_count}), "
                        f"cloud={self._cloud_enabled}, local={self._local_enabled}, "
                        f"hash={current_hash[:8]}"
                    )

            except Exception as e:
                logger.error(f"Error in config watch loop: {e}")

            await asyncio.sleep(watch_interval)

    async def _write_control_log_summary(self) -> None:
        """
        Write control log summary to local database.

        Called by _flush_readings_to_sqlite() to write aggregated
        control state (load/solar min/max, safe mode, etc.).

        Includes delta filter to skip writes when values haven't changed
        significantly (<1% delta), reducing disk wear during stable operation.

        Device readings are written separately via the RAM buffer.
        """
        # Get state from buffer or skip if empty
        if not self._state_buffer:
            return

        state = self._state_buffer[-1]

        # Calculate min/max from buffers
        load_min = min(self._load_buffer) if self._load_buffer else state.get("total_load_kw", 0)
        load_max = max(self._load_buffer) if self._load_buffer else state.get("total_load_kw", 0)
        solar_min = min(self._solar_buffer) if self._solar_buffer else state.get("solar_output_kw", 0)
        solar_max = max(self._solar_buffer) if self._solar_buffer else state.get("solar_output_kw", 0)

        # Build current values for delta comparison
        current_load = state.get("total_load_kw", 0)
        current_solar = state.get("solar_output_kw", 0)
        current_dg = state.get("dg_power_kw", 0)
        current_safe_mode = state.get("safe_mode_active", False)

        # Delta filter: skip write if values unchanged (<1% delta)
        # Always write if: safe_mode changed, first log, or significant change
        should_write = True
        if self._last_control_log is not None:
            last = self._last_control_log

            # Always write if safe mode status changed
            if current_safe_mode != last.get("safe_mode_active", False):
                should_write = True
            else:
                # Check if key values changed significantly (>1%)
                def delta_pct(new: float, old: float) -> float:
                    if old == 0:
                        return 100 if new != 0 else 0
                    return abs(new - old) / abs(old) * 100

                load_delta = delta_pct(current_load, last.get("total_load_kw", 0))
                solar_delta = delta_pct(current_solar, last.get("solar_output_kw", 0))
                dg_delta = delta_pct(current_dg, last.get("dg_power_kw", 0))

                # Skip if all deltas < 1%
                if load_delta < 1 and solar_delta < 1 and dg_delta < 1:
                    should_write = False
                    logger.debug(
                        f"Skipped control log (delta filter): load={load_delta:.1f}%, "
                        f"solar={solar_delta:.1f}%, dg={dg_delta:.1f}%"
                    )

        if not should_write:
            # Still clear buffers even if not writing
            self._state_buffer.clear()
            self._load_buffer.clear()
            self._solar_buffer.clear()
            return

        # Always use current timestamp for log entries (ensures uniqueness)
        current_timestamp = datetime.now(timezone.utc).isoformat()

        # Write control log (in thread to avoid blocking event loop)
        await self._run_db(
            self.local_db.insert_control_log,
            current_timestamp,        # timestamp
            self._site_id,            # site_id
            current_load,             # total_load_kw
            current_solar,            # solar_output_kw
            current_dg,               # dg_power_kw
            state.get("solar_limit_pct", 100),    # solar_limit_pct
            state.get("solar_limit_kw", 0),       # solar_limit_kw
            current_safe_mode,        # safe_mode_active
            state.get("config_mode", "full_system"),      # config_mode
            state.get("operation_mode", "zero_dg_reverse"),  # operation_mode
            state.get("load_meters_online", 0),   # load_meters_online
            state.get("inverters_online", 0),     # inverters_online
            state.get("generators_online", 0),    # generators_online
            state.get("execution_time_ms", 0),    # execution_time_ms
            None,                     # device_readings (now in separate table)
            (load_min, load_max),     # load_min_max
            (solar_min, solar_max),   # solar_min_max
        )
        logger.debug("Wrote control log summary")

        # Store for next delta comparison
        self._last_control_log = {
            "total_load_kw": current_load,
            "solar_output_kw": current_solar,
            "dg_power_kw": current_dg,
            "safe_mode_active": current_safe_mode,
        }

        # Clear state buffers (device readings buffer cleared separately)
        self._state_buffer.clear()
        self._load_buffer.clear()
        self._solar_buffer.clear()

    async def _evaluate_alarms(self, state: dict, device_readings: dict | None = None) -> None:
        """
        Evaluate alarms against current state and device readings.

        Args:
            state: Control state (total_load_kw, solar_output_kw, etc.)
            device_readings: Device register values {device_id: {register_name: value}}
        """
        if not self._alarm_definitions:
            return

        # Prepare readings for alarm evaluator
        readings = {
            "total_load_kw": state.get("total_load_kw", 0),
            "solar_output_kw": state.get("solar_output_kw", 0),
            "dg_power_kw": state.get("dg_power_kw", 0),
            "solar_limit_pct": state.get("solar_limit_pct", 100),
            "safe_mode_active": 1 if state.get("safe_mode_active") else 0,
        }

        # Add device registers for modbus_register alarms
        if device_readings:
            readings["device_registers"] = device_readings

        # Evaluate - returns both triggered alarms and active conditions
        # triggered: alarms to create (condition met AND cooldown expired)
        # active_conditions: alarm IDs where condition is met (regardless of cooldown)
        triggered, active_conditions = self.alarm_evaluator.evaluate(
            readings=readings,
            alarm_definitions=self._alarm_definitions,
        )

        # Auto-resolve alarms whose conditions have ACTUALLY cleared
        # Use active_conditions (not triggered) to avoid false auto-resolve during cooldown
        # This handles both:
        # A) Value changes (e.g., temp rises above threshold)
        # B) Threshold config changes (user changed < to >)
        for alarm_id in self._previously_triggered_ids:
            if alarm_id not in active_conditions:
                # Condition actually cleared! Auto-resolve this alarm type
                count = await self._run_db(
                    self.local_db.resolve_alarms_by_type,
                    alarm_id,
                )
                if count > 0:
                    logger.info(
                        f"[ALARM] Auto-resolved {count} alarm(s): {alarm_id} (condition cleared)"
                    )
                    # Also resolve in cloud so UI shows correct status
                    if self.cloud_sync:
                        await self.cloud_sync.resolve_alarm_in_cloud(alarm_id)

        # Update tracking for next evaluation cycle
        # Track active_conditions (not triggered) so we don't auto-resolve during cooldown
        self._previously_triggered_ids = active_conditions

        # Process triggered alarms
        for alarm in triggered:
            await self._process_alarm(alarm)

    async def _process_alarm(self, alarm: TriggeredAlarm) -> None:
        """Process a triggered alarm"""
        # Check for existing unresolved alarm to prevent duplicates (local check)
        has_existing = await self._run_db(
            self.local_db.has_unresolved_alarm,
            self._site_id,
            alarm.alarm_id,
            alarm.device_name,
        )
        if has_existing:
            logger.debug(
                f"Skipping duplicate alarm: {alarm.alarm_id} (unresolved exists in local)"
            )
            return

        # For high-severity alarms, also check cloud as fallback
        # This catches duplicates when local DB was cleared or resolution sync occurred
        if alarm.severity in ["critical", "major"] and self.cloud_sync:
            has_cloud = await self.cloud_sync.check_unresolved_alarm(
                alarm.alarm_id,
                alarm.device_name,
            )
            if has_cloud:
                logger.debug(
                    f"Skipping duplicate alarm: {alarm.alarm_id} (unresolved exists in cloud)"
                )
                return

        # Get message and condition separately
        message = alarm.get_formatted_message()
        condition = alarm.get_condition_text()

        # Insert to local database (in thread to avoid blocking event loop)
        local_alarm_id = await self._run_db(
            self.local_db.insert_alarm,
            str(uuid.uuid4()),              # alarm_id
            self._site_id,                  # site_id
            alarm.alarm_id,                 # alarm_type
            message,                        # message (user message only)
            alarm.severity,                 # severity
            alarm.timestamp.isoformat(),    # timestamp
            alarm.device_id,                # device_id
            alarm.device_name,              # device_name
            condition,                      # condition (e.g., "Temp > 25")
        )

        # Sync critical/major alarms immediately
        if self._instant_sync_alarms and alarm.severity in ["critical", "major"]:
            if self.cloud_sync:
                success = await self.cloud_sync.sync_alarm_immediately({
                    "alarm_type": alarm.alarm_id,
                    "message": message,
                    "condition": condition,
                    "severity": alarm.severity,
                    "device_name": alarm.device_name,
                    "timestamp": alarm.timestamp.isoformat(),
                })
                # Mark as synced to prevent duplicate sync via sync_alarms()
                if success and local_alarm_id:
                    await self._run_db(
                        self.local_db.mark_alarms_synced,
                        [local_alarm_id],
                    )

    async def _reevaluate_alarms_after_config_change(self) -> None:
        """
        Re-evaluate all alarm definitions after config change.

        This handles the case where a threshold was MODIFIED (same definition ID,
        different threshold values). Example: user changes "< 45" to "> 45".

        After config reload:
        1. Get current device readings from SharedState
        2. Evaluate all definitions against current readings
        3. For any definition NOT triggered, auto-resolve existing alarms

        This ensures alarms are resolved when:
        - User changes threshold operator (< to >)
        - User changes threshold value (45 to 20)
        - Current value no longer triggers the new threshold
        """
        if not self._alarm_definitions:
            return

        # Get current device readings from SharedState (same pattern as _sample_readings_to_buffer)
        readings_state = SharedState.read("readings")
        if not readings_state or not readings_state.get("devices"):
            logger.debug("[CONFIG] No device readings available for alarm re-evaluation")
            return

        # Build device_registers map: {device_id: {register_name: value}}
        # Structure: devices.{device_id}.readings.{register_name}.value
        device_registers = {}
        for device_id, device_data in readings_state.get("devices", {}).items():
            device_registers[device_id] = {
                reg_name: reg_data.get("value")
                for reg_name, reg_data in device_data.get("readings", {}).items()
                if reg_data.get("value") is not None
            }

        # Prepare readings for evaluator
        state = get_control_state() or {}
        readings = {
            "total_load_kw": state.get("total_load_kw", 0),
            "solar_output_kw": state.get("solar_output_kw", 0),
            "dg_power_kw": state.get("dg_power_kw", 0),
            "solar_limit_pct": state.get("solar_limit_pct", 100),
            "safe_mode_active": 1 if state.get("safe_mode_active") else 0,
            "device_registers": device_registers,
        }

        # Evaluate all definitions against current readings
        # Use active_conditions (not triggered) to check if condition is currently met
        # Pass check_only=True so we don't update cooldown state - that's only for
        # the regular sample callback. Config re-eval just checks current state.
        triggered, active_conditions = self.alarm_evaluator.evaluate(
            readings=readings,
            alarm_definitions=self._alarm_definitions,
            check_only=True,
        )

        # Auto-resolve alarms for definitions whose conditions are NOT met
        resolved_count = 0
        for definition in self._alarm_definitions:
            if definition.id not in active_conditions:
                # Definition exists but condition not met - auto-resolve
                count = await self._run_db(
                    self.local_db.resolve_alarms_by_type,
                    definition.id,
                )
                if count > 0:
                    resolved_count += count
                    logger.info(
                        f"[CONFIG] Auto-resolved {count} alarm(s): {definition.id} "
                        f"(threshold changed, condition no longer met)"
                    )
                # Always try to resolve in cloud (handles case where local was
                # already resolved but cloud wasn't, e.g., after code update)
                if self.cloud_sync:
                    await self.cloud_sync.resolve_alarm_in_cloud(definition.id)

        # Update tracking for subsequent evaluations
        self._previously_triggered_ids = active_conditions

        if resolved_count > 0:
            logger.info(f"[CONFIG] Total auto-resolved after config change: {resolved_count}")

    async def _check_cloud_offline_alarm(self) -> None:
        """
        Check cloud connectivity and raise/resolve CLOUD_SYNC_OFFLINE alarm.

        Called after each cloud sync attempt. Raises alarm if cloud has been
        unreachable for > 1 hour, auto-resolves when connection is restored.
        """
        if not self.cloud_sync:
            return

        alarm_info = self.cloud_sync.check_cloud_health()
        if not alarm_info:
            return

        if alarm_info["action"] == "raise":
            # Raise cloud offline alarm
            await self._run_db(
                self.local_db.insert_alarm,
                str(uuid.uuid4()),
                self._site_id,
                alarm_info["alarm_type"],
                alarm_info["message"],
                alarm_info["severity"],
                datetime.now(timezone.utc).isoformat(),
            )
            logger.warning(f"[CLOUD] Raised alarm: {alarm_info['message']}")

        elif alarm_info["action"] == "resolve":
            # Auto-resolve cloud offline alarm
            count = await self._run_db(
                self.local_db.resolve_alarms_by_type,
                alarm_info["alarm_type"],
            )
            if count > 0:
                if self.cloud_sync:
                    await self.cloud_sync.resolve_alarm_in_cloud(alarm_info["alarm_type"])
                logger.info(f"[CLOUD] Auto-resolved {count} CLOUD_SYNC_OFFLINE alarm(s)")

    async def _check_logging_health(self, buffer_count: int) -> None:
        """
        Check logging service health and raise alarms if needed.

        Checks:
        - High scheduler drift (> ALERT_DRIFT_MS)
        - Buffer buildup (> ALERT_BUFFER_SIZE)
        - Consecutive errors (> ALERT_CONSECUTIVE_ERRORS)

        Also logs periodic health summary every 10 minutes.
        Each alert has a 5-minute cooldown to avoid spam.
        """
        now = datetime.now(timezone.utc)
        cooldown = timedelta(minutes=5)

        # Track buffer peak for 24h diagnostics
        if buffer_count > self._buffer_peak_24h:
            self._buffer_peak_24h = buffer_count

        # Periodic health summary (every 10 minutes = 600 seconds)
        health_summary_interval = timedelta(minutes=10)
        if (
            self._last_health_summary_time is None
            or (now - self._last_health_summary_time) >= health_summary_interval
        ):
            self._last_health_summary_time = now
            # Log health summary with [HEALTH] prefix for easy filtering
            logger.info(
                f"[HEALTH] buffer={buffer_count}, "
                f"drift_sample={self._sample_drift_ms:.1f}ms, "
                f"drift_flush={self._flush_drift_ms:.1f}ms, "
                f"errors={{sample:{self._sample_error_count}, flush:{self._flush_error_count}, cloud:{self._cloud_error_count}}}"
            )

        # Check scheduler drift
        max_drift = max(self._sample_drift_ms, self._flush_drift_ms)
        if max_drift > ALERT_DRIFT_MS:
            self._consecutive_low_drift_checks = 0
            if self._last_drift_alert is None or (now - self._last_drift_alert) > cooldown:
                self._last_drift_alert = now
                await self._run_db(
                    self.local_db.insert_alarm,
                    str(uuid.uuid4()), self._site_id, "LOGGING_HIGH_DRIFT",
                    f"Logging scheduler drift is {max_drift:.0f}ms (threshold: {ALERT_DRIFT_MS}ms)",
                    "warning", now.isoformat(),
                )
                logger.warning(f"Logging health alert: scheduler drift {max_drift:.0f}ms")
        else:
            # Drift is healthy — track consecutive good checks for auto-resolve
            self._consecutive_low_drift_checks += 1
            if self._consecutive_low_drift_checks >= 3:
                # Auto-resolve outstanding LOGGING_HIGH_DRIFT alarms
                await self._run_db(
                    self.local_db.resolve_alarms_by_type, "LOGGING_HIGH_DRIFT",
                )
                if self.cloud_sync:
                    await self.cloud_sync.resolve_alarm_in_cloud("LOGGING_HIGH_DRIFT")
                if self._consecutive_low_drift_checks == 3:
                    logger.info("Drift recovered: auto-resolved LOGGING_HIGH_DRIFT alarms")

        # Check buffer buildup
        if buffer_count > ALERT_BUFFER_SIZE:
            if self._last_buffer_alert is None or (now - self._last_buffer_alert) > cooldown:
                self._last_buffer_alert = now
                await self._run_db(
                    self.local_db.insert_alarm,
                    str(uuid.uuid4()), self._site_id, "LOGGING_BUFFER_BUILDUP",
                    f"Logging buffer has {buffer_count} readings (threshold: {ALERT_BUFFER_SIZE})",
                    "warning", now.isoformat(),
                )
                logger.warning(f"Logging health alert: buffer buildup {buffer_count} readings")

        # Check consecutive errors
        max_consecutive = max(self._consecutive_sample_errors, self._consecutive_flush_errors)
        if max_consecutive >= ALERT_CONSECUTIVE_ERRORS:
            if self._last_error_alert is None or (now - self._last_error_alert) > cooldown:
                self._last_error_alert = now
                error_type = "sample" if self._consecutive_sample_errors >= ALERT_CONSECUTIVE_ERRORS else "flush"
                await self._run_db(
                    self.local_db.insert_alarm,
                    str(uuid.uuid4()), self._site_id, "LOGGING_CONSECUTIVE_ERRORS",
                    f"Logging {error_type} has failed {max_consecutive} times consecutively",
                    "major", now.isoformat(),
                )
                logger.error(f"Logging health alert: {max_consecutive} consecutive {error_type} errors")

    async def _start_health_server(self) -> None:
        """Start the health check HTTP server"""
        self._health_app = web.Application()
        self._health_app.router.add_get("/health", self._health_handler)
        self._health_app.router.add_get("/stats", self._stats_handler)
        self._health_app.router.add_get("/debug", self._debug_handler)

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

        return web.json_response({
            "status": "healthy" if self._running else "unhealthy",
            "service": "logging",
            "uptime": int(uptime),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    async def _stats_handler(self, request: web.Request) -> web.Response:
        """Return logging statistics with observability metrics"""
        db_stats = await self._run_db(self.local_db.get_stats)
        sync_stats = self.cloud_sync.get_stats() if self.cloud_sync else {}

        # Calculate buffer memory estimate (~300 bytes per reading)
        async with self._readings_buffer_lock:
            buffer_count = len(self._device_readings_buffer)
        buffer_memory_kb = buffer_count * 0.3

        return web.json_response({
            "database": db_stats,
            "cloud_sync": sync_stats,
            "active_alarms": self.alarm_evaluator.get_active_alarms(),
            # Observability: buffer metrics
            "buffer": {
                "readings_count": buffer_count,
                "state_buffer_count": len(self._state_buffer),
                "memory_kb": round(buffer_memory_kb, 1),
            },
            # Observability: timing metrics
            "timing": {
                "last_sample": self._last_sample_time.isoformat() if self._last_sample_time else None,
                "last_flush": self._last_flush_time.isoformat() if self._last_flush_time else None,
                "last_cloud_sync": self._last_cloud_sync_time.isoformat() if self._last_cloud_sync_time else None,
                "sample_interval_s": self._local_sample_interval,
                "flush_interval_s": self._local_flush_interval,
                "cloud_interval_s": self._cloud_sync_interval,
                # Drift tracking from schedulers
                "sample_drift_ms": round(self._sample_drift_ms, 1),
                "flush_drift_ms": round(self._flush_drift_ms, 1),
            },
            # Scheduler statistics
            "schedulers": {
                "sample": self._sample_scheduler.get_stats() if self._sample_scheduler else None,
                "flush": self._flush_scheduler.get_stats() if self._flush_scheduler else None,
            },
            # Observability: error counters
            "errors": {
                "sample_errors": self._sample_error_count,
                "flush_errors": self._flush_error_count,
                "cloud_errors": self._cloud_error_count,
            },
        })

    async def _debug_handler(self, request: web.Request) -> web.Response:
        """Return debug info about config and register frequencies"""
        # Get current config structure
        config = get_config() or {}
        devices_raw = config.get("devices", [])

        # Convert tuple keys to strings for JSON serialization
        freq_dict = {
            f"{dev_id[:8]}:{reg_name}": freq
            for (dev_id, reg_name), freq in self._last_register_frequencies.items()
        }

        # Count registers by frequency for diagnostics
        freq_counts: dict[int, int] = {}
        for freq in self._last_register_frequencies.values():
            freq_counts[freq] = freq_counts.get(freq, 0) + 1
        # Format as "Xs: N" for readability
        registers_by_frequency = {f"{f}s": c for f, c in sorted(freq_counts.items())}

        # Count devices by type
        devices_by_type: dict[str, int] = {}
        if isinstance(devices_raw, dict):
            for dtype, dlist in devices_raw.items():
                if isinstance(dlist, list):
                    devices_by_type[dtype] = len(dlist)
        else:
            devices_by_type["flat_list"] = len(devices_raw) if isinstance(devices_raw, list) else 0

        # Get cloud sync stats and local db stats
        cloud_stats = self.cloud_sync.get_stats() if self.cloud_sync else {}
        db_stats = await self._run_db(self.local_db.get_stats)

        # Get current buffer count
        async with self._readings_buffer_lock:
            buffer_count = len(self._device_readings_buffer)

        return web.json_response({
            "config_devices_type": type(devices_raw).__name__,
            "config_devices_keys": list(devices_raw.keys()) if isinstance(devices_raw, dict) else f"list[{len(devices_raw)}]",
            "last_sync_devices_type": self._last_devices_type,
            "last_sync_devices_count": self._last_devices_count,
            "register_frequencies": freq_dict,
            "register_count": len(self._last_register_frequencies),
            "downsample_results": self._last_downsample_results,
            "cloud_sync": cloud_stats,
            "local_db": db_stats,
            "timing": {
                "last_cloud_sync": self._last_cloud_sync_time.isoformat() if self._last_cloud_sync_time else None,
                "cloud_errors": self._cloud_error_count,
            },
            # NEW: Enhanced diagnostics section
            "diagnostics": {
                "config_hash": self._last_config_hash[:8] if self._last_config_hash else None,
                "config_last_change": self._last_config_change_time.isoformat() if self._last_config_change_time else None,
                "devices_by_type": devices_by_type,
                "registers_by_frequency": registers_by_frequency,
                "frequency_lookup_misses": self._frequency_lookup_misses,
                "buffer_current": buffer_count,
                "buffer_peak_24h": self._buffer_peak_24h,
                "clock_buckets_created": self._clock_buckets_created,
                "clock_duplicates_skipped": self._clock_duplicates_skipped,
                "backfill_phase": self.cloud_sync.backfill.phase.value if self.cloud_sync else "no_cloud",
                "backfill_total": self.cloud_sync.backfill.total_pending if self.cloud_sync else 0,
                "backfill_synced": self.cloud_sync.backfill.synced_count if self.cloud_sync else 0,
            },
        })


async def main() -> None:
    """Main entry point"""
    service = LoggingService()

    try:
        await service.start()
    finally:
        await service.stop()


if __name__ == "__main__":
    asyncio.run(main())
