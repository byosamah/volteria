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
import re
from dataclasses import asdict
from datetime import datetime
from typing import Optional

import httpx

from .local_db import LocalDatabase, ControlLogRecord, AlarmRecord, DeviceReadingRecord

logger = logging.getLogger(__name__)

# UUID validation regex pattern
# Matches standard UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
UUID_PATTERN = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE
)


def is_valid_uuid(value: str) -> bool:
    """
    Check if a string is a valid UUID format.

    Args:
        value: String to check

    Returns:
        True if the string is a valid UUID format
    """
    if not value:
        return False
    return bool(UUID_PATTERN.match(value))


class CloudSync:
    """
    Syncs local data to Supabase cloud via FastAPI backend.

    Handles:
    - Batch uploading of control logs and alarms via backend API
    - Retry logic with exponential backoff
    - Connection status tracking
    - Controller heartbeat
    """

    def __init__(
        self,
        site_id: str,
        supabase_url: str,
        supabase_key: str,
        local_db: LocalDatabase,
        sync_interval_ms: int = 5000,
        max_retries: int = 3,
        batch_size: int = 100,
        project_id: str = None,  # Optional: for backward compatibility
        controller_id: str = None,  # Controller ID for heartbeats before site assignment
        backend_url: str = None  # FastAPI backend URL (e.g., https://volteria.org/api)
    ):
        """
        Initialize cloud sync service.

        Args:
            site_id: UUID of the site in Supabase (physical location with controller)
            supabase_url: Supabase project URL
            supabase_key: Supabase service role key
            local_db: Local database instance
            sync_interval_ms: How often to sync (milliseconds)
            max_retries: Maximum retry attempts for failed syncs
            batch_size: Maximum records per batch upload
            project_id: Optional UUID of the project (for backward compatibility)
            controller_id: Controller ID for heartbeats before site assignment
            backend_url: FastAPI backend URL for site-based endpoints
        """
        self.site_id = site_id
        self.project_id = project_id  # Optional: kept for backward compatibility
        self.controller_id = controller_id  # For heartbeats before site assignment
        self.supabase_url = supabase_url.rstrip("/")
        self.supabase_key = supabase_key
        self.backend_url = backend_url.rstrip("/") if backend_url else None
        self.local_db = local_db
        self.sync_interval_s = sync_interval_ms / 1000.0
        self.max_retries = max_retries
        self.batch_size = batch_size

        # Connection state
        self.is_online = False
        self.last_sync_at: Optional[datetime] = None
        self.last_error: Optional[str] = None
        self.consecutive_failures = 0

        # HTTP clients with timeout
        self._client: Optional[httpx.AsyncClient] = None
        self._backend_client: Optional[httpx.AsyncClient] = None

        # Control flag
        self._running = False

        # Validate site_id is a proper UUID before enabling sync
        # This prevents HTTP 400 errors when site_id is a test/placeholder value
        self._sync_enabled = is_valid_uuid(site_id)
        if not self._sync_enabled:
            logger.warning(
                f"Cloud sync DISABLED: site_id '{site_id}' is not a valid UUID. "
                f"Controller needs to be assigned to a site via the platform."
            )

        # Validate controller_id for heartbeat-only mode
        self._heartbeat_enabled = is_valid_uuid(controller_id) if controller_id else False
        if self._heartbeat_enabled and not self._sync_enabled:
            logger.info(
                f"Heartbeat-only mode ENABLED: controller_id '{controller_id}' is valid. "
                f"Controller can send heartbeats but not sync logs/alarms until assigned to a site."
            )

        # Log backend URL status
        if self.backend_url:
            logger.info(f"Using FastAPI backend for logs/alarms: {self.backend_url}")
        else:
            logger.info("Using direct Supabase REST API for logs/alarms")

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create Supabase HTTP client."""
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

    async def _get_backend_client(self) -> httpx.AsyncClient:
        """Get or create FastAPI backend HTTP client."""
        if self._backend_client is None:
            self._backend_client = httpx.AsyncClient(
                base_url=self.backend_url,
                headers={
                    "apikey": self.supabase_key,
                    "Content-Type": "application/json"
                },
                timeout=30.0
            )
        return self._backend_client

    async def close(self):
        """Close HTTP clients."""
        if self._client:
            await self._client.aclose()
            self._client = None
        if self._backend_client:
            await self._backend_client.aclose()
            self._backend_client = None

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
        4. Sync pending device readings
        5. Update status
        """
        # Sync logs
        logs_synced = await self._sync_logs()

        # Sync alarms
        alarms_synced = await self._sync_alarms()

        # Sync device readings
        readings_synced = await self._sync_device_readings()

        # Log status
        if logs_synced > 0 or alarms_synced > 0 or readings_synced > 0:
            logger.info(
                f"Synced {logs_synced} logs, {alarms_synced} alarms, "
                f"{readings_synced} device readings to cloud"
            )

    # ============================================
    # LOG SYNC
    # ============================================

    async def _sync_logs(self) -> int:
        """
        Sync pending logs to cloud.

        Uses FastAPI backend endpoint if backend_url is configured,
        otherwise falls back to direct Supabase REST API.

        Returns:
            Number of logs synced
        """
        # Skip if sync is disabled (invalid site_id)
        if not self._sync_enabled:
            return 0

        # Get unsynced logs
        logs = self.local_db.get_unsynced_logs(limit=self.batch_size)
        if not logs:
            return 0

        # Use backend API if configured, otherwise direct Supabase
        if self.backend_url:
            # Backend API expects batch format with entries array
            payload = {
                "entries": [self._log_to_backend_payload(log) for log in logs]
            }
            success = await self._upload_with_retry(
                endpoint=f"/logs/site/{self.site_id}/push",
                payload=payload,
                use_backend=True
            )
        else:
            # Direct Supabase REST API
            payload = [self._log_to_payload(log) for log in logs]
            success = await self._upload_with_retry(
                endpoint="/rest/v1/control_logs",
                payload=payload,
                use_backend=False
            )

        if success:
            # Mark as synced
            ids = [log.id for log in logs if log.id]
            self.local_db.mark_logs_synced(ids)
            return len(logs)

        return 0

    def _log_to_payload(self, log: ControlLogRecord) -> dict:
        """Convert log record to Supabase REST API payload."""
        payload = {
            "site_id": self.site_id,  # Primary: site is the physical location
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
        return payload

    def _log_to_backend_payload(self, log: ControlLogRecord) -> dict:
        """Convert log record to FastAPI backend payload format."""
        return {
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
            "generators_online": log.generators_online,
            "raw_data": None  # Optional field
        }

    # ============================================
    # ALARM SYNC
    # ============================================

    async def _sync_alarms(self) -> int:
        """
        Sync pending alarms to cloud.

        Uses FastAPI backend endpoint if backend_url is configured,
        otherwise falls back to direct Supabase REST API.

        Returns:
            Number of alarms synced
        """
        # Skip if sync is disabled (invalid site_id)
        if not self._sync_enabled:
            return 0

        # Get unsynced alarms
        alarms = self.local_db.get_unsynced_alarms(limit=self.batch_size)
        if not alarms:
            return 0

        # Use backend API if configured, otherwise direct Supabase
        if self.backend_url:
            # Backend API: send alarms one at a time (each triggers notifications)
            synced_ids = []
            for alarm in alarms:
                payload = self._alarm_to_backend_payload(alarm)
                success = await self._upload_with_retry(
                    endpoint=f"/alarms/site/{self.site_id}",
                    payload=payload,
                    use_backend=True
                )
                if success and alarm.id:
                    synced_ids.append(alarm.id)

            if synced_ids:
                self.local_db.mark_alarms_synced(synced_ids)
            return len(synced_ids)
        else:
            # Direct Supabase REST API (batch insert)
            payload = [self._alarm_to_payload(alarm) for alarm in alarms]
            success = await self._upload_with_retry(
                endpoint="/rest/v1/alarms",
                payload=payload,
                use_backend=False
            )

            if success:
                ids = [alarm.id for alarm in alarms if alarm.id]
                self.local_db.mark_alarms_synced(ids)
                return len(alarms)

        return 0

    def _alarm_to_payload(self, alarm: AlarmRecord) -> dict:
        """Convert alarm record to Supabase REST API payload."""
        return {
            "site_id": self.site_id,  # Primary: site is the physical location
            "alarm_type": alarm.alarm_type,
            "device_name": alarm.device_name,
            "message": alarm.message,
            "severity": alarm.severity,
            "created_at": alarm.timestamp.isoformat()
        }

    def _alarm_to_backend_payload(self, alarm: AlarmRecord) -> dict:
        """Convert alarm record to FastAPI backend payload format."""
        return {
            "alarm_type": alarm.alarm_type,
            "device_name": alarm.device_name,
            "message": alarm.message,
            "severity": alarm.severity
        }

    # ============================================
    # DEVICE READINGS SYNC
    # ============================================

    async def _sync_device_readings(self) -> int:
        """
        Sync pending device readings to cloud.

        Returns:
            Number of device readings synced
        """
        # Skip if sync is disabled (invalid site_id)
        if not self._sync_enabled:
            return 0

        # Get unsynced readings
        readings = self.local_db.get_unsynced_device_readings(limit=self.batch_size)
        if not readings:
            return 0

        # Prepare batch payload
        payload = [self._device_reading_to_payload(reading) for reading in readings]

        # Try to upload with retry
        success = await self._upload_with_retry(
            endpoint="/rest/v1/device_readings",
            payload=payload
        )

        if success:
            # Mark as synced
            ids = [reading.id for reading in readings if reading.id]
            self.local_db.mark_device_readings_synced(ids)
            return len(readings)

        return 0

    def _device_reading_to_payload(self, reading: DeviceReadingRecord) -> dict:
        """Convert device reading record to API payload."""
        return {
            "site_id": reading.site_id,
            "device_id": reading.device_id,
            "register_name": reading.register_name,
            "value": reading.value,
            "unit": reading.unit,
            "timestamp": reading.timestamp.isoformat()
        }

    # ============================================
    # UPLOAD WITH RETRY
    # ============================================

    async def _upload_with_retry(
        self,
        endpoint: str,
        payload: list[dict] | dict,
        use_backend: bool = False
    ) -> bool:
        """
        Upload data with exponential backoff retry.

        Args:
            endpoint: API endpoint path
            payload: Data to upload (list for Supabase, dict for backend)
            use_backend: If True, use FastAPI backend client

        Returns:
            True if upload succeeded
        """
        if use_backend and self.backend_url:
            client = await self._get_backend_client()
        else:
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
        memory_usage_pct: float = 0.0,
        disk_usage_pct: float = 0.0,
        cpu_temp_celsius: float | None = None,
        # Control loop status fields (for site status header)
        control_loop_status: str = "unknown",  # running | stopped | error | unknown
        control_last_error: str | None = None,
        active_alarms_count: int = 0,
        config_version: str | None = None  # Hash of local config for sync detection
    ) -> bool:
        """
        Send heartbeat to cloud.

        Called every 5 minutes to indicate controller is online.
        Can send heartbeats even before site assignment if controller_id is valid.

        Args:
            firmware_version: Current firmware version
            uptime_seconds: Controller uptime
            cpu_usage_pct: CPU usage percentage
            memory_usage_pct: Memory usage percentage
            disk_usage_pct: Disk usage percentage
            cpu_temp_celsius: CPU temperature in Celsius (Raspberry Pi specific)
            control_loop_status: Status of control loop (running/stopped/error/unknown)
            control_last_error: Most recent error message if status is 'error'
            active_alarms_count: Number of currently active (unacknowledged) alarms
            config_version: Hash of local config for sync detection

        Returns:
            True if heartbeat was received
        """
        # Check if we can send heartbeats
        # Either: sync is enabled (valid site_id) OR heartbeat-only mode (valid controller_id)
        if not self._sync_enabled and not self._heartbeat_enabled:
            logger.debug("Heartbeat skipped: no valid site_id or controller_id")
            return False

        client = await self._get_client()

        # Build payload based on what IDs we have
        # Build metadata with controller_id, cpu_temp, and config_version
        metadata = {}
        if self.controller_id:
            metadata["controller_id"] = self.controller_id
        if cpu_temp_celsius is not None:
            metadata["cpu_temp_celsius"] = cpu_temp_celsius
        if config_version:
            metadata["config_version"] = config_version

        payload = {
            "firmware_version": firmware_version,
            "uptime_seconds": uptime_seconds,
            "cpu_usage_pct": cpu_usage_pct,
            "memory_usage_pct": memory_usage_pct,
            "disk_usage_pct": disk_usage_pct,
            # Control loop status fields (new)
            "control_loop_status": control_loop_status,
            "last_error": control_last_error,
            "active_alarms_count": active_alarms_count,
            "metadata": metadata
        }

        # ALWAYS include controller_id if valid - this ensures the controller
        # appears in the master controller list regardless of site assignment
        if self.controller_id and is_valid_uuid(self.controller_id):
            payload["controller_id"] = self.controller_id

        # Include site_id only if valid UUID (otherwise Supabase will reject it)
        if self._sync_enabled:
            payload["site_id"] = self.site_id

        # Include project_id if available (for backward compatibility)
        if self.project_id and is_valid_uuid(self.project_id):
            payload["project_id"] = self.project_id

        try:
            response = await client.post(
                "/rest/v1/controller_heartbeats",
                json=payload
            )

            if response.status_code in (200, 201):
                self.is_online = True
                logger.debug("Heartbeat sent successfully")
                return True

            # Log the error response for debugging
            logger.warning(f"Heartbeat failed: {response.status_code} - {response.text}")
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
            "sync_enabled": self._sync_enabled,
            "heartbeat_enabled": self._heartbeat_enabled,
            "controller_id": self.controller_id,
            "is_online": self.is_online,
            "last_sync_at": self.last_sync_at.isoformat() if self.last_sync_at else None,
            "last_error": self.last_error,
            "consecutive_failures": self.consecutive_failures,
            "pending_logs": stats["logs_pending"],
            "pending_alarms": stats["alarms_pending"],
            "pending_readings": stats["readings_pending"]
        }

    def is_sync_enabled(self) -> bool:
        """Check if cloud sync is enabled (site_id is valid UUID)."""
        return self._sync_enabled

    def is_heartbeat_enabled(self) -> bool:
        """Check if heartbeat is enabled (controller_id is valid UUID)."""
        return self._heartbeat_enabled or self._sync_enabled
