"""
Cloud Sync Service

Handles synchronization of local data to Supabase cloud.

Features:
- Batch upload of control logs
- Retry logic with exponential backoff
- Offline detection and recovery
- Heartbeat sending to cloud
"""

import asyncio
import logging
from dataclasses import asdict
from datetime import datetime
from typing import Optional

import httpx

from .local_db import LocalDatabase, ControlLogRecord, AlarmRecord

logger = logging.getLogger(__name__)


class CloudSync:
    """
    Syncs local data to Supabase cloud.

    Handles:
    - Batch uploading of control logs and alarms
    - Retry logic with exponential backoff
    - Connection status tracking
    - Controller heartbeat
    """

    def __init__(
        self,
        project_id: str,
        supabase_url: str,
        supabase_key: str,
        local_db: LocalDatabase,
        sync_interval_ms: int = 5000,
        max_retries: int = 3,
        batch_size: int = 100
    ):
        """
        Initialize cloud sync service.

        Args:
            project_id: UUID of the project in Supabase
            supabase_url: Supabase project URL
            supabase_key: Supabase service role key
            local_db: Local database instance
            sync_interval_ms: How often to sync (milliseconds)
            max_retries: Maximum retry attempts for failed syncs
            batch_size: Maximum records per batch upload
        """
        self.project_id = project_id
        self.supabase_url = supabase_url.rstrip("/")
        self.supabase_key = supabase_key
        self.local_db = local_db
        self.sync_interval_s = sync_interval_ms / 1000.0
        self.max_retries = max_retries
        self.batch_size = batch_size

        # Connection state
        self.is_online = False
        self.last_sync_at: Optional[datetime] = None
        self.last_error: Optional[str] = None
        self.consecutive_failures = 0

        # HTTP client with timeout
        self._client: Optional[httpx.AsyncClient] = None

        # Control flag
        self._running = False

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.supabase_url,
                headers={
                    "apikey": self.supabase_key,
                    "Authorization": f"Bearer {self.supabase_key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal"  # Don't return inserted rows
                },
                timeout=30.0
            )
        return self._client

    async def close(self):
        """Close HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    # ============================================
    # SYNC LOOP
    # ============================================

    async def start(self):
        """Start the sync loop."""
        self._running = True
        logger.info(f"Cloud sync started (interval: {self.sync_interval_s}s)")

        while self._running:
            try:
                await self._sync_cycle()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Sync cycle error: {e}")

            await asyncio.sleep(self.sync_interval_s)

    def stop(self):
        """Stop the sync loop."""
        self._running = False

    async def _sync_cycle(self):
        """
        Run one sync cycle.

        Steps:
        1. Check connection
        2. Sync pending logs
        3. Sync pending alarms
        4. Update status
        """
        # Sync logs
        logs_synced = await self._sync_logs()

        # Sync alarms
        alarms_synced = await self._sync_alarms()

        # Log status
        if logs_synced > 0 or alarms_synced > 0:
            logger.info(f"Synced {logs_synced} logs, {alarms_synced} alarms to cloud")

    # ============================================
    # LOG SYNC
    # ============================================

    async def _sync_logs(self) -> int:
        """
        Sync pending logs to cloud.

        Returns:
            Number of logs synced
        """
        # Get unsynced logs
        logs = self.local_db.get_unsynced_logs(limit=self.batch_size)
        if not logs:
            return 0

        # Prepare batch payload
        payload = [self._log_to_payload(log) for log in logs]

        # Try to upload with retry
        success = await self._upload_with_retry(
            endpoint="/rest/v1/control_logs",
            payload=payload
        )

        if success:
            # Mark as synced
            ids = [log.id for log in logs if log.id]
            self.local_db.mark_logs_synced(ids)
            return len(logs)

        return 0

    def _log_to_payload(self, log: ControlLogRecord) -> dict:
        """Convert log record to API payload."""
        return {
            "project_id": self.project_id,
            "timestamp": log.timestamp.isoformat(),
            "total_load_kw": log.total_load_kw,
            "dg_power_kw": log.dg_power_kw,
            "solar_output_kw": log.solar_output_kw,
            "solar_limit_pct": log.solar_limit_pct,
            "available_headroom_kw": log.available_headroom_kw,
            "safe_mode_active": log.safe_mode_active,
            "config_mode": log.config_mode,
            "load_meters_online": log.load_meters_online,
            "inverters_online": log.inverters_online,
            "generators_online": log.generators_online
        }

    # ============================================
    # ALARM SYNC
    # ============================================

    async def _sync_alarms(self) -> int:
        """
        Sync pending alarms to cloud.

        Returns:
            Number of alarms synced
        """
        # Get unsynced alarms
        alarms = self.local_db.get_unsynced_alarms(limit=self.batch_size)
        if not alarms:
            return 0

        # Prepare batch payload
        payload = [self._alarm_to_payload(alarm) for alarm in alarms]

        # Try to upload with retry
        success = await self._upload_with_retry(
            endpoint="/rest/v1/alarms",
            payload=payload
        )

        if success:
            # Mark as synced
            ids = [alarm.id for alarm in alarms if alarm.id]
            self.local_db.mark_alarms_synced(ids)
            return len(alarms)

        return 0

    def _alarm_to_payload(self, alarm: AlarmRecord) -> dict:
        """Convert alarm record to API payload."""
        return {
            "project_id": self.project_id,
            "alarm_type": alarm.alarm_type,
            "device_name": alarm.device_name,
            "message": alarm.message,
            "severity": alarm.severity,
            "created_at": alarm.timestamp.isoformat()
        }

    # ============================================
    # UPLOAD WITH RETRY
    # ============================================

    async def _upload_with_retry(
        self,
        endpoint: str,
        payload: list[dict]
    ) -> bool:
        """
        Upload data with exponential backoff retry.

        Args:
            endpoint: API endpoint path
            payload: Data to upload

        Returns:
            True if upload succeeded
        """
        client = await self._get_client()

        for attempt in range(self.max_retries):
            try:
                response = await client.post(endpoint, json=payload)

                if response.status_code in (200, 201):
                    # Success
                    self.is_online = True
                    self.last_sync_at = datetime.now()
                    self.last_error = None
                    self.consecutive_failures = 0
                    return True

                # API error
                self.last_error = f"HTTP {response.status_code}: {response.text}"
                logger.warning(f"Upload failed: {self.last_error}")

            except httpx.TimeoutException:
                self.last_error = "Request timeout"
                logger.warning(f"Upload timeout (attempt {attempt + 1})")

            except httpx.ConnectError:
                self.last_error = "Connection failed"
                self.is_online = False
                logger.warning(f"Connection failed (attempt {attempt + 1})")

            except Exception as e:
                self.last_error = str(e)
                logger.error(f"Upload error: {e}")

            # Exponential backoff before retry
            if attempt < self.max_retries - 1:
                wait_time = 2 ** attempt  # 1s, 2s, 4s
                await asyncio.sleep(wait_time)

        # All retries failed
        self.consecutive_failures += 1
        self.is_online = False
        return False

    # ============================================
    # HEARTBEAT
    # ============================================

    async def send_heartbeat(
        self,
        firmware_version: str = "1.0.0",
        uptime_seconds: int = 0,
        cpu_usage_pct: float = 0.0,
        memory_usage_pct: float = 0.0
    ) -> bool:
        """
        Send heartbeat to cloud.

        Called every 5 minutes to indicate controller is online.

        Args:
            firmware_version: Current firmware version
            uptime_seconds: Controller uptime
            cpu_usage_pct: CPU usage percentage
            memory_usage_pct: Memory usage percentage

        Returns:
            True if heartbeat was received
        """
        client = await self._get_client()

        payload = {
            "project_id": self.project_id,
            "firmware_version": firmware_version,
            "uptime_seconds": uptime_seconds,
            "cpu_usage_pct": cpu_usage_pct,
            "memory_usage_pct": memory_usage_pct
        }

        try:
            response = await client.post(
                "/rest/v1/controller_heartbeats",
                json=payload
            )

            if response.status_code in (200, 201):
                self.is_online = True
                logger.debug("Heartbeat sent successfully")
                return True

            logger.warning(f"Heartbeat failed: {response.status_code}")
            return False

        except Exception as e:
            logger.error(f"Heartbeat error: {e}")
            self.is_online = False
            return False

    # ============================================
    # STATUS
    # ============================================

    def get_status(self) -> dict:
        """Get sync status."""
        stats = self.local_db.get_stats()
        return {
            "is_online": self.is_online,
            "last_sync_at": self.last_sync_at.isoformat() if self.last_sync_at else None,
            "last_error": self.last_error,
            "consecutive_failures": self.consecutive_failures,
            "pending_logs": stats["logs_pending"],
            "pending_alarms": stats["alarms_pending"]
        }
