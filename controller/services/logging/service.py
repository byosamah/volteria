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
from datetime import datetime, timezone
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
from .cloud_sync import CloudSync
from .alarm_evaluator import AlarmEvaluator, TriggeredAlarm

logger = get_service_logger("logging")

# Health server port
HEALTH_PORT = 8085

# Default intervals (can be overridden by site config)
RETENTION_CHECK_INTERVAL_S = 3600  # Check retention every hour


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

        # Delta filter: track last control log for change detection
        self._last_control_log: dict | None = None

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
        cloud_config = SharedState.read("controller_config")
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

                    # Evaluate alarms
                    await self._evaluate_alarms(state)

            except Exception as e:
                logger.error(f"Buffer loop error: {e}")

            await asyncio.sleep(1)  # Check every second

    async def _sample_callback(self) -> None:
        """
        Scheduler callback for sampling device readings into RAM buffer.

        Called by ScheduledLoop at precise _local_sample_interval intervals.
        """
        # Skip if local logging is disabled
        if not self._local_enabled:
            return

        try:
            await self._sample_readings_to_buffer()
            self._last_sample_time = datetime.now(timezone.utc)
            if self._sample_scheduler:
                self._sample_drift_ms = self._sample_scheduler.drift_ms
        except Exception as e:
            self._sample_error_count += 1
            logger.error(f"Sample callback error: {e}")

    async def _flush_callback(self) -> None:
        """
        Scheduler callback for flushing RAM buffer to SQLite.

        Called by ScheduledLoop at precise _local_flush_interval intervals.
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

        # Skip flush if buffer is empty (idle optimization)
        async with self._readings_buffer_lock:
            buffer_count = len(self._device_readings_buffer)
        if buffer_count == 0 and not self._state_buffer:
            return

        try:
            await self._flush_readings_to_sqlite()
            self._last_flush_time = datetime.now(timezone.utc)
            if self._flush_scheduler:
                self._flush_drift_ms = self._flush_scheduler.drift_ms
        except Exception as e:
            self._flush_error_count += 1
            logger.error(f"Flush callback error: {e}")

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

    async def _sample_readings_to_buffer(self) -> None:
        """
        Sample current device readings into RAM buffer.

        Iterates SharedState readings (whatever device service wrote).
        Register names come from SharedState, not config, to ensure
        we log what the device service actually produced.

        Timestamps are aligned to the sample interval boundary, ensuring
        all readings from the same cycle have identical timestamps for
        easy cross-device correlation.

        Buffer is flushed to SQLite by _local_flush_loop.
        """
        # Get device readings from shared state
        readings_state = SharedState.read("readings")
        if not readings_state or not readings_state.get("devices"):
            return

        # Align timestamp to sample interval boundary
        # This ensures all readings from this cycle have identical timestamps
        # e.g., with 1s interval: 10:30:17.234 → 10:30:17.000
        current_timestamp = get_aligned_now_iso(self._local_sample_interval)

        # Read config for unit lookups (optional enrichment)
        config = get_config() or {}
        register_units: dict[tuple[str, str], str] = {}
        for device in config.get("devices", []):
            device_id = device.get("id")
            if device_id:
                for reg in device.get("registers", []):
                    reg_name = reg.get("name")
                    if reg_name:
                        register_units[(device_id, reg_name)] = reg.get("unit", "")

        # Iterate SharedState readings (what device service actually wrote)
        async with self._readings_buffer_lock:
            for device_id, device_data in readings_state.get("devices", {}).items():
                for register_name, reading in device_data.get("readings", {}).items():
                    # Get unit from config if available
                    unit = register_units.get((device_id, register_name), "")

                    self._device_readings_buffer.append({
                        "site_id": self._site_id,
                        "device_id": device_id,
                        "register_name": register_name,  # From SharedState
                        "value": reading.get("value"),
                        "unit": unit,
                        "timestamp": reading.get("timestamp") or current_timestamp,
                    })

        # Prevent unbounded memory growth (max 10000 readings ~= 2-3 MB)
        async with self._readings_buffer_lock:
            if len(self._device_readings_buffer) > 10000:
                excess = len(self._device_readings_buffer) - 10000
                self._device_readings_buffer = self._device_readings_buffer[excess:]
                logger.warning(f"RAM buffer overflow, dropped {excess} oldest readings")

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

        # Try to write device readings to SQLite
        write_success = True
        if readings_batch:
            try:
                count = self.local_db.insert_device_readings_batch(readings_batch)
                logger.debug(f"Flushed {count} device readings to SQLite (from {len(readings_batch)} buffered)")
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
        """
        while self._running:
            # Check if cloud sync is disabled FIRST
            if not self._cloud_enabled:
                await asyncio.sleep(1)  # Check again in 1s
                continue

            await asyncio.sleep(self._cloud_sync_interval)

            if not self.cloud_sync:
                continue

            try:
                # Sync control_logs and alarms (all unsynced)
                logs_synced = await self.cloud_sync.sync_logs()
                alarms_synced = await self.cloud_sync.sync_alarms()

                # Sync device_readings with per-register frequency filtering
                readings_synced = await self._sync_device_readings_filtered()

                total = logs_synced + alarms_synced + readings_synced
                self._last_cloud_sync_time = datetime.now(timezone.utc)
                if total > 0:
                    logger.info(
                        f"Cloud sync: {logs_synced} logs, "
                        f"{alarms_synced} alarms, "
                        f"{readings_synced} device readings"
                    )
            except Exception as e:
                self._cloud_error_count += 1
                logger.error(f"Cloud sync error: {e}")

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

        # Get all unsynced readings from SQLite (batch for this sync window)
        unsynced = self.local_db.get_unsynced_device_readings(limit=5000)
        if not unsynced:
            return 0

        # Read FRESH config for logging_frequency lookups
        config = get_config()
        register_frequencies: dict[tuple[str, str], int] = {}
        if config:
            for device in config.get("devices", []):
                device_id = device.get("id")
                if not device_id:
                    continue
                for reg in device.get("registers", []):
                    reg_name = reg.get("name")
                    if reg_name:
                        # logging_frequency in seconds, default 60s, minimum 1s
                        freq = max(1, reg.get("logging_frequency") or 60)
                        register_frequencies[(device_id, reg_name)] = freq

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
            frequency = register_frequencies.get((device_id, register_name), 60)

            # Sort readings by timestamp (oldest first for proper sampling)
            sorted_readings = sorted(readings, key=lambda r: r.get("timestamp", ""))

            # Downsample: select readings at logging_frequency intervals
            # If we have readings at 1s intervals and freq=10s, take every 10th
            selected = self._downsample_readings(sorted_readings, frequency)
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

    def _downsample_readings(
        self,
        readings: list[dict],
        frequency_seconds: int,
    ) -> list[dict]:
        """
        Downsample readings to match the target frequency.

        Given readings at ~1s intervals and a target frequency of e.g. 10s,
        select one reading per 10-second window.

        Args:
            readings: List of readings sorted by timestamp (oldest first)
            frequency_seconds: Target interval between readings

        Returns:
            List of selected readings at the target frequency
        """
        if not readings:
            return []

        if frequency_seconds <= 1:
            # No downsampling needed, return all
            return readings

        selected: list[dict] = []
        last_selected_ts: float = 0

        for reading in readings:
            # Parse timestamp to epoch seconds
            ts_str = reading.get("timestamp", "")
            try:
                from datetime import datetime
                if "T" in ts_str:
                    # ISO format: 2024-01-15T10:30:00.000Z
                    dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    ts = dt.timestamp()
                else:
                    ts = float(ts_str) if ts_str else 0
            except (ValueError, TypeError):
                ts = 0

            # Select if enough time has passed since last selection
            if ts == 0 or (ts - last_selected_ts) >= frequency_seconds:
                selected.append(reading)
                last_selected_ts = ts if ts > 0 else last_selected_ts + frequency_seconds

        return selected

    async def _retention_loop(self) -> None:
        """Periodic data retention cleanup"""
        while self._running:
            await asyncio.sleep(RETENTION_CHECK_INTERVAL_S)

            try:
                deleted = self.local_db.cleanup_old_data(self._retention_days)
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
                    logger.info(f"Config change detected (hash: {current_hash[:8]} → {new_hash[:8]}), reloading...")

                    # Reload configuration
                    await self._load_config()

                    # Reload alarm definitions
                    self.alarm_evaluator.update_definitions(self._alarm_definitions)

                    current_hash = new_hash

                    # Count registers fresh from config
                    register_count = sum(
                        len(device.get("registers", []))
                        for device in config.get("devices", [])
                    )
                    logger.info(
                        f"Config reloaded: retention={self._retention_days}d, "
                        f"{len(self._alarm_definitions)} alarm definitions, "
                        f"{register_count} registers",
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

        # Write control log (device_readings is None - readings are in separate table)
        self.local_db.insert_control_log(
            timestamp=current_timestamp,
            site_id=self._site_id,
            total_load_kw=current_load,
            solar_output_kw=current_solar,
            dg_power_kw=current_dg,
            solar_limit_pct=state.get("solar_limit_pct", 100),
            solar_limit_kw=state.get("solar_limit_kw", 0),
            safe_mode_active=current_safe_mode,
            config_mode=state.get("config_mode", "full_system"),
            operation_mode=state.get("operation_mode", "zero_dg_reverse"),
            load_meters_online=state.get("load_meters_online", 0),
            inverters_online=state.get("inverters_online", 0),
            generators_online=state.get("generators_online", 0),
            execution_time_ms=state.get("execution_time_ms", 0),
            device_readings=None,  # Readings now in separate device_readings table
            load_min_max=(load_min, load_max),
            solar_min_max=(solar_min, solar_max),
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

    async def _evaluate_alarms(self, state: dict) -> None:
        """Evaluate alarms against current state"""
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

        # Evaluate
        triggered = self.alarm_evaluator.evaluate(
            readings=readings,
            alarm_definitions=self._alarm_definitions,
        )

        # Process triggered alarms
        for alarm in triggered:
            await self._process_alarm(alarm)

    async def _process_alarm(self, alarm: TriggeredAlarm) -> None:
        """Process a triggered alarm"""
        # Insert to local database
        self.local_db.insert_alarm(
            alarm_id=str(uuid.uuid4()),
            site_id=self._site_id,
            alarm_type=alarm.alarm_id,
            message=alarm.message,
            severity=alarm.severity,
            timestamp=alarm.timestamp.isoformat(),
            device_id=alarm.device_id,
            device_name=alarm.device_name,
        )

        # Sync critical alarms immediately
        if self._instant_sync_alarms and alarm.severity in ["critical", "major"]:
            if self.cloud_sync:
                await self.cloud_sync.sync_alarm_immediately({
                    "alarm_type": alarm.alarm_id,
                    "message": alarm.message,
                    "severity": alarm.severity,
                    "device_name": alarm.device_name,
                    "timestamp": alarm.timestamp.isoformat(),
                })

    async def _start_health_server(self) -> None:
        """Start the health check HTTP server"""
        self._health_app = web.Application()
        self._health_app.router.add_get("/health", self._health_handler)
        self._health_app.router.add_get("/stats", self._stats_handler)

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
        db_stats = self.local_db.get_stats()
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


async def main() -> None:
    """Main entry point"""
    service = LoggingService()

    try:
        await service.start()
    finally:
        await service.stop()


if __name__ == "__main__":
    asyncio.run(main())
