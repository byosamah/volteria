"""
OTA Updater

Handles firmware updates with manual approval flow:
1. Check for updates (hourly)
2. Download update package
3. Verify checksum
4. Wait for manual approval
5. Apply update
6. Verify health
7. Rollback if needed
"""

import asyncio
import hashlib
import os
from datetime import datetime, timezone
from dataclasses import dataclass
from pathlib import Path
from enum import Enum

import httpx

from common.state import SharedState
from common.logging_setup import get_service_logger

logger = get_service_logger("system.ota")


class UpdateStatus(str, Enum):
    """Update status states"""
    IDLE = "idle"
    CHECKING = "checking"
    AVAILABLE = "available"
    DOWNLOADING = "downloading"
    READY = "ready"
    APPLYING = "applying"
    SUCCESS = "success"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"


@dataclass
class FirmwareRelease:
    """Firmware release information"""
    id: str
    version: str
    download_url: str
    checksum_sha256: str
    file_size_bytes: int
    release_notes: str
    min_version: str | None


class OTAUpdater:
    """
    OTA firmware updater with manual approval.

    Flow:
    1. System service checks for updates hourly
    2. Downloads to /opt/volteria/updates/
    3. Verifies SHA256 checksum
    4. Status: "ready" - waits for admin approval
    5. On approval command, applies update
    6. Restarts services and verifies health
    7. Rolls back on health check failure
    """

    UPDATE_DIR = Path("/opt/volteria/updates")
    BACKUP_DIR = Path("/opt/volteria/backup")
    CONTROLLER_DIR = Path("/opt/volteria/controller")
    CHECK_INTERVAL_HOURS = 1

    def __init__(
        self,
        controller_id: str,
        current_version: str,
        hardware_type_id: str,
        supabase_url: str,
        supabase_key: str,
    ):
        self.controller_id = controller_id
        self.current_version = current_version
        self.hardware_type_id = hardware_type_id
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key

        self._status = UpdateStatus.IDLE
        self._pending_release: FirmwareRelease | None = None
        self._running = False
        self._task: asyncio.Task | None = None

        # Ensure directories exist
        self.UPDATE_DIR.mkdir(parents=True, exist_ok=True)
        self.BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    @property
    def status(self) -> UpdateStatus:
        return self._status

    async def start(self) -> None:
        """Start OTA checker"""
        self._running = True
        self._task = asyncio.create_task(self._check_loop())
        logger.info("OTA updater started")

    async def stop(self) -> None:
        """Stop OTA checker"""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("OTA updater stopped")

    async def _check_loop(self) -> None:
        """Periodic update check loop"""
        while self._running:
            try:
                await self.check_for_updates()
            except Exception as e:
                logger.error(f"Error checking for updates: {e}")

            await asyncio.sleep(self.CHECK_INTERVAL_HOURS * 3600)

    async def check_for_updates(self) -> FirmwareRelease | None:
        """Check for available updates"""
        # Skip if no hardware type configured
        if not self.hardware_type_id:
            logger.debug("Skipping update check: no hardware_type_id configured")
            self._status = UpdateStatus.IDLE
            self._update_state()
            return None

        self._status = UpdateStatus.CHECKING
        self._update_state()

        try:
            async with httpx.AsyncClient() as client:
                # Query firmware_releases for newer versions
                response = await client.get(
                    f"{self.supabase_url}/rest/v1/firmware_releases",
                    params={
                        "hardware_type_id": f"eq.{self.hardware_type_id}",
                        "is_active": "eq.true",
                        "order": "created_at.desc",
                        "limit": "1",
                    },
                    headers={
                        "apikey": self.supabase_key,
                        "Authorization": f"Bearer {self.supabase_key}",
                    },
                    timeout=30.0,
                )
                response.raise_for_status()
                releases = response.json()

                if not releases:
                    self._status = UpdateStatus.IDLE
                    self._update_state()
                    return None

                release_data = releases[0]

                # Check if newer than current
                if not self._is_newer_version(release_data["version"]):
                    self._status = UpdateStatus.IDLE
                    self._update_state()
                    logger.info(f"Current version {self.current_version} is up to date")
                    return None

                # Check minimum version requirement
                min_version = release_data.get("min_version")
                if min_version and not self._meets_minimum(min_version):
                    logger.warning(
                        f"Cannot update to {release_data['version']}: "
                        f"requires minimum version {min_version}, "
                        f"current is {self.current_version}"
                    )
                    self._status = UpdateStatus.IDLE
                    self._update_state()
                    return None

                release = FirmwareRelease(
                    id=release_data["id"],
                    version=release_data["version"],
                    download_url=release_data["download_url"],
                    checksum_sha256=release_data["checksum_sha256"],
                    file_size_bytes=release_data.get("file_size_bytes", 0),
                    release_notes=release_data.get("release_notes", ""),
                    min_version=min_version,
                )

                self._pending_release = release
                self._status = UpdateStatus.AVAILABLE
                self._update_state()

                logger.info(
                    f"Update available: {self.current_version} → {release.version}"
                )

                return release

        except Exception as e:
            logger.error(f"Failed to check for updates: {e}")
            self._status = UpdateStatus.IDLE
            self._update_state()
            return None

    async def download_update(self) -> bool:
        """Download the pending update"""
        if not self._pending_release:
            logger.error("No pending release to download")
            return False

        release = self._pending_release
        self._status = UpdateStatus.DOWNLOADING
        self._update_state()

        try:
            download_path = self.UPDATE_DIR / f"volteria-{release.version}.tar.gz"

            async with httpx.AsyncClient() as client:
                async with client.stream("GET", release.download_url, timeout=300.0) as response:
                    response.raise_for_status()

                    with open(download_path, "wb") as f:
                        async for chunk in response.aiter_bytes(chunk_size=8192):
                            f.write(chunk)

            # Verify checksum
            if not self._verify_checksum(download_path, release.checksum_sha256):
                logger.error("Checksum verification failed")
                download_path.unlink()
                self._status = UpdateStatus.FAILED
                self._update_state()
                await self._report_status("failed", "Checksum verification failed")
                return False

            self._status = UpdateStatus.READY
            self._update_state()

            logger.info(f"Update downloaded and verified: {release.version}")
            await self._report_status("ready")

            return True

        except Exception as e:
            logger.error(f"Failed to download update: {e}")
            self._status = UpdateStatus.FAILED
            self._update_state()
            await self._report_status("failed", str(e))
            return False

    def _verify_checksum(self, file_path: Path, expected_sha256: str) -> bool:
        """Verify file SHA256 checksum"""
        sha256_hash = hashlib.sha256()

        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                sha256_hash.update(chunk)

        actual = sha256_hash.hexdigest()
        return actual.lower() == expected_sha256.lower()

    async def apply_update(self) -> bool:
        """
        Apply downloaded update (called after manual approval).

        This should only be called when status is READY.
        """
        if self._status != UpdateStatus.READY:
            logger.error(f"Cannot apply update in status: {self._status}")
            return False

        if not self._pending_release:
            logger.error("No pending release to apply")
            return False

        release = self._pending_release
        self._status = UpdateStatus.APPLYING
        self._update_state()
        await self._report_status("applying")

        try:
            # 1. Create backup
            await self._create_backup()

            # 2. Stop services (except system)
            await self._stop_services()

            # 3. Extract update
            download_path = self.UPDATE_DIR / f"volteria-{release.version}.tar.gz"
            await self._extract_update(download_path)

            # 4. Restart services
            await self._start_services()

            # 5. Wait for health check
            await asyncio.sleep(30)  # Give services time to start

            # 6. Verify health
            if not await self._verify_health():
                logger.error("Health check failed after update, rolling back")
                await self.rollback()
                return False

            # 7. Update succeeded
            self._status = UpdateStatus.SUCCESS
            self._update_state()
            await self._report_status("success")

            logger.info(f"Successfully updated to {release.version}")

            # Cleanup
            download_path.unlink(missing_ok=True)
            self._pending_release = None

            return True

        except Exception as e:
            logger.error(f"Failed to apply update: {e}")
            await self.rollback()
            return False

    async def rollback(self) -> bool:
        """Rollback to previous version"""
        logger.info("Rolling back to previous version")

        try:
            # Stop services
            await self._stop_services()

            # Restore backup
            backup_path = self.BACKUP_DIR / "controller_backup.tar.gz"
            if backup_path.exists():
                import tarfile
                with tarfile.open(backup_path, "r:gz") as tar:
                    tar.extractall(self.CONTROLLER_DIR.parent)

            # Restart services
            await self._start_services()

            self._status = UpdateStatus.ROLLED_BACK
            self._update_state()
            await self._report_status("rolled_back", "Update failed, rolled back")

            logger.info("Rollback completed")
            return True

        except Exception as e:
            logger.critical(f"Rollback failed: {e}")
            self._status = UpdateStatus.FAILED
            self._update_state()
            return False

    async def _create_backup(self) -> None:
        """Create backup of current installation"""
        import tarfile

        backup_path = self.BACKUP_DIR / "controller_backup.tar.gz"

        with tarfile.open(backup_path, "w:gz") as tar:
            tar.add(self.CONTROLLER_DIR, arcname="controller")

        logger.info(f"Backup created: {backup_path}")

    async def _extract_update(self, update_path: Path) -> None:
        """Extract update package"""
        import tarfile

        with tarfile.open(update_path, "r:gz") as tar:
            tar.extractall(self.CONTROLLER_DIR.parent)

        logger.info(f"Update extracted to {self.CONTROLLER_DIR}")

    async def _stop_services(self) -> None:
        """Stop all services except system"""
        import subprocess

        services = ["volteria-logging", "volteria-control", "volteria-device", "volteria-config"]

        for svc in services:
            try:
                subprocess.run(
                    ["sudo", "systemctl", "stop", svc],
                    capture_output=True,
                    timeout=30,
                )
                logger.info(f"Stopped {svc}")
            except Exception as e:
                logger.warning(f"Error stopping {svc}: {e}")

    async def _start_services(self) -> None:
        """Start all services"""
        import subprocess

        services = ["volteria-config", "volteria-device", "volteria-control", "volteria-logging"]

        for svc in services:
            try:
                subprocess.run(
                    ["sudo", "systemctl", "start", svc],
                    capture_output=True,
                    timeout=30,
                )
                logger.info(f"Started {svc}")
            except Exception as e:
                logger.warning(f"Error starting {svc}: {e}")

    async def _verify_health(self) -> bool:
        """Verify all services are healthy"""
        service_health = SharedState.read("service_health")

        for name in ["config", "device", "control"]:
            health = service_health.get(name, {})
            if not health.get("is_healthy", False):
                logger.error(f"Service {name} not healthy after update")
                return False

        return True

    def _is_newer_version(self, version: str) -> bool:
        """Check if version is newer than current"""
        current_parts = [int(p) for p in self.current_version.split(".")]
        new_parts = [int(p) for p in version.split(".")]

        for c, n in zip(current_parts, new_parts):
            if n > c:
                return True
            if n < c:
                return False
        return False

    def _meets_minimum(self, min_version: str) -> bool:
        """Check if current version meets minimum requirement"""
        current_parts = [int(p) for p in self.current_version.split(".")]
        min_parts = [int(p) for p in min_version.split(".")]

        for c, m in zip(current_parts, min_parts):
            if c < m:
                return False
            if c > m:
                return True
        return True

    def _update_state(self) -> None:
        """Update OTA status in shared state"""
        state = {
            "status": self._status.value,
            "current_version": self.current_version,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        if self._pending_release:
            state["pending_version"] = self._pending_release.version
            state["release_notes"] = self._pending_release.release_notes

        SharedState.write("ota_status", state)

    async def _report_status(self, status: str, error: str | None = None) -> None:
        """Report update status to backend"""
        try:
            async with httpx.AsyncClient() as client:
                payload = {
                    "controller_id": self.controller_id,
                    "from_version": self.current_version,
                    "to_version": self._pending_release.version if self._pending_release else None,
                    "status": status,
                    "error_message": error,
                }

                if status in ["downloading", "applying"]:
                    payload["started_at"] = datetime.now(timezone.utc).isoformat()
                if status in ["success", "failed", "rolled_back"]:
                    payload["completed_at"] = datetime.now(timezone.utc).isoformat()

                await client.post(
                    f"{self.supabase_url}/rest/v1/controller_updates",
                    json=payload,
                    headers={
                        "apikey": self.supabase_key,
                        "Authorization": f"Bearer {self.supabase_key}",
                        "Content-Type": "application/json",
                        "Prefer": "return=minimal",
                    },
                    timeout=10.0,
                )
        except Exception as e:
            logger.error(f"Failed to report OTA status: {e}")
