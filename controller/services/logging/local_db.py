"""
Local SQLite Database

Stores control logs and alarms locally for offline operation.
Uses batched writes for performance (every 10 seconds).
"""

import sqlite3
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from contextlib import contextmanager

from common.logging_setup import get_service_logger

logger = get_service_logger("logging.local_db")

# Default database path
DEFAULT_DB_PATH = Path("/opt/volteria/data/controller.db")


class LocalDatabase:
    """
    SQLite database for local data storage.

    Features:
    - Batched writes for reduced disk I/O
    - Sync tracking (synced_at column)
    - Automatic table creation
    - Data retention cleanup
    """

    def __init__(self, db_path: Path | None = None):
        self.db_path = db_path or DEFAULT_DB_PATH

        # Ensure directory exists
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        # Initialize database
        self._init_db()

    def _init_db(self) -> None:
        """Initialize database schema"""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            # Enable incremental auto_vacuum for NEW databases only.
            # Don't set on existing DBs — it writes to the header without
            # converting the file, masking the need for a full VACUUM.
            table_count = cursor.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
            ).fetchone()[0]
            if table_count == 0:
                cursor.execute("PRAGMA auto_vacuum = INCREMENTAL")

            # Log vacuum status — marker file is the reliable indicator
            from pathlib import Path
            vacuum_marker = Path(self.db_path).parent / ".vacuum_done"
            if table_count > 0 and not vacuum_marker.exists():
                logger.warning(
                    "SQLite needs one-time VACUUM (marker not found). "
                    "Will run on next retention cleanup."
                )

            # Control logs table with aggregated values
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS control_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    site_id TEXT,

                    -- Core metrics
                    total_load_kw REAL,
                    total_load_kw_min REAL,
                    total_load_kw_max REAL,

                    solar_output_kw REAL,
                    solar_output_kw_min REAL,
                    solar_output_kw_max REAL,

                    dg_power_kw REAL,
                    solar_limit_pct REAL,
                    solar_limit_kw REAL,

                    -- Status
                    safe_mode_active INTEGER DEFAULT 0,
                    config_mode TEXT,
                    operation_mode TEXT,

                    -- Device counts
                    load_meters_online INTEGER DEFAULT 0,
                    inverters_online INTEGER DEFAULT 0,
                    generators_online INTEGER DEFAULT 0,

                    -- Execution
                    execution_time_ms REAL,

                    -- Per-device readings as JSON
                    device_readings TEXT,

                    -- Sync tracking
                    synced_at TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)

            # Alarms table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS alarms (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    alarm_id TEXT NOT NULL,
                    site_id TEXT,
                    alarm_type TEXT NOT NULL,
                    device_id TEXT,
                    device_name TEXT,
                    message TEXT,
                    condition TEXT,
                    severity TEXT DEFAULT 'warning',
                    timestamp TEXT NOT NULL,

                    -- Resolution
                    acknowledged INTEGER DEFAULT 0,
                    acknowledged_by TEXT,
                    acknowledged_at TEXT,
                    resolved INTEGER DEFAULT 0,
                    resolved_at TEXT,

                    -- Sync tracking
                    synced_at TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)

            # Add condition column if it doesn't exist (for existing databases)
            try:
                cursor.execute("ALTER TABLE alarms ADD COLUMN condition TEXT")
            except Exception:
                pass  # Column already exists

            # Device readings table (separate from control_logs)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS device_readings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    site_id TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    register_name TEXT NOT NULL,
                    value REAL NOT NULL,
                    unit TEXT,
                    timestamp TEXT NOT NULL,
                    source TEXT DEFAULT 'live',
                    synced_at TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)

            # Create indexes
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_logs_timestamp
                ON control_logs(timestamp)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_logs_unsynced
                ON control_logs(synced_at) WHERE synced_at IS NULL
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_alarms_timestamp
                ON alarms(timestamp)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_alarms_unsynced
                ON alarms(synced_at) WHERE synced_at IS NULL
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_device_readings_timestamp
                ON device_readings(timestamp)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_device_readings_unsynced
                ON device_readings(synced_at) WHERE synced_at IS NULL
            """)

            # Migration: add source column if not exists
            try:
                cursor.execute("SELECT source FROM device_readings LIMIT 1")
            except sqlite3.OperationalError:
                cursor.execute("ALTER TABLE device_readings ADD COLUMN source TEXT DEFAULT 'live'")
                logger.info("Migrated device_readings: added 'source' column")

            conn.commit()

        logger.info(f"Database initialized: {self.db_path}")

    @contextmanager
    def _get_connection(self):
        """Get database connection with context manager and disk-wear optimizations"""
        # timeout=10.0: Fail fast on lock contention instead of blocking forever
        # Prevents infinite waits when VACUUM or other operations hold the lock
        conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        conn.row_factory = sqlite3.Row

        # Disk wear optimizations for SD card/SSD longevity:
        # - WAL mode: writes to separate log file instead of rewriting main DB
        # - synchronous=NORMAL: safe with WAL, reduces fsyncs (2-3x fewer writes)
        # - temp_store=MEMORY: keep temp tables/indexes in RAM (no temp file writes)
        # - cache_size=-2000: 2MB cache reduces disk reads
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA temp_store=MEMORY")
        conn.execute("PRAGMA cache_size=-2000")

        try:
            yield conn
        finally:
            conn.close()

    def insert_control_log(
        self,
        timestamp: str,
        site_id: str | None,
        total_load_kw: float,
        solar_output_kw: float,
        dg_power_kw: float,
        solar_limit_pct: float,
        solar_limit_kw: float,
        safe_mode_active: bool,
        config_mode: str,
        operation_mode: str,
        load_meters_online: int,
        inverters_online: int,
        generators_online: int,
        execution_time_ms: float,
        device_readings: dict | None = None,
        load_min_max: tuple[float, float] | None = None,
        solar_min_max: tuple[float, float] | None = None,
    ) -> int:
        """Insert a control log entry"""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO control_logs (
                    timestamp, site_id,
                    total_load_kw, total_load_kw_min, total_load_kw_max,
                    solar_output_kw, solar_output_kw_min, solar_output_kw_max,
                    dg_power_kw, solar_limit_pct, solar_limit_kw,
                    safe_mode_active, config_mode, operation_mode,
                    load_meters_online, inverters_online, generators_online,
                    execution_time_ms, device_readings
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                timestamp,
                site_id,
                total_load_kw,
                load_min_max[0] if load_min_max else total_load_kw,
                load_min_max[1] if load_min_max else total_load_kw,
                solar_output_kw,
                solar_min_max[0] if solar_min_max else solar_output_kw,
                solar_min_max[1] if solar_min_max else solar_output_kw,
                dg_power_kw,
                solar_limit_pct,
                solar_limit_kw,
                1 if safe_mode_active else 0,
                config_mode,
                operation_mode,
                load_meters_online,
                inverters_online,
                generators_online,
                execution_time_ms,
                json.dumps(device_readings) if device_readings else None,
            ))

            conn.commit()
            return cursor.lastrowid

    def insert_alarm(
        self,
        alarm_id: str,
        site_id: str | None,
        alarm_type: str,
        message: str,
        severity: str,
        timestamp: str,
        device_id: str | None = None,
        device_name: str | None = None,
        condition: str | None = None,
    ) -> int:
        """Insert an alarm entry"""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO alarms (
                    alarm_id, site_id, alarm_type, device_id, device_name,
                    message, condition, severity, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                alarm_id,
                site_id,
                alarm_type,
                device_id,
                device_name,
                message,
                condition,
                severity,
                timestamp,
            ))

            conn.commit()
            return cursor.lastrowid

    def resolve_alarms_by_type(self, alarm_type: str) -> int:
        """Mark all unresolved alarms of a given type as resolved.

        Note: Does NOT reset synced_at. For reg_* threshold alarms, cloud sync
        skips resolution sync anyway. Setting synced_at=NULL would cause
        sync_alarms() to POST a new record (duplicate) instead of updating.
        """
        with self._get_connection() as conn:
            cursor = conn.cursor()
            now = datetime.now(timezone.utc).isoformat()
            cursor.execute("""
                UPDATE alarms
                SET resolved = 1, resolved_at = ?
                WHERE alarm_type = ? AND resolved = 0
            """, (now, alarm_type))
            conn.commit()
            return cursor.rowcount

    def resolve_alarms_by_type_and_device(self, alarm_type: str, device_id: str) -> int:
        """Mark unresolved alarms of a given type+device as resolved."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            now = datetime.now(timezone.utc).isoformat()
            cursor.execute("""
                UPDATE alarms
                SET resolved = 1, resolved_at = ?
                WHERE alarm_type = ? AND device_id = ? AND resolved = 0
            """, (now, alarm_type, device_id))
            conn.commit()
            return cursor.rowcount

    def has_unresolved_alarm(
        self,
        site_id: str,
        alarm_type: str,
        device_id: str | None = None,
    ) -> bool:
        """Check if an unresolved alarm already exists for this type/device.

        Used to prevent duplicate alarms while a threshold is still exceeded.
        """
        with self._get_connection() as conn:
            cursor = conn.cursor()
            if device_id:
                cursor.execute("""
                    SELECT 1 FROM alarms
                    WHERE site_id = ? AND alarm_type = ? AND device_id = ? AND resolved = 0
                    LIMIT 1
                """, (site_id, alarm_type, device_id))
            else:
                cursor.execute("""
                    SELECT 1 FROM alarms
                    WHERE site_id = ? AND alarm_type = ? AND resolved = 0
                    LIMIT 1
                """, (site_id, alarm_type))
            return cursor.fetchone() is not None

    def sync_alarm_resolution(
        self,
        site_id: str,
        alarm_type: str,
        device_id: str | None,
        resolved_at: str | None,
    ) -> int:
        """Sync alarm resolution status from cloud to local.

        Updates local alarms to match cloud resolved status.
        This enables proper deduplication after UI resolution.

        Args:
            site_id: Site ID
            alarm_type: Alarm type (e.g., reg_{device_id}_{register_name})
            device_id: Device ID (optional)
            resolved_at: Resolution timestamp from cloud

        Returns:
            Number of alarms updated
        """
        with self._get_connection() as conn:
            cursor = conn.cursor()
            resolved_time = resolved_at or datetime.now(timezone.utc).isoformat()

            # Only resolve alarms created BEFORE the resolution timestamp
            # This prevents incorrectly resolving NEW alarms when syncing old resolutions
            if device_id:
                cursor.execute("""
                    UPDATE alarms
                    SET resolved = 1, resolved_at = ?
                    WHERE site_id = ? AND alarm_type = ? AND device_id = ? AND resolved = 0
                      AND created_at <= ?
                """, (resolved_time, site_id, alarm_type, device_id, resolved_time))
            else:
                cursor.execute("""
                    UPDATE alarms
                    SET resolved = 1, resolved_at = ?
                    WHERE site_id = ? AND alarm_type = ? AND resolved = 0
                      AND created_at <= ?
                """, (resolved_time, site_id, alarm_type, resolved_time))

            conn.commit()
            return cursor.rowcount

    def get_unsynced_logs(self, limit: int = 100) -> list[dict]:
        """Get control logs that haven't been synced"""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT * FROM control_logs
                WHERE synced_at IS NULL
                ORDER BY timestamp ASC
                LIMIT ?
            """, (limit,))

            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def get_unsynced_alarms(self, limit: int = 100) -> list[dict]:
        """Get alarms that haven't been synced"""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT * FROM alarms
                WHERE synced_at IS NULL
                ORDER BY timestamp ASC
                LIMIT ?
            """, (limit,))

            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def mark_logs_synced(self, log_ids: list[int]) -> None:
        """Mark control logs as synced"""
        if not log_ids:
            return

        with self._get_connection() as conn:
            cursor = conn.cursor()
            now = datetime.now(timezone.utc).isoformat()

            placeholders = ",".join("?" for _ in log_ids)
            cursor.execute(f"""
                UPDATE control_logs
                SET synced_at = ?
                WHERE id IN ({placeholders})
            """, [now] + log_ids)

            conn.commit()

    def mark_alarms_synced(self, alarm_ids: list[int]) -> None:
        """Mark alarms as synced"""
        if not alarm_ids:
            return

        with self._get_connection() as conn:
            cursor = conn.cursor()
            now = datetime.now(timezone.utc).isoformat()

            placeholders = ",".join("?" for _ in alarm_ids)
            cursor.execute(f"""
                UPDATE alarms
                SET synced_at = ?
                WHERE id IN ({placeholders})
            """, [now] + alarm_ids)

            conn.commit()

    def cleanup_old_data(self, retention_days: int) -> int:
        """Delete data older than retention period"""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            # Calculate cutoff date
            cutoff = datetime.now(timezone.utc)
            cutoff = cutoff.replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            from datetime import timedelta
            cutoff = cutoff - timedelta(days=retention_days)
            cutoff_str = cutoff.isoformat()

            # Delete old logs
            cursor.execute("""
                DELETE FROM control_logs
                WHERE timestamp < ? AND synced_at IS NOT NULL
            """, (cutoff_str,))
            logs_deleted = cursor.rowcount

            # Delete old alarms
            cursor.execute("""
                DELETE FROM alarms
                WHERE timestamp < ? AND synced_at IS NOT NULL
            """, (cutoff_str,))
            alarms_deleted = cursor.rowcount

            # Delete old device readings
            cursor.execute("""
                DELETE FROM device_readings
                WHERE timestamp < ? AND synced_at IS NOT NULL
            """, (cutoff_str,))
            readings_deleted = cursor.rowcount

            conn.commit()

            total_deleted = logs_deleted + alarms_deleted + readings_deleted

            # Reclaim disk space from deleted rows.
            # Use a marker file because PRAGMA auto_vacuum is unreliable —
            # previous _init_db() calls wrote INCREMENTAL to the header
            # without actually converting the DB via VACUUM.
            from pathlib import Path
            vacuum_marker = Path(self.db_path).parent / ".vacuum_done"
            if not vacuum_marker.exists() and total_deleted > 0:
                logger.info("One-time VACUUM: converting DB and reclaiming space")
                cursor.execute("PRAGMA auto_vacuum = INCREMENTAL")
                cursor.execute("VACUUM")
                vacuum_marker.touch()
                logger.info("One-time VACUUM complete — incremental_vacuum now works")
            else:
                # Subsequent cleanups: incremental vacuum in small chunks
                cursor.execute("PRAGMA incremental_vacuum(5000)")

            if total_deleted > 0:
                logger.info(
                    f"Cleaned up {logs_deleted} logs, {alarms_deleted} alarms, "
                    f"{readings_deleted} device readings older than {retention_days} days"
                )

            return total_deleted

    def get_stats(self) -> dict:
        """Get database statistics"""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("SELECT COUNT(*) FROM control_logs")
            total_logs = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM control_logs WHERE synced_at IS NULL")
            unsynced_logs = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM alarms")
            total_alarms = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM alarms WHERE synced_at IS NULL")
            unsynced_alarms = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM device_readings")
            total_device_readings = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM device_readings WHERE synced_at IS NULL")
            unsynced_device_readings = cursor.fetchone()[0]

            return {
                "total_logs": total_logs,
                "unsynced_logs": unsynced_logs,
                "total_alarms": total_alarms,
                "unsynced_alarms": unsynced_alarms,
                "total_device_readings": total_device_readings,
                "unsynced_device_readings": unsynced_device_readings,
                "db_size_bytes": self.db_path.stat().st_size if self.db_path.exists() else 0,
            }

    def insert_device_reading(
        self,
        site_id: str,
        device_id: str,
        register_name: str,
        value: float,
        timestamp: str,
        unit: str | None = None,
    ) -> int:
        """Insert a single device reading"""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO device_readings (
                    site_id, device_id, register_name, value, unit, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?)
            """, (site_id, device_id, register_name, value, unit, timestamp))

            conn.commit()
            return cursor.lastrowid

    # Retry backoff for write operations (0.5s, 1s, 2s)
    WRITE_RETRY_BACKOFF = [0.5, 1.0, 2.0]

    # Chunk size for batch inserts (reduces lock duration)
    BATCH_CHUNK_SIZE = 1000

    def insert_device_readings_batch(
        self,
        readings: list[dict],
    ) -> int:
        """
        Insert multiple device readings in chunked batches with retry logic.

        Splits large batches into BATCH_CHUNK_SIZE (1000) chunks to reduce
        lock duration. Each chunk is a separate transaction.

        Retries on failure with exponential backoff (0.5s, 1s, 2s) to handle
        transient disk errors. If all retries fail, raises the exception.

        Args:
            readings: List of reading dicts

        Returns:
            Number of rows inserted

        Raises:
            sqlite3.Error: If all retry attempts fail
        """
        if not readings:
            return 0

        total_inserted = 0

        # Process in chunks to reduce lock duration
        for chunk_start in range(0, len(readings), self.BATCH_CHUNK_SIZE):
            chunk = readings[chunk_start:chunk_start + self.BATCH_CHUNK_SIZE]
            inserted = self._insert_readings_chunk(chunk)
            total_inserted += inserted

        return total_inserted

    def _insert_readings_chunk(self, readings: list[dict]) -> int:
        """Insert a single chunk of readings with retry logic."""
        last_error: Exception | None = None

        for attempt, delay in enumerate([0] + self.WRITE_RETRY_BACKOFF):
            if attempt > 0:
                import time
                logger.warning(
                    f"SQLite write retry {attempt}/{len(self.WRITE_RETRY_BACKOFF)} "
                    f"after {delay}s delay"
                )
                time.sleep(delay)

            try:
                with self._get_connection() as conn:
                    cursor = conn.cursor()

                    cursor.executemany("""
                        INSERT INTO device_readings (
                            site_id, device_id, register_name, value, unit, timestamp, source
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, [
                        (
                            r["site_id"],
                            r["device_id"],
                            r["register_name"],
                            r["value"],
                            r.get("unit"),
                            r["timestamp"],
                            r.get("source", "live"),
                        )
                        for r in readings
                    ])

                    conn.commit()
                    return cursor.rowcount

            except Exception as e:
                last_error = e
                logger.error(f"SQLite write error (attempt {attempt + 1}): {e}")

        # All retries failed
        if last_error:
            logger.error(
                f"SQLite write failed after {len(self.WRITE_RETRY_BACKOFF) + 1} attempts"
            )
            raise last_error

        return 0

    def get_unsynced_device_readings(self, limit: int = 100) -> list[dict]:
        """Get device readings that haven't been synced"""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT * FROM device_readings
                WHERE synced_at IS NULL
                ORDER BY timestamp ASC
                LIMIT ?
            """, (limit,))

            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def get_unsynced_device_readings_newest(self, limit: int = 5000) -> list[dict]:
        """Get newest unsynced device readings (for priority sync after reconnect)"""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT * FROM device_readings
                WHERE synced_at IS NULL
                ORDER BY timestamp DESC
                LIMIT ?
            """, (limit,))

            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def get_unsynced_device_readings_count(self) -> int:
        """Count total unsynced device readings"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM device_readings WHERE synced_at IS NULL")
            return cursor.fetchone()[0]

    # SQLite parameter limit (safe for all builds)
    SQLITE_MAX_PARAMS = 999

    def mark_device_readings_synced(self, reading_ids: list[int]) -> None:
        """Mark device readings as synced, chunked for large batches."""
        if not reading_ids:
            return

        with self._get_connection() as conn:
            cursor = conn.cursor()
            now = datetime.now(timezone.utc).isoformat()

            # Chunk to stay within SQLite parameter limit (999 per query)
            for chunk_start in range(0, len(reading_ids), self.SQLITE_MAX_PARAMS):
                chunk = reading_ids[chunk_start:chunk_start + self.SQLITE_MAX_PARAMS]
                placeholders = ",".join("?" for _ in chunk)
                cursor.execute(f"""
                    UPDATE device_readings
                    SET synced_at = ?
                    WHERE id IN ({placeholders})
                """, [now] + chunk)

            conn.commit()
