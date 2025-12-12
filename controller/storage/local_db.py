"""
Local SQLite Database

Handles local storage of control logs and alarms.
Data is buffered here when offline and synced to cloud when connected.

Features:
- Stores control logs with timestamps
- Tracks sync status (synced/pending)
- Handles data retention (cleanup old data)
- Provides batch retrieval for cloud sync
"""

import logging
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class ControlLogRecord:
    """
    A single control log record.

    This matches what gets stored locally and synced to cloud.
    """
    timestamp: datetime
    total_load_kw: float
    dg_power_kw: float
    solar_output_kw: float
    solar_limit_pct: float
    available_headroom_kw: float
    safe_mode_active: bool
    config_mode: str  # 'meter_inverter', 'dg_inverter', 'full_system'
    load_meters_online: int
    inverters_online: int
    generators_online: int
    # Internal tracking
    id: Optional[int] = None
    synced: bool = False


@dataclass
class AlarmRecord:
    """
    A local alarm record.
    """
    timestamp: datetime
    alarm_type: str
    device_name: Optional[str]
    message: str
    severity: str  # 'info', 'warning', 'critical'
    # Internal tracking
    id: Optional[int] = None
    synced: bool = False


class LocalDatabase:
    """
    SQLite database for local storage.

    Stores control logs and alarms locally, tracks sync status,
    and handles data retention cleanup.
    """

    def __init__(self, db_path: str = "/data/controller.db"):
        """
        Initialize local database.

        Args:
            db_path: Path to SQLite database file.
                     Default is /data/controller.db which is created by setup script
                     and allowed by systemd ReadWritePaths.
        """
        self.db_path = Path(db_path)

        # Ensure directory exists with proper error handling
        try:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            if e.errno == 30:  # Read-only filesystem
                logger.error(
                    f"Cannot create database directory: {self.db_path.parent} - "
                    "Filesystem is read-only. This may happen if:\n"
                    "  1. SD card is mounted read-only (try: sudo mount -o remount,rw /)\n"
                    "  2. Setup script was not run (creates /data directory)\n"
                    "  3. Using wrong database path (should be /data/controller.db)"
                )
            raise RuntimeError(
                f"Cannot write to {self.db_path.parent} - check filesystem permissions. "
                "Run setup script or manually create: sudo mkdir -p /data && sudo chown volteria:volteria /data"
            ) from e

        # Initialize database
        self._init_db()

        logger.info(f"Local database initialized at {self.db_path}")

    def _get_connection(self) -> sqlite3.Connection:
        """Get a database connection with row factory."""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        """Create database tables if they don't exist."""
        with self._get_connection() as conn:
            # Control logs table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS control_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    total_load_kw REAL,
                    dg_power_kw REAL,
                    solar_output_kw REAL,
                    solar_limit_pct REAL,
                    available_headroom_kw REAL,
                    safe_mode_active INTEGER DEFAULT 0,
                    config_mode TEXT,
                    load_meters_online INTEGER DEFAULT 0,
                    inverters_online INTEGER DEFAULT 0,
                    generators_online INTEGER DEFAULT 0,
                    synced INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Index for faster queries
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_logs_timestamp
                ON control_logs(timestamp DESC)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_logs_synced
                ON control_logs(synced)
            """)

            # Alarms table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS alarms (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    alarm_type TEXT NOT NULL,
                    device_name TEXT,
                    message TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    synced INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_alarms_timestamp
                ON alarms(timestamp DESC)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_alarms_synced
                ON alarms(synced)
            """)

            conn.commit()

    # ============================================
    # CONTROL LOGS
    # ============================================

    def insert_log(self, record: ControlLogRecord) -> int:
        """
        Insert a control log record.

        Args:
            record: Control log data

        Returns:
            ID of inserted record
        """
        with self._get_connection() as conn:
            cursor = conn.execute("""
                INSERT INTO control_logs (
                    timestamp, total_load_kw, dg_power_kw, solar_output_kw,
                    solar_limit_pct, available_headroom_kw, safe_mode_active,
                    config_mode, load_meters_online, inverters_online,
                    generators_online, synced
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                record.timestamp.isoformat(),
                record.total_load_kw,
                record.dg_power_kw,
                record.solar_output_kw,
                record.solar_limit_pct,
                record.available_headroom_kw,
                1 if record.safe_mode_active else 0,
                record.config_mode,
                record.load_meters_online,
                record.inverters_online,
                record.generators_online,
                1 if record.synced else 0
            ))
            conn.commit()
            return cursor.lastrowid

    def get_unsynced_logs(self, limit: int = 100) -> list[ControlLogRecord]:
        """
        Get logs that haven't been synced to cloud.

        Args:
            limit: Maximum number of records to return

        Returns:
            List of unsynced control log records
        """
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT * FROM control_logs
                WHERE synced = 0
                ORDER BY timestamp ASC
                LIMIT ?
            """, (limit,))

            rows = cursor.fetchall()
            return [self._row_to_log(row) for row in rows]

    def mark_logs_synced(self, ids: list[int]):
        """
        Mark logs as synced after successful cloud upload.

        Args:
            ids: List of record IDs to mark as synced
        """
        if not ids:
            return

        with self._get_connection() as conn:
            placeholders = ",".join("?" * len(ids))
            conn.execute(f"""
                UPDATE control_logs
                SET synced = 1
                WHERE id IN ({placeholders})
            """, ids)
            conn.commit()

        logger.debug(f"Marked {len(ids)} logs as synced")

    def get_unsynced_count(self) -> int:
        """Get count of unsynced log records."""
        with self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT COUNT(*) FROM control_logs WHERE synced = 0"
            )
            return cursor.fetchone()[0]

    def _row_to_log(self, row: sqlite3.Row) -> ControlLogRecord:
        """Convert database row to ControlLogRecord."""
        return ControlLogRecord(
            id=row["id"],
            timestamp=datetime.fromisoformat(row["timestamp"]),
            total_load_kw=row["total_load_kw"],
            dg_power_kw=row["dg_power_kw"],
            solar_output_kw=row["solar_output_kw"],
            solar_limit_pct=row["solar_limit_pct"],
            available_headroom_kw=row["available_headroom_kw"],
            safe_mode_active=bool(row["safe_mode_active"]),
            config_mode=row["config_mode"],
            load_meters_online=row["load_meters_online"],
            inverters_online=row["inverters_online"],
            generators_online=row["generators_online"],
            synced=bool(row["synced"])
        )

    # ============================================
    # ALARMS
    # ============================================

    def insert_alarm(self, record: AlarmRecord) -> int:
        """
        Insert an alarm record.

        Args:
            record: Alarm data

        Returns:
            ID of inserted record
        """
        with self._get_connection() as conn:
            cursor = conn.execute("""
                INSERT INTO alarms (
                    timestamp, alarm_type, device_name, message, severity, synced
                ) VALUES (?, ?, ?, ?, ?, ?)
            """, (
                record.timestamp.isoformat(),
                record.alarm_type,
                record.device_name,
                record.message,
                record.severity,
                1 if record.synced else 0
            ))
            conn.commit()

            logger.info(f"Alarm created: [{record.severity}] {record.alarm_type} - {record.message}")
            return cursor.lastrowid

    def get_unsynced_alarms(self, limit: int = 50) -> list[AlarmRecord]:
        """
        Get alarms that haven't been synced to cloud.

        Args:
            limit: Maximum number of records to return

        Returns:
            List of unsynced alarm records
        """
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT * FROM alarms
                WHERE synced = 0
                ORDER BY timestamp ASC
                LIMIT ?
            """, (limit,))

            rows = cursor.fetchall()
            return [self._row_to_alarm(row) for row in rows]

    def mark_alarms_synced(self, ids: list[int]):
        """Mark alarms as synced after successful cloud upload."""
        if not ids:
            return

        with self._get_connection() as conn:
            placeholders = ",".join("?" * len(ids))
            conn.execute(f"""
                UPDATE alarms
                SET synced = 1
                WHERE id IN ({placeholders})
            """, ids)
            conn.commit()

    def _row_to_alarm(self, row: sqlite3.Row) -> AlarmRecord:
        """Convert database row to AlarmRecord."""
        return AlarmRecord(
            id=row["id"],
            timestamp=datetime.fromisoformat(row["timestamp"]),
            alarm_type=row["alarm_type"],
            device_name=row["device_name"],
            message=row["message"],
            severity=row["severity"],
            synced=bool(row["synced"])
        )

    # ============================================
    # DATA RETENTION
    # ============================================

    def cleanup_old_data(self, retention_days: int = 7):
        """
        Delete old synced data beyond retention period.

        Only deletes data that has been successfully synced to cloud.

        Args:
            retention_days: Keep data for this many days
        """
        cutoff = datetime.now() - timedelta(days=retention_days)
        cutoff_str = cutoff.isoformat()

        with self._get_connection() as conn:
            # Delete old synced logs
            cursor = conn.execute("""
                DELETE FROM control_logs
                WHERE synced = 1 AND timestamp < ?
            """, (cutoff_str,))
            logs_deleted = cursor.rowcount

            # Delete old synced alarms
            cursor = conn.execute("""
                DELETE FROM alarms
                WHERE synced = 1 AND timestamp < ?
            """, (cutoff_str,))
            alarms_deleted = cursor.rowcount

            conn.commit()

        if logs_deleted > 0 or alarms_deleted > 0:
            logger.info(
                f"Cleanup: deleted {logs_deleted} logs, {alarms_deleted} alarms "
                f"older than {retention_days} days"
            )

    # ============================================
    # STATISTICS
    # ============================================

    def get_stats(self) -> dict:
        """Get database statistics."""
        with self._get_connection() as conn:
            stats = {}

            # Log counts
            cursor = conn.execute(
                "SELECT COUNT(*) as total, SUM(CASE WHEN synced = 0 THEN 1 ELSE 0 END) as pending FROM control_logs"
            )
            row = cursor.fetchone()
            stats["logs_total"] = row["total"]
            stats["logs_pending"] = row["pending"] or 0

            # Alarm counts
            cursor = conn.execute(
                "SELECT COUNT(*) as total, SUM(CASE WHEN synced = 0 THEN 1 ELSE 0 END) as pending FROM alarms"
            )
            row = cursor.fetchone()
            stats["alarms_total"] = row["total"]
            stats["alarms_pending"] = row["pending"] or 0

            # Database size
            stats["db_size_mb"] = self.db_path.stat().st_size / (1024 * 1024)

            return stats
