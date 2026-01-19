"""
Cloud Sync

Syncs local data to Supabase cloud (every 2 minutes).
Handles batched uploads with retry logic.
"""

import asyncio
from datetime import datetime, timezone
from typing import Any

import httpx

from common.logging_setup import get_service_logger
from .local_db import LocalDatabase

logger = get_service_logger("logging.cloud_sync")


class CloudSync:
    """
    Syncs data to Supabase cloud.

    Features:
    - Batched uploads (up to 100 records)
    - Retry with exponential backoff
    - Marks records as synced after successful upload
    """

    BATCH_SIZE = 100
    RETRY_BACKOFF = [1, 2, 4]  # seconds

    # Backfill threshold: if more than this many pending, log progress
    BACKFILL_THRESHOLD = 1000

    def __init__(
        self,
        site_id: str,
        supabase_url: str,
        supabase_key: str,
        local_db: LocalDatabase,
    ):
        self.site_id = site_id
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        self.local_db = local_db

        self._last_sync = datetime.now(timezone.utc)
        self._sync_count = 0
        self._error_count = 0

        # Backfill tracking
        self._backfill_mode = False
        self._backfill_total = 0
        self._backfill_synced = 0

    async def sync_logs(self) -> int:
        """
        Sync unsynced control logs to cloud.

        Returns:
            Number of records synced
        """
        logs = self.local_db.get_unsynced_logs(limit=self.BATCH_SIZE)

        if not logs:
            return 0

        # Transform for Supabase (must match control_logs table columns)
        # Deduplicate by (site_id, timestamp) to avoid UNIQUE constraint violations
        seen_keys = set()
        records = []
        for log in logs:
            site_id = log.get("site_id") or self.site_id
            timestamp = log["timestamp"]
            key = (site_id, timestamp)

            # Skip duplicates within this batch
            if key in seen_keys:
                continue
            seen_keys.add(key)

            record = {
                "site_id": site_id,
                "timestamp": timestamp,
                "total_load_kw": log.get("total_load_kw"),
                "solar_output_kw": log.get("solar_output_kw"),
                "dg_power_kw": log.get("dg_power_kw"),
                "solar_limit_pct": log.get("solar_limit_pct"),
                "safe_mode_active": bool(log.get("safe_mode_active")),
                "config_mode": log.get("config_mode"),
                # Note: operation_mode not in control_logs table
                "load_meters_online": log.get("load_meters_online"),
                "inverters_online": log.get("inverters_online"),
                "generators_online": log.get("generators_online"),
            }
            records.append(record)

        if not records:
            # All records were duplicates
            log_ids = [log["id"] for log in logs]
            self.local_db.mark_logs_synced(log_ids)
            logger.debug(f"All {len(logs)} logs were duplicates, marked as synced")
            return 0

        # Upload with retry
        success = await self._upload_with_retry(
            table="control_logs",
            records=records,
        )

        if success:
            # Mark as synced
            log_ids = [log["id"] for log in logs]
            self.local_db.mark_logs_synced(log_ids)
            self._sync_count += len(logs)

            logger.debug(f"Synced {len(logs)} control logs")
            return len(logs)

        return 0

    async def sync_alarms(self) -> int:
        """
        Sync unsynced alarms to cloud.

        Returns:
            Number of alarms synced
        """
        alarms = self.local_db.get_unsynced_alarms(limit=self.BATCH_SIZE)

        if not alarms:
            return 0

        # Transform for Supabase
        records = []
        for alarm in alarms:
            record = {
                "site_id": alarm.get("site_id") or self.site_id,
                "alarm_type": alarm["alarm_type"],
                "device_name": alarm.get("device_name"),
                "message": alarm.get("message"),
                "severity": alarm.get("severity", "warning"),
                "created_at": alarm["timestamp"],
                "acknowledged": bool(alarm.get("acknowledged")),
                "resolved": bool(alarm.get("resolved")),
            }
            records.append(record)

        # Upload with retry
        success = await self._upload_with_retry(
            table="alarms",
            records=records,
        )

        if success:
            # Mark as synced
            alarm_ids = [alarm["id"] for alarm in alarms]
            self.local_db.mark_alarms_synced(alarm_ids)
            self._sync_count += len(alarms)

            logger.debug(f"Synced {len(alarms)} alarms")
            return len(alarms)

        return 0

    async def sync_device_readings(self) -> int:
        """
        Sync unsynced device readings to cloud.

        Returns:
            Number of readings synced
        """
        readings = self.local_db.get_unsynced_device_readings(limit=self.BATCH_SIZE)

        if not readings:
            return 0

        # Transform for Supabase (must match device_readings table columns)
        records = []
        for reading in readings:
            record = {
                "site_id": reading.get("site_id") or self.site_id,
                "device_id": reading["device_id"],
                "register_name": reading["register_name"],
                "value": reading["value"],
                "unit": reading.get("unit"),
                "timestamp": reading["timestamp"],
            }
            records.append(record)

        # Upload with retry
        success = await self._upload_with_retry(
            table="device_readings",
            records=records,
        )

        if success:
            # Mark as synced
            reading_ids = [reading["id"] for reading in readings]
            self.local_db.mark_device_readings_synced(reading_ids)
            self._sync_count += len(readings)

            logger.debug(f"Synced {len(readings)} device readings")
            return len(readings)

        return 0

    async def sync_specific_readings(
        self,
        readings: list[dict],
        all_reading_ids: list | None = None,
        total_pending: int | None = None,
    ) -> int:
        """
        Sync specific device readings to cloud (downsampled).

        Used by per-register frequency downsampling:
        - `readings`: The downsampled readings to upload to cloud
        - `all_reading_ids`: ALL original reading IDs to mark as synced
          (includes readings not uploaded due to downsampling)
        - `total_pending`: Optional total pending count for backfill tracking

        This allows local SQLite to keep full resolution while cloud gets
        downsampled data. All original readings are marked as processed.

        Args:
            readings: List of reading dicts to upload (downsampled)
            all_reading_ids: All reading IDs to mark as synced (optional)
            total_pending: Total pending readings for backfill progress

        Returns:
            Number of readings uploaded to cloud
        """
        # Detect backfill mode
        if total_pending is not None and total_pending > self.BACKFILL_THRESHOLD:
            if not self._backfill_mode:
                self._backfill_mode = True
                self._backfill_total = total_pending
                self._backfill_synced = 0
                logger.info(
                    f"Backfill mode: {total_pending} readings pending, "
                    f"will log progress every {self.BACKFILL_THRESHOLD}"
                )

        if not readings:
            # Even with no readings to upload, mark all as synced if provided
            if all_reading_ids:
                self.local_db.mark_device_readings_synced(all_reading_ids)
            return 0

        # Transform for Supabase (must match device_readings table columns)
        records = []
        for reading in readings:
            record = {
                "site_id": reading.get("site_id") or self.site_id,
                "device_id": reading["device_id"],
                "register_name": reading["register_name"],
                "value": reading["value"],
                "unit": reading.get("unit"),
                "timestamp": reading["timestamp"],
            }
            records.append(record)

        # Upload with retry
        success = await self._upload_with_retry(
            table="device_readings",
            records=records,
        )

        if success:
            # Mark ALL original readings as synced (not just uploaded ones)
            # This handles downsampling where we upload fewer than we processed
            ids_to_mark = all_reading_ids if all_reading_ids else [r["id"] for r in readings]
            self.local_db.mark_device_readings_synced(ids_to_mark)
            self._sync_count += len(readings)

            # Backfill progress tracking
            if self._backfill_mode:
                self._backfill_synced += len(ids_to_mark)
                # Log progress every BACKFILL_THRESHOLD records
                if self._backfill_synced % self.BACKFILL_THRESHOLD < len(ids_to_mark):
                    pct = (self._backfill_synced / self._backfill_total) * 100
                    logger.info(
                        f"Backfill progress: {self._backfill_synced}/{self._backfill_total} "
                        f"({pct:.1f}%) synced"
                    )
                # Exit backfill mode when caught up
                if self._backfill_synced >= self._backfill_total:
                    logger.info(
                        f"Backfill complete: {self._backfill_synced} readings synced"
                    )
                    self._backfill_mode = False

            logger.debug(
                f"Synced {len(readings)} readings to cloud "
                f"(marked {len(ids_to_mark)} as processed)"
            )
            return len(readings)

        return 0

    async def sync_all(self) -> dict:
        """
        Sync all pending data.

        Returns:
            Dict with sync statistics
        """
        logs_synced = await self.sync_logs()
        alarms_synced = await self.sync_alarms()
        device_readings_synced = await self.sync_device_readings()

        self._last_sync = datetime.now(timezone.utc)

        return {
            "logs_synced": logs_synced,
            "alarms_synced": alarms_synced,
            "device_readings_synced": device_readings_synced,
            "total_synced": logs_synced + alarms_synced + device_readings_synced,
            "timestamp": self._last_sync.isoformat(),
        }

    async def _upload_with_retry(
        self,
        table: str,
        records: list[dict],
    ) -> bool:
        """Upload records with retry logic"""
        for attempt, delay in enumerate(self.RETRY_BACKOFF + [0]):
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        f"{self.supabase_url}/rest/v1/{table}",
                        json=records,
                        headers={
                            "apikey": self.supabase_key,
                            "Authorization": f"Bearer {self.supabase_key}",
                            "Content-Type": "application/json",
                            # Ignore duplicates (UNIQUE constraint violations)
                            "Prefer": "resolution=ignore-duplicates,return=minimal",
                        },
                        timeout=30.0,
                    )
                    response.raise_for_status()
                    return True

            except httpx.HTTPStatusError as e:
                # Log response body for debugging
                try:
                    error_body = e.response.text
                except Exception:
                    error_body = "Could not read response body"

                # 409 Conflict = records already exist, treat as success
                if e.response.status_code == 409:
                    logger.info(f"Records already exist in {table} (409), marking as synced")
                    return True
                logger.warning(
                    f"Upload failed (attempt {attempt + 1}): HTTP {e.response.status_code} - {error_body[:200]}"
                )
            except httpx.TimeoutException:
                logger.warning(f"Upload timeout (attempt {attempt + 1})")
            except Exception as e:
                logger.warning(f"Upload error (attempt {attempt + 1}): {e}")

            if delay > 0:
                await asyncio.sleep(delay)

        self._error_count += 1
        logger.error(f"Failed to upload {len(records)} records to {table}")
        return False

    async def sync_alarm_immediately(self, alarm: dict) -> bool:
        """
        Sync a single alarm immediately (for critical alarms).

        Args:
            alarm: Alarm dict

        Returns:
            True if synced successfully
        """
        record = {
            "site_id": alarm.get("site_id") or self.site_id,
            "alarm_type": alarm["alarm_type"],
            "device_name": alarm.get("device_name"),
            "message": alarm.get("message"),
            "severity": alarm.get("severity", "warning"),
            "created_at": alarm.get("timestamp") or datetime.now(timezone.utc).isoformat(),
            "acknowledged": False,
            "resolved": False,
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.supabase_url}/rest/v1/alarms",
                    json=record,
                    headers={
                        "apikey": self.supabase_key,
                        "Authorization": f"Bearer {self.supabase_key}",
                        "Content-Type": "application/json",
                        "Prefer": "return=minimal",
                    },
                    timeout=10.0,
                )
                response.raise_for_status()

                logger.info(
                    f"Immediately synced {alarm['severity']} alarm: {alarm['alarm_type']}"
                )
                return True

        except Exception as e:
            logger.error(f"Failed to immediately sync alarm: {e}")
            return False

    def get_stats(self) -> dict:
        """Get sync statistics"""
        return {
            "last_sync": self._last_sync.isoformat(),
            "total_synced": self._sync_count,
            "error_count": self._error_count,
        }
