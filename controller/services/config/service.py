"""
Config Service (Layer 2) - Configuration Management

Responsible for:
- Fetching configuration from cloud (every 5 minutes)
- Maintaining local cache for offline operation
- Version tracking and change detection
- Notifying other services of config changes
"""

import asyncio
import hashlib
import json
import os
import signal
from datetime import datetime, timezone
from pathlib import Path

import httpx
import yaml
from aiohttp import web

from common.state import SharedState, set_service_health
from common.config import load_site_config
from common.logging_setup import get_service_logger

from .sync import ConfigSync
from .cache import ConfigCache
from .validator import ConfigValidator

logger = get_service_logger("config")

# Health server port
HEALTH_PORT = 8082
# Sync interval in seconds (60 minutes)
SYNC_INTERVAL_SECONDS = 3600
# Command poll interval (check for sync commands every 5 seconds)
COMMAND_POLL_INTERVAL_SECONDS = 5


class ConfigService:
    """
    Config Service - Layer 2

    Manages site configuration with:
    - Periodic sync from cloud (every 5 minutes)
    - Local caching for offline operation
    - Config validation before applying
    - Version history and rollback capability
    """

    def __init__(self, config_path: str | None = None):
        self.config_path = config_path or self._find_config_path()
        self.local_config = self._load_local_config()

        # Extract configuration
        self.site_id = self.local_config.get("site", {}).get("id")
        if not self.site_id:
            # Try environment variable (check both naming conventions)
            self.site_id = os.environ.get("SITE_ID") or os.environ.get("VOLTERIA_SITE_ID")

        # If still no site_id, try to fetch from cloud using controller_id
        if not self.site_id:
            controller_id = self.local_config.get("controller", {}).get("id")
            if controller_id:
                self.site_id = self._fetch_site_id_from_cloud(controller_id)

        # Cloud configuration
        cloud_config = self.local_config.get("cloud", {})
        self.supabase_url = cloud_config.get("url") or os.environ.get("SUPABASE_URL", "")
        self.supabase_key = cloud_config.get("key") or os.environ.get("SUPABASE_SERVICE_KEY", "")

        # Initialize components
        self.sync = ConfigSync(
            site_id=self.site_id or "",
            supabase_url=self.supabase_url,
            supabase_key=self.supabase_key,
        )
        self.cache = ConfigCache()
        self.validator = ConfigValidator()

        # Current loaded config
        self._current_config: dict | None = None
        self._start_time = datetime.now(timezone.utc)

        # Health server
        self._health_app: web.Application | None = None
        self._health_runner: web.AppRunner | None = None

        # State
        self._running = False
        self._sync_task: asyncio.Task | None = None
        self._command_task: asyncio.Task | None = None
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

    def _load_local_config(self) -> dict:
        """Load local configuration from YAML file"""
        try:
            with open(self.config_path, "r") as f:
                return yaml.safe_load(f) or {}
        except FileNotFoundError:
            logger.warning(f"Config file not found: {self.config_path}")
            return {}
        except yaml.YAMLError as e:
            logger.error(f"Error parsing config: {e}")
            return {}

    def _fetch_site_id_from_cloud(self, controller_id: str) -> str | None:
        """Fetch site_id from cloud using controller_id.

        When a controller is assigned to a site via the web UI, the site_id
        is stored in the controllers table. This method fetches it automatically
        so the controller doesn't need manual configuration.
        """
        cloud_config = self.local_config.get("cloud", {})
        url = cloud_config.get("url") or os.environ.get("SUPABASE_URL", "")
        key = cloud_config.get("key") or os.environ.get("SUPABASE_SERVICE_KEY", "")

        if not url or not key:
            logger.warning("Cannot fetch site_id: missing cloud credentials")
            return None

        try:
            response = httpx.get(
                f"{url}/rest/v1/controllers",
                params={"id": f"eq.{controller_id}", "select": "site_id"},
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                },
                timeout=10,
            )
            response.raise_for_status()
            data = response.json()
            if data and data[0].get("site_id"):
                site_id = data[0]["site_id"]
                logger.info(f"Auto-discovered site_id from cloud: {site_id}")
                return site_id
            else:
                logger.info("Controller not yet assigned to a site")
        except Exception as e:
            logger.warning(f"Failed to fetch site_id from cloud: {e}")

        return None

    def _config_content_changed(self, new_config: dict) -> bool:
        """
        Check if config content has actually changed.

        Compares a hash of meaningful config fields (devices, settings)
        rather than just sites.updated_at. This detects device register
        changes even when sites.updated_at doesn't change.

        Args:
            new_config: New config from cloud

        Returns:
            True if content has changed
        """
        if not self._current_config:
            return True

        def compute_hash(config: dict) -> str:
            """Compute hash of meaningful config content"""
            # Include fields that affect controller behavior
            content = {
                "devices": config.get("devices", []),
                "calculated_fields": config.get("calculated_fields", []),
                "site_level_alarms": config.get("site_level_alarms", []),
                "alarm_overrides": config.get("alarm_overrides", {}),
                "logging": config.get("logging", {}),
                "safe_mode": config.get("safe_mode", {}),
                "dg_reserve_kw": config.get("dg_reserve_kw"),
                "operation_mode": config.get("operation_mode"),
                "control_interval_ms": config.get("control_interval_ms"),
            }
            # Use json with sort_keys for consistent ordering
            content_str = json.dumps(content, sort_keys=True, default=str)
            return hashlib.md5(content_str.encode()).hexdigest()

        current_hash = compute_hash(self._current_config)
        new_hash = compute_hash(new_config)

        if current_hash != new_hash:
            logger.debug(f"Config content changed (hash: {current_hash[:8]} → {new_hash[:8]})")
            return True

        return False

    async def start(self) -> None:
        """Start the config service"""
        logger.info("Starting Config Service")

        self._running = True

        # Update service health
        set_service_health("config", {
            "status": "starting",
            "is_healthy": False,
        })

        # Load cached config first (for offline start)
        await self._load_cached_config()

        # Start health server
        await self._start_health_server()

        # Initial sync from cloud
        await self._sync_config()

        # Start periodic sync task
        self._sync_task = asyncio.create_task(self._sync_loop())

        # Start command polling task (for manual sync commands from cloud)
        self._command_task = asyncio.create_task(self._command_poll_loop())

        # Update service health to running
        set_service_health("config", {
            "status": "running",
            "is_healthy": True,
            "started_at": self._start_time.isoformat(),
        })

        logger.info(
            f"Config Service started (site: {self.site_id})",
            extra={"site_id": self.site_id},
        )

        # Setup signal handlers
        self._setup_signal_handlers()

        # Wait for shutdown
        await self._shutdown_event.wait()

    async def stop(self) -> None:
        """Stop the config service"""
        logger.info("Stopping Config Service")

        self._running = False

        # Cancel sync task
        if self._sync_task:
            self._sync_task.cancel()
            try:
                await self._sync_task
            except asyncio.CancelledError:
                pass

        # Cancel command polling task
        if self._command_task:
            self._command_task.cancel()
            try:
                await self._command_task
            except asyncio.CancelledError:
                pass

        # Stop health server
        await self._stop_health_server()

        # Update service health
        set_service_health("config", {
            "status": "stopped",
            "is_healthy": False,
        })

        logger.info("Config Service stopped")

    def _setup_signal_handlers(self) -> None:
        """Setup graceful shutdown signal handlers"""
        loop = asyncio.get_event_loop()

        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, self._handle_shutdown)
            except NotImplementedError:
                # Windows doesn't support add_signal_handler
                signal.signal(sig, lambda s, f: self._handle_shutdown())

    def _handle_shutdown(self) -> None:
        """Handle shutdown signal"""
        logger.info("Received shutdown signal")
        self._shutdown_event.set()

    async def _load_cached_config(self) -> None:
        """Load configuration from cache"""
        cached_config = self.cache.load()

        if cached_config:
            # Validate cached config
            is_valid, errors = self.validator.validate(cached_config)

            if is_valid:
                self._current_config = cached_config
                logger.info(
                    f"Loaded config from cache (version: {cached_config.get('updated_at')})"
                )
            else:
                logger.warning(
                    f"Cached config invalid: {errors}. Will fetch from cloud."
                )
        else:
            logger.info("No cached config found. Will fetch from cloud.")

    async def _sync_loop(self) -> None:
        """Periodic config sync loop"""
        while self._running:
            await asyncio.sleep(SYNC_INTERVAL_SECONDS)

            try:
                # Check if updates are available before full sync
                current_version = self._current_config.get("updated_at") if self._current_config else None

                if await self.sync.check_for_updates(current_version):
                    await self._sync_config()
                else:
                    logger.debug("Config is up to date")

            except Exception as e:
                logger.error(f"Error in sync loop: {e}")

    async def _sync_config(self) -> bool:
        """
        Sync configuration from cloud.

        Returns:
            True if config was updated
        """
        if not self.site_id:
            logger.warning("No site ID configured, cannot sync")
            return False

        try:
            # Fetch from cloud
            new_config = await self.sync.fetch_site_config()

            if not new_config:
                logger.warning("Failed to fetch config from cloud")
                return False

            # Validate new config
            is_valid, errors = self.validator.validate(new_config)

            if not is_valid:
                logger.error(f"New config validation failed: {errors}")
                return False

            # Check if config content actually changed
            config_changed = self._config_content_changed(new_config)
            new_version = new_config.get("updated_at")
            old_version = self._current_config.get("updated_at") if self._current_config else None

            # Always save to ensure local cache is fresh
            # Services detect changes themselves by comparing config hash
            self.cache.save(new_config)

            # Update current config
            self._current_config = new_config

            # Update config_synced_at in cloud so frontend knows we synced
            await self._update_config_synced_at(new_version)

            if config_changed:
                logger.info(
                    f"Config updated: {old_version} → {new_version}",
                    extra={
                        "old_version": old_version,
                        "new_version": new_version,
                    },
                )
            else:
                logger.debug("Config synced (no content changes)")

            return config_changed

        except Exception as e:
            logger.error(f"Error syncing config: {e}")
            return False

    async def _update_config_synced_at(self, config_version: str) -> None:
        """Update site.config_synced_at in cloud so frontend knows we synced"""
        if not self.site_id:
            return

        try:
            async with httpx.AsyncClient() as client:
                response = await client.patch(
                    f"{self.supabase_url}/rest/v1/sites",
                    params={"id": f"eq.{self.site_id}"},
                    json={
                        "config_synced_at": datetime.now(timezone.utc).isoformat(),
                        "controller_config_version": config_version,
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
                logger.debug(f"Updated config_synced_at for site {self.site_id}")
        except Exception as e:
            # Don't fail sync if this update fails
            logger.warning(f"Failed to update config_synced_at: {e}")

    async def _command_poll_loop(self) -> None:
        """Poll for sync commands from cloud"""
        while self._running:
            try:
                await self._check_sync_commands()
            except Exception as e:
                logger.error(f"Error checking sync commands: {e}")

            await asyncio.sleep(COMMAND_POLL_INTERVAL_SECONDS)

    async def _check_sync_commands(self) -> None:
        """Check for pending sync_config commands"""
        if not self.site_id:
            return

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.supabase_url}/rest/v1/control_commands",
                    params={
                        "site_id": f"eq.{self.site_id}",
                        "command_type": "eq.sync_config",
                        "status": "eq.pending",
                        "order": "created_at.asc",
                        "limit": "1",
                    },
                    headers={
                        "apikey": self.supabase_key,
                        "Authorization": f"Bearer {self.supabase_key}",
                    },
                    timeout=10.0,
                )
                response.raise_for_status()
                commands = response.json()

                if commands:
                    await self._execute_sync_command(commands[0])

        except httpx.HTTPError as e:
            logger.error(f"HTTP error checking sync commands: {e}")

    async def _execute_sync_command(self, command: dict) -> None:
        """Execute a sync_config command"""
        command_id = command["id"]

        logger.info(
            f"Executing sync command {command_id}",
            extra={"command_id": command_id},
        )

        try:
            # Update command status to "in_progress"
            await self._update_command_status(command_id, "in_progress")

            # Force sync - fetch fresh config from cloud
            # Note: force_sync returns False if config unchanged, which is OK
            config_changed = await self.force_sync()

            # For manual sync, success means we fetched and validated config
            # Even if unchanged, the command succeeded
            if self._current_config:
                await self._update_command_status(command_id, "completed")
                # Always update config_synced_at on manual sync to confirm we checked
                config_version = self._current_config.get("updated_at", "")
                await self._update_config_synced_at(config_version)
                if config_changed:
                    logger.info(f"Sync command {command_id} completed - config updated")
                else:
                    logger.info(f"Sync command {command_id} completed - config unchanged")
            else:
                await self._update_command_status(
                    command_id, "failed", "No config available after sync"
                )
                logger.error(f"Sync command {command_id} failed - no config")

        except Exception as e:
            logger.error(f"Error executing sync command {command_id}: {e}")
            await self._update_command_status(
                command_id, "failed", str(e)
            )

    async def _update_command_status(
        self,
        command_id: str,
        status: str,
        error: str | None = None,
    ) -> None:
        """Update command status in database"""
        try:
            update_data = {"status": status}

            if status == "in_progress":
                update_data["executed_at"] = datetime.now(timezone.utc).isoformat()
            elif status in ["completed", "failed"]:
                update_data["executed_at"] = datetime.now(timezone.utc).isoformat()

            if error:
                update_data["error_message"] = error

            async with httpx.AsyncClient() as client:
                response = await client.patch(
                    f"{self.supabase_url}/rest/v1/control_commands",
                    params={"id": f"eq.{command_id}"},
                    json=update_data,
                    headers={
                        "apikey": self.supabase_key,
                        "Authorization": f"Bearer {self.supabase_key}",
                        "Content-Type": "application/json",
                        "Prefer": "return=minimal",
                    },
                    timeout=10.0,
                )
                response.raise_for_status()

        except Exception as e:
            logger.error(f"Failed to update command status: {e}")

    async def force_sync(self) -> bool:
        """Force immediate config sync (for API trigger)"""
        return await self._sync_config()

    async def rollback(self, version: str) -> bool:
        """Rollback to a previous config version"""
        if self.cache.rollback(version):
            self._current_config = self.cache.load()
            # Services detect config changes via hash comparison
            return True
        return False

    def get_config(self) -> dict | None:
        """Get current configuration"""
        return self._current_config

    def get_versions(self) -> list[dict]:
        """Get available config versions"""
        return self.cache.get_versions()

    async def _start_health_server(self) -> None:
        """Start the health check HTTP server"""
        self._health_app = web.Application()
        self._health_app.router.add_get("/health", self._health_handler)
        self._health_app.router.add_post("/sync", self._sync_handler)

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
            "service": "config",
            "uptime": int(uptime),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "config_version": self._current_config.get("updated_at") if self._current_config else None,
            "site_id": self.site_id,
        })

    async def _sync_handler(self, request: web.Request) -> web.Response:
        """Handle force sync requests"""
        success = await self.force_sync()

        return web.json_response({
            "success": success,
            "config_version": self._current_config.get("updated_at") if self._current_config else None,
        })


async def main() -> None:
    """Main entry point"""
    service = ConfigService()

    try:
        await service.start()
    finally:
        await service.stop()


if __name__ == "__main__":
    asyncio.run(main())
