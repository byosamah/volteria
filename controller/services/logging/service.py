"""
Logging Service (Layer 5) - Observability

Responsible for:
- Receiving and buffering control states
- Storing to local SQLite database (every 10 seconds)
- Syncing to cloud in batches (every 2 minutes)
- Evaluating threshold alarms
- Data retention cleanup
"""

import asyncio
import os
import signal
import uuid
from datetime import datetime, timezone
from pathlib import Path
from collections import deque

import yaml
from aiohttp import web

from common.state import SharedState, set_service_health, get_config, get_control_state
from common.config import AlarmDefinition, AlarmCondition
from common.logging_setup import get_service_logger

from .local_db import LocalDatabase
from .cloud_sync import CloudSync
from .alarm_evaluator import AlarmEvaluator, TriggeredAlarm

logger = get_service_logger("logging")

# Health server port
HEALTH_PORT = 8085

# Intervals
LOCAL_WRITE_INTERVAL_S = 10  # Write to SQLite every 10 seconds
CLOUD_SYNC_INTERVAL_S = 120  # Sync to cloud every 2 minutes
RETENTION_CHECK_INTERVAL_S = 3600  # Check retention every hour


class LoggingService:
    """
    Logging Service - Layer 5

    Implements 3-tier logging:
    1. In-memory buffer (every control loop)
    2. Local SQLite (every 10 seconds)
    3. Cloud sync (every 2 minutes)
    """

    def __init__(self, config_path: str | None = None):
        self.config_path = config_path or self._find_config_path()

        # Initialize components
        self.local_db = LocalDatabase()
        self.alarm_evaluator = AlarmEvaluator()

        # Cloud sync (initialized after config load)
        self.cloud_sync: CloudSync | None = None

        # In-memory buffers for aggregation
        self._load_buffer: deque[float] = deque(maxlen=1000)
        self._solar_buffer: deque[float] = deque(maxlen=1000)
        self._state_buffer: deque[dict] = deque(maxlen=100)

        # Configuration
        self._site_id: str | None = None
        self._local_write_interval = LOCAL_WRITE_INTERVAL_S
        self._cloud_sync_interval = CLOUD_SYNC_INTERVAL_S
        self._retention_days = 7
        self._instant_sync_alarms = True
        self._alarm_definitions: list[AlarmDefinition] = []

        self._start_time = datetime.now(timezone.utc)

        # Health server
        self._health_app: web.Application | None = None
        self._health_runner: web.AppRunner | None = None

        # State
        self._running = False
        self._local_write_task: asyncio.Task | None = None
        self._cloud_sync_task: asyncio.Task | None = None
        self._retention_task: asyncio.Task | None = None
        self._buffer_task: asyncio.Task | None = None
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

        # Start background tasks
        self._buffer_task = asyncio.create_task(self._buffer_loop())
        self._local_write_task = asyncio.create_task(self._local_write_loop())
        self._cloud_sync_task = asyncio.create_task(self._cloud_sync_loop())
        self._retention_task = asyncio.create_task(self._retention_loop())

        # Update service health to running
        set_service_health("logging", {
            "status": "running",
            "is_healthy": True,
            "started_at": self._start_time.isoformat(),
        })

        logger.info(
            f"Logging Service started (local: {self._local_write_interval}s, "
            f"cloud: {self._cloud_sync_interval}s)",
        )

        # Setup signal handlers
        self._setup_signal_handlers()

        # Wait for shutdown
        await self._shutdown_event.wait()

    async def stop(self) -> None:
        """Stop the logging service"""
        logger.info("Stopping Logging Service")

        self._running = False

        # Cancel tasks
        for task in [
            self._buffer_task,
            self._local_write_task,
            self._cloud_sync_task,
            self._retention_task,
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
        self._local_write_interval = logging_config.get("local_write_interval_s", 10)
        self._cloud_sync_interval = logging_config.get("cloud_sync_interval_s", 120)
        self._retention_days = logging_config.get("local_retention_days", 7)
        self._instant_sync_alarms = logging_config.get("instant_sync_alarms", True)

        # Load alarm definitions
        self._alarm_definitions = []
        for device in config.get("devices", []):
            for alarm_def in device.get("alarm_definitions", []):
                self._alarm_definitions.append(self._parse_alarm_definition(alarm_def))

        # Initialize cloud sync
        cloud_config = SharedState.read("controller_config")
        supabase_url = cloud_config.get("supabase_url") or os.environ.get("SUPABASE_URL", "")
        supabase_key = cloud_config.get("supabase_key") or os.environ.get("SUPABASE_SERVICE_KEY", "")

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

    async def _local_write_loop(self) -> None:
        """Write buffered data to local SQLite"""
        while self._running:
            await asyncio.sleep(self._local_write_interval)

            try:
                await self._write_to_local_db()
            except Exception as e:
                logger.error(f"Local write error: {e}")

    async def _cloud_sync_loop(self) -> None:
        """Sync local data to cloud"""
        while self._running:
            await asyncio.sleep(self._cloud_sync_interval)

            if self.cloud_sync:
                try:
                    result = await self.cloud_sync.sync_all()
                    if result["total_synced"] > 0:
                        logger.info(
                            f"Cloud sync: {result['logs_synced']} logs, "
                            f"{result['alarms_synced']} alarms"
                        )
                except Exception as e:
                    logger.error(f"Cloud sync error: {e}")

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

    async def _write_to_local_db(self) -> None:
        """Write buffered state to local database"""
        if not self._state_buffer:
            return

        # Get aggregated state (last value)
        state = self._state_buffer[-1]

        # Calculate min/max
        load_min = min(self._load_buffer) if self._load_buffer else state.get("total_load_kw", 0)
        load_max = max(self._load_buffer) if self._load_buffer else state.get("total_load_kw", 0)
        solar_min = min(self._solar_buffer) if self._solar_buffer else state.get("solar_output_kw", 0)
        solar_max = max(self._solar_buffer) if self._solar_buffer else state.get("solar_output_kw", 0)

        # Insert into database
        self.local_db.insert_control_log(
            timestamp=state.get("timestamp", datetime.now(timezone.utc).isoformat()),
            site_id=self._site_id,
            total_load_kw=state.get("total_load_kw", 0),
            solar_output_kw=state.get("solar_output_kw", 0),
            dg_power_kw=state.get("dg_power_kw", 0),
            solar_limit_pct=state.get("solar_limit_pct", 100),
            solar_limit_kw=state.get("solar_limit_kw", 0),
            safe_mode_active=state.get("safe_mode_active", False),
            config_mode=state.get("config_mode", "full_system"),
            operation_mode=state.get("operation_mode", "zero_dg_reverse"),
            load_meters_online=state.get("load_meters_online", 0),
            inverters_online=state.get("inverters_online", 0),
            generators_online=state.get("generators_online", 0),
            execution_time_ms=state.get("execution_time_ms", 0),
            load_min_max=(load_min, load_max),
            solar_min_max=(solar_min, solar_max),
        )

        # Clear buffers
        self._state_buffer.clear()
        self._load_buffer.clear()
        self._solar_buffer.clear()

        logger.debug("Wrote control log to local database")

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
        """Return logging statistics"""
        db_stats = self.local_db.get_stats()
        sync_stats = self.cloud_sync.get_stats() if self.cloud_sync else {}

        return web.json_response({
            "database": db_stats,
            "cloud_sync": sync_stats,
            "active_alarms": self.alarm_evaluator.get_active_alarms(),
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
