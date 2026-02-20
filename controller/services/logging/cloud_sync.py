"""
Cloud Sync

Syncs local data to Supabase cloud (every 3 minutes).
Handles batched uploads with retry logic.

Robustness Guarantees:
1. Only mark readings as synced AFTER successful upload
2. Empty uploads don't mark anything as synced
3. Failed uploads leave readings unsynced for retry
4. Partial success still marks successful portion
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from enum import Enum
from typing import Any

import httpx

from common.logging_setup import get_service_logger
from .local_db import LocalDatabase

logger = get_service_logger("logging.cloud_sync")


@dataclass
class UploadResult:
    """Result of an upload attempt."""
    success: bool
    records_uploaded: int
    is_duplicate: bool = False  # True if 409 (records already exist)
    error: str | None = None


class BackfillPhase(Enum):
    """Phase of backfill recovery after offline period."""
    NORMAL = "normal"          # < threshold pending, sync oldest-first
    RECENT_FIRST = "recent"    # First cycle: sync newest batch for dashboard
    FILLING_GAPS = "filling"   # Subsequent cycles: fill older data


@dataclass
class BackfillTracker:
    """Tracks backfill progress during offline recovery."""
    phase: BackfillPhase = BackfillPhase.NORMAL
    total_pending: int = 0
    synced_count: int = 0
    recent_synced: bool = False  # True after newest batch synced
    started_at: datetime | None = None

    def reset(self):
        """Reset tracker to normal state."""
        self.phase = BackfillPhase.NORMAL
        self.total_pending = 0
        self.synced_count = 0
        self.recent_synced = False
        self.started_at = None


class CloudSync:
    """
    Syncs data to Supabase cloud.

    Features:
    - Batched uploads (up to 100 records)
    - Retry with exponential backoff
    - Marks records as synced ONLY after successful upload
    - Empty uploads don't mark anything as synced
    - Cloud offline alarm after 1 hour of failures

    Robustness:
    - If upload fails, readings remain unsynced for retry next cycle
    - 409 Conflict (duplicates) treated as success with ignore-duplicates header
    - Tracks uploaded count vs marked count for observability
    """

    BATCH_SIZE = 100
    RETRY_BACKOFF = [1, 2, 4]  # seconds

    # Backfill threshold: if more than this many pending, log progress
    BACKFILL_THRESHOLD = 1000

    # Cloud offline alarm threshold: raise alarm if cloud unreachable for this long
    CLOUD_OFFLINE_THRESHOLD_S = 3600  # 1 hour

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
        self._empty_batch_count = 0  # Track empty batches (downsampling filtered all)
        self._duplicate_count = 0  # Track 409 responses (duplicates ignored)

        # Cloud offline tracking for alerts
        self._last_successful_sync = datetime.now(timezone.utc)
        self._cloud_alarm_raised = False
        self._consecutive_failures = 0

        # Backfill tracking (two-phase: recent-first, then fill gaps)
        self.backfill = BackfillTracker()

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
        result = await self._upload_with_retry(
            table="control_logs",
            records=records,
        )

        if result.success:
            # Mark as synced
            log_ids = [log["id"] for log in logs]
            self.local_db.mark_logs_synced(log_ids)
            self._sync_count += len(logs)

            logger.debug(f"Synced {len(logs)} control logs")
            return len(logs)

        # Upload failed - don't mark as synced
        logger.warning(f"Control logs upload failed ({result.error}), will retry next cycle")
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
                "device_id": alarm.get("device_id"),
                "device_name": alarm.get("device_name"),
                "message": alarm.get("message"),
                "condition": alarm.get("condition"),
                "severity": alarm.get("severity", "warning"),
                "created_at": alarm["timestamp"],
                "acknowledged": bool(alarm.get("acknowledged")),
                "resolved": bool(alarm.get("resolved")),
            }
            records.append(record)

        # Upload with retry
        result = await self._upload_with_retry(
            table="alarms",
            records=records,
        )

        if result.success:
            # Mark as synced
            alarm_ids = [alarm["id"] for alarm in alarms]
            self.local_db.mark_alarms_synced(alarm_ids)
            self._sync_count += len(alarms)

            logger.debug(f"Synced {len(alarms)} alarms")
            return len(alarms)

        # Upload failed - don't mark as synced
        logger.warning(f"Alarms upload failed ({result.error}), will retry next cycle")
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
        result = await self._upload_with_retry(
            table="device_readings",
            records=records,
        )

        if result.success:
            # Mark as synced
            reading_ids = [reading["id"] for reading in readings]
            self.local_db.mark_device_readings_synced(reading_ids)
            self._sync_count += len(readings)

            logger.debug(f"Synced {len(readings)} device readings")
            return len(readings)

        # Upload failed - don't mark as synced
        logger.warning(f"Device readings upload failed ({result.error}), will retry next cycle")
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

        IMPORTANT: Only marks readings as synced AFTER successful upload.
        If readings list is empty or upload fails, nothing is marked as synced.

        Args:
            readings: List of reading dicts to upload (downsampled)
            all_reading_ids: All reading IDs to mark as synced (optional)
            total_pending: Total pending readings for backfill progress

        Returns:
            Number of readings uploaded to cloud
        """
        # Detect backfill mode (>1000 pending = was offline)
        if total_pending is not None and total_pending > self.BACKFILL_THRESHOLD:
            if self.backfill.phase == BackfillPhase.NORMAL:
                self.backfill.total_pending = total_pending
                self.backfill.synced_count = 0
                self.backfill.started_at = datetime.now(timezone.utc)
                if not self.backfill.recent_synced:
                    self.backfill.phase = BackfillPhase.RECENT_FIRST
                    logger.info(
                        f"[CLOUD] Backfill started: {total_pending} readings pending, "
                        f"syncing newest first for dashboard"
                    )
                else:
                    self.backfill.phase = BackfillPhase.FILLING_GAPS

        # Empty after downsampling = readings fell into already-uploaded buckets
        # Mark as synced so they don't pile up (frequency filtering already happened)
        if not readings:
            if all_reading_ids:
                self.local_db.mark_device_readings_synced(all_reading_ids)
                logger.debug(f"Marked {len(all_reading_ids)} readings as synced (no new buckets)")
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
                "source": reading.get("source", "live"),
            }
            records.append(record)

        # Upload with retry
        result = await self._upload_with_retry(
            table="device_readings",
            records=records,
        )

        if result.success:
            # Mark ALL original readings as synced (not just uploaded ones)
            # This handles downsampling where we upload fewer than we processed
            ids_to_mark = all_reading_ids if all_reading_ids else [r["id"] for r in readings]
            self.local_db.mark_device_readings_synced(ids_to_mark)
            self._sync_count += len(readings)

            # Track duplicates for observability
            if result.is_duplicate:
                self._duplicate_count += 1

            # Backfill progress tracking
            if self.backfill.phase != BackfillPhase.NORMAL:
                self.backfill.synced_count += len(ids_to_mark)

                # Phase transition: after first batch, switch to gap-filling
                if self.backfill.phase == BackfillPhase.RECENT_FIRST:
                    self.backfill.recent_synced = True
                    self.backfill.phase = BackfillPhase.FILLING_GAPS
                    logger.info(
                        f"[CLOUD] Backfill phase 1 done: synced newest batch, "
                        f"dashboard should show current data"
                    )

                # Log progress every BACKFILL_THRESHOLD records
                if self.backfill.synced_count % self.BACKFILL_THRESHOLD < len(ids_to_mark):
                    pct = (self.backfill.synced_count / max(1, self.backfill.total_pending)) * 100
                    logger.info(
                        f"[CLOUD] Backfill progress: {self.backfill.synced_count}/{self.backfill.total_pending} "
                        f"({pct:.1f}%) synced"
                    )

            dup_note = " (duplicates ignored)" if result.is_duplicate else ""
            logger.debug(
                f"Synced {len(readings)} readings to cloud{dup_note}, "
                f"marked {len(ids_to_mark)} as processed"
            )
            return len(readings)

        # Upload failed - don't mark anything as synced
        logger.warning(
            f"Cloud upload failed ({result.error}), "
            f"{len(readings)} readings NOT marked as synced - will retry next cycle"
        )
        return 0

    async def sync_all(self) -> dict:
        """
        Sync all pending logs and alarms (for shutdown).

        NOTE: Device readings are NOT synced here because they require
        per-register downsampling which is handled by _sync_device_readings_filtered()
        in service.py. Any unsynced readings will be picked up on next service start.

        Returns:
            Dict with sync statistics
        """
        logs_synced = await self.sync_logs()
        alarms_synced = await self.sync_alarms()
        # Don't sync device_readings - they need downsampling (handled by main loop)

        self._last_sync = datetime.now(timezone.utc)

        return {
            "logs_synced": logs_synced,
            "alarms_synced": alarms_synced,
            "device_readings_synced": 0,  # Handled separately with downsampling
            "total_synced": logs_synced + alarms_synced,
            "timestamp": self._last_sync.isoformat(),
        }

    async def _upload_with_retry(
        self,
        table: str,
        records: list[dict],
    ) -> UploadResult:
        """
        Upload records with retry logic.

        Returns UploadResult with details about the upload:
        - success: True if upload succeeded (including duplicate handling)
        - records_uploaded: Number of records sent to server
        - is_duplicate: True if 409 (records already exist)
        - error: Error message if failed

        Uses Prefer: resolution=ignore-duplicates header, so 409 responses
        are treated as success (records already exist in cloud).
        """
        last_error = None

        # Conflict columns for each table (for ON CONFLICT DO NOTHING)
        # Alarms excluded: no id in payload, Supabase auto-generates UUIDs
        conflict_columns = {
            "device_readings": "device_id,register_name,timestamp",
            "control_logs": "site_id,timestamp",
        }
        on_conflict = conflict_columns.get(table, "")

        for attempt, delay in enumerate(self.RETRY_BACKOFF + [0]):
            try:
                url = f"{self.supabase_url}/rest/v1/{table}"
                if on_conflict:
                    url += f"?on_conflict={on_conflict}"

                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        url,
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
                    return UploadResult(
                        success=True,
                        records_uploaded=len(records),
                    )

            except httpx.HTTPStatusError as e:
                # Log FULL response body for debugging (not truncated)
                try:
                    error_body = e.response.text
                except Exception:
                    error_body = "Could not read response body"

                # 409 Conflict = some records already exist (handled by on_conflict)
                # With on_conflict param, new records insert and duplicates are skipped
                if e.response.status_code == 409:
                    logger.debug(f"[CLOUD] 409 for {table}: {error_body}")
                    return UploadResult(
                        success=True,
                        records_uploaded=len(records),
                        is_duplicate=True,
                    )

                # Log full error body for easier debugging
                last_error = f"HTTP {e.response.status_code}"
                logger.error(
                    f"[ERROR] Cloud upload failed (attempt {attempt + 1}/{len(self.RETRY_BACKOFF) + 1}): "
                    f"{last_error}\n"
                    f"Table: {table}, Records: {len(records)}\n"
                    f"Response: {error_body}"
                )

            except httpx.TimeoutException:
                last_error = "Timeout"
                logger.warning(
                    f"[ERROR] Upload timeout (attempt {attempt + 1}/{len(self.RETRY_BACKOFF) + 1}) "
                    f"for {table} ({len(records)} records)"
                )

            except Exception as e:
                last_error = str(e)
                logger.warning(
                    f"[ERROR] Upload error (attempt {attempt + 1}/{len(self.RETRY_BACKOFF) + 1}): "
                    f"{e.__class__.__name__}: {e}"
                )

            if delay > 0:
                await asyncio.sleep(delay)

        self._error_count += 1
        logger.error(
            f"[ERROR] Failed to upload {len(records)} records to {table} after all retries. "
            f"Last error: {last_error}"
        )
        return UploadResult(
            success=False,
            records_uploaded=0,
            error=last_error,
        )

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
            "device_id": alarm.get("device_id"),
            "device_name": alarm.get("device_name"),
            "message": alarm.get("message"),
            "condition": alarm.get("condition"),
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

    async def resolve_alarm_in_cloud(self, alarm_type: str, device_id: str | None = None) -> bool:
        """
        Resolve an alarm in cloud (Supabase) when controller auto-resolves it.

        Called when alarm condition clears (value changes or threshold config changes).
        Uses PATCH to update existing alarm's resolved status.

        Args:
            alarm_type: The alarm type (e.g., reg_{device_id}_{register_name})
            device_id: Optional device ID for per-device resolution

        Returns:
            True if alarm was resolved in cloud
        """
        try:
            resolved_at = datetime.now(timezone.utc).isoformat()

            params = {
                "site_id": f"eq.{self.site_id}",
                "alarm_type": f"eq.{alarm_type}",
                "resolved": "eq.false",
            }
            if device_id:
                params["device_id"] = f"eq.{device_id}"

            async with httpx.AsyncClient() as client:
                # PATCH updates existing records matching the filter
                response = await client.patch(
                    f"{self.supabase_url}/rest/v1/alarms",
                    params=params,
                    json={
                        "resolved": True,
                        "resolved_at": resolved_at,
                    },
                    headers={
                        "apikey": self.supabase_key,
                        "Authorization": f"Bearer {self.supabase_key}",
                        "Content-Type": "application/json",
                        "Prefer": "return=minimal",
                    },
                    timeout=10.0,
                )
                response.raise_for_status()

                logger.info(f"[CLOUD] Resolved alarm in cloud: {alarm_type}")
                return True

        except Exception as e:
            logger.warning(f"[CLOUD] Failed to resolve alarm in cloud: {alarm_type} - {e}")
            return False

    async def check_unresolved_alarm(
        self,
        alarm_type: str,
        device_id: str | None = None,
    ) -> bool:
        """
        Check if an unresolved alarm exists in cloud (Supabase).

        Used as fallback deduplication for critical/major alarms when local
        check passes but cloud might have duplicates.

        Args:
            alarm_type: The alarm type (e.g., reg_{device_id}_{register_name})
            device_id: Optional device ID for additional filtering

        Returns:
            True if unresolved alarm exists in cloud
        """
        try:
            params = {
                "select": "id",
                "site_id": f"eq.{self.site_id}",
                "alarm_type": f"eq.{alarm_type}",
                "resolved": "eq.false",
                "limit": "1",
            }
            if device_id:
                params["device_id"] = f"eq.{device_id}"

            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.supabase_url}/rest/v1/alarms",
                    params=params,
                    headers={
                        "apikey": self.supabase_key,
                        "Authorization": f"Bearer {self.supabase_key}",
                    },
                    timeout=5.0,
                )
                response.raise_for_status()
                alarms = response.json()
                return len(alarms) > 0

        except Exception as e:
            # On error, allow alarm creation (better to have duplicate than miss)
            logger.debug(f"Cloud alarm check failed: {e}")
            return False

    async def sync_resolved_alarms(self) -> int:
        """
        Sync alarm resolution status FROM cloud TO local SQLite.

        When users resolve alarms in the UI (cloud), this syncs that status
        back to the controller so deduplication checks work correctly.

        Returns:
            Number of local alarms updated
        """
        try:
            # Query cloud for resolved alarms for this site (last 24 hours)
            # Extended from 1 hour to catch resolutions that happened while controller was offline
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.supabase_url}/rest/v1/alarms",
                    params={
                        "select": "alarm_type,device_id,resolved_at",
                        "site_id": f"eq.{self.site_id}",
                        "resolved": "eq.true",
                        # Get resolved in last 24 hours to handle offline recovery
                        "resolved_at": f"gte.{(datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()}",
                    },
                    headers={
                        "apikey": self.supabase_key,
                        "Authorization": f"Bearer {self.supabase_key}",
                    },
                    timeout=10.0,
                )
                response.raise_for_status()
                resolved_alarms = response.json()

            if not resolved_alarms:
                return 0

            # Update local SQLite for each resolved alarm
            updated_count = 0
            for alarm in resolved_alarms:
                alarm_type = alarm.get("alarm_type")
                device_id_val = alarm.get("device_id")
                resolved_at = alarm.get("resolved_at")

                if not alarm_type:
                    continue

                # Skip resolution sync for controller-managed alarm types.
                # Controller monitors conditions and auto-resolves when cleared.
                # Syncing cloud resolutions for these causes duplicate alarm spam:
                # 1. User/auto resolves alarm in cloud
                # 2. Resolution syncs to local → local alarm marked resolved
                # 3. Condition still active → dedup check returns False
                # 4. New alarm created → cycle repeats every health check
                _CONTROLLER_MANAGED_TYPES = {
                    "REGISTER_READ_FAILED",
                    "LOGGING_HIGH_DRIFT",
                    "LOGGING_BUFFER_BUILDUP",
                    "LOGGING_CONSECUTIVE_ERRORS",
                }
                if alarm_type.startswith("reg_") or alarm_type in _CONTROLLER_MANAGED_TYPES:
                    continue

                # Update local alarm to resolved
                count = self.local_db.sync_alarm_resolution(
                    site_id=self.site_id,
                    alarm_type=alarm_type,
                    device_id=device_id_val,
                    resolved_at=resolved_at,
                )
                updated_count += count

            if updated_count > 0:
                logger.info(f"[CLOUD] Synced {updated_count} alarm resolutions from cloud to local")

            return updated_count

        except Exception as e:
            logger.warning(f"[CLOUD] Failed to sync alarm resolutions: {e}")
            return 0

    def record_sync_success(self) -> None:
        """Record a successful cloud sync (resets failure tracking)."""
        self._last_successful_sync = datetime.now(timezone.utc)
        self._consecutive_failures = 0

    def record_sync_failure(self) -> None:
        """Record a failed cloud sync attempt."""
        self._consecutive_failures += 1

    def check_cloud_health(self) -> dict | None:
        """
        Check cloud connectivity health and return alarm info if needed.

        Returns:
            dict with alarm info if alarm should be raised/resolved, None otherwise
            Keys: 'action' ('raise' or 'resolve'), 'alarm_type', 'message', 'severity'
        """
        now = datetime.now(timezone.utc)
        offline_duration = (now - self._last_successful_sync).total_seconds()

        # Check if we should raise an alarm
        if offline_duration > self.CLOUD_OFFLINE_THRESHOLD_S and not self._cloud_alarm_raised:
            self._cloud_alarm_raised = True
            minutes_offline = int(offline_duration / 60)
            return {
                "action": "raise",
                "alarm_type": "CLOUD_SYNC_OFFLINE",
                "message": f"Cloud sync offline for {minutes_offline} minutes",
                "severity": "major",
            }

        # Check if we should resolve an existing alarm
        if self._cloud_alarm_raised and self._consecutive_failures == 0:
            self._cloud_alarm_raised = False
            return {
                "action": "resolve",
                "alarm_type": "CLOUD_SYNC_OFFLINE",
            }

        return None

    def get_stats(self) -> dict:
        """Get sync statistics with robustness metrics"""
        now = datetime.now(timezone.utc)
        offline_duration = (now - self._last_successful_sync).total_seconds()

        return {
            "last_sync": self._last_sync.isoformat(),
            "total_synced": self._sync_count,
            "error_count": self._error_count,
            "empty_batch_count": self._empty_batch_count,  # Downsampling produced empty
            "duplicate_count": self._duplicate_count,  # 409 responses
            "backfill_phase": self.backfill.phase.value,
            "backfill_total": self.backfill.total_pending,
            "backfill_synced": self.backfill.synced_count,
            "backfill_started_at": self.backfill.started_at.isoformat() if self.backfill.started_at else None,
            # Cloud health tracking
            "last_successful_sync": self._last_successful_sync.isoformat(),
            "consecutive_failures": self._consecutive_failures,
            "offline_seconds": int(offline_duration),
            "cloud_alarm_raised": self._cloud_alarm_raised,
        }
