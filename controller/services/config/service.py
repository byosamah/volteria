"""
Config Service (Layer 2) - Configuration Management

Responsible for:
- Fetching configuration from cloud (every 5 minutes)
- Maintaining local cache for offline operation
- Version tracking and change detection
- Notifying other services of config changes
"""

import asyncio
import os
import signal
from datetime import datetime, timezone
from pathlib import Path

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
# Sync interval in seconds (5 minutes)
SYNC_INTERVAL_SECONDS = 300


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
            # Try environment variable
            self.site_id = os.environ.get("VOLTERIA_SITE_ID")

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

            # Check if config changed
            current_version = self._current_config.get("updated_at") if self._current_config else None
            new_version = new_config.get("updated_at")

            if current_version == new_version:
                logger.debug("Config unchanged")
                return False

            # Save to cache
            self.cache.save(new_config)

            # Update current config
            self._current_config = new_config

            # Notify other services
            await self._notify_config_change()

            logger.info(
                f"Config updated: {current_version} → {new_version}",
                extra={
                    "old_version": current_version,
                    "new_version": new_version,
                },
            )

            return True

        except Exception as e:
            logger.error(f"Error syncing config: {e}")
            return False

    async def _notify_config_change(self) -> None:
        """Notify other services of config change"""
        from common.state import notify_config_changed

        version = self._current_config.get("updated_at") if self._current_config else ""
        notify_config_changed(version)

        logger.info(f"Config change notification sent (version: {version})")

    async def force_sync(self) -> bool:
        """Force immediate config sync (for API trigger)"""
        return await self._sync_config()

    async def rollback(self, version: str) -> bool:
        """Rollback to a previous config version"""
        if self.cache.rollback(version):
            self._current_config = self.cache.load()
            await self._notify_config_change()
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
