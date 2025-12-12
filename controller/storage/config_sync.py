"""
Config Sync Service

Handles synchronization of site configuration FROM cloud TO controller.

Features:
- Fetch site config including devices with measurement_type
- Local caching for offline operation
- Version tracking for change detection
- Periodic sync with configurable interval

This is the reverse of cloud_sync.py which syncs data TO cloud.
"""

import asyncio
import json
import logging
import os
from datetime import datetime
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


class ConfigSync:
    """
    Syncs site configuration from cloud to local storage.

    The controller calls this periodically to:
    1. Check if cloud config has changed (via config_version)
    2. Download updated device list with measurement_type
    3. Save locally for offline operation
    """

    def __init__(
        self,
        site_id: str,
        api_url: str,
        api_key: str,
        local_config_path: str = "/data/synced_config.json",
        sync_interval_s: int = 300  # 5 minutes
    ):
        """
        Initialize config sync service.

        Args:
            site_id: UUID of the site in Supabase
            api_url: Backend API URL (e.g., https://volteria.org/api)
            api_key: Supabase service role key for authentication
            local_config_path: Path to save synced config locally
            sync_interval_s: How often to sync (seconds)
        """
        self.site_id = site_id
        self.api_url = api_url.rstrip("/")
        self.api_key = api_key
        self.local_config_path = local_config_path
        self.sync_interval_s = sync_interval_s

        # State tracking
        self.last_config_version: Optional[str] = None
        self.last_sync_at: Optional[datetime] = None
        self.last_error: Optional[str] = None
        self.is_online = False

        # Cached config
        self._cached_config: Optional[dict] = None

        # HTTP client
        self._client: Optional[httpx.AsyncClient] = None

        # Control flag
        self._running = False

        # Ensure data directory exists
        os.makedirs(os.path.dirname(local_config_path), exist_ok=True)

        # Try to load existing local config
        self._load_local_config()

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                headers={
                    "apikey": self.api_key,
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
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
    # FETCH CONFIG FROM CLOUD
    # ============================================

    @staticmethod
    async def fetch_by_controller_id(
        controller_id: str,
        api_url: str,
        api_key: str
    ) -> Optional[dict]:
        """
        Fetch configuration using controller ID.

        This is called on startup BEFORE we know the site_id.
        The controller identifies itself by its ID and gets:
        - status: "assigned" or "unassigned"
        - site config (if assigned)

        Args:
            controller_id: UUID of the controller from config.yaml
            api_url: Backend API URL (e.g., https://volteria.org/api)
            api_key: Supabase anon key for authentication

        Returns:
            Config response dict with status and optionally site config
        """
        url = f"{api_url.rstrip('/')}/controllers/{controller_id}/config"

        async with httpx.AsyncClient(
            headers={
                "apikey": api_key,
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            timeout=30.0
        ) as client:
            try:
                response = await client.get(url)

                if response.status_code == 200:
                    data = response.json()
                    logger.info(f"Controller config status: {data.get('status')}")
                    return data

                elif response.status_code == 404:
                    logger.error(f"Controller {controller_id} not found in cloud")
                    return {"status": "error", "message": "Controller not found"}

                else:
                    logger.error(f"Config fetch failed: HTTP {response.status_code}")
                    return {"status": "error", "message": f"HTTP {response.status_code}"}

            except httpx.TimeoutException:
                logger.warning("Config fetch timeout - will use local config if available")
                return {"status": "error", "message": "Request timeout"}

            except httpx.ConnectError:
                logger.warning("Cannot reach cloud - will use local config if available")
                return {"status": "error", "message": "Connection failed"}

            except Exception as e:
                logger.error(f"Config fetch error: {e}")
                return {"status": "error", "message": str(e)}

    async def fetch_config(self) -> Optional[dict]:
        """
        Fetch latest config from cloud.

        Returns:
            Config dictionary or None on error
        """
        client = await self._get_client()

        try:
            # Call the backend API endpoint
            url = f"{self.api_url}/sites/{self.site_id}/config"
            response = await client.get(url)

            if response.status_code == 200:
                config = response.json()
                self.is_online = True
                self.last_error = None

                # Check if config has changed
                new_version = config.get("config_version")
                if new_version != self.last_config_version:
                    logger.info(f"Config updated: {self.last_config_version} -> {new_version}")
                    self.last_config_version = new_version
                    self._cached_config = config

                    # Save to local file
                    self._save_local_config(config)

                self.last_sync_at = datetime.now()
                return config

            # Handle errors
            self.last_error = f"HTTP {response.status_code}: {response.text}"
            logger.warning(f"Config fetch failed: {self.last_error}")
            return None

        except httpx.TimeoutException:
            self.last_error = "Request timeout"
            self.is_online = False
            logger.warning("Config fetch timeout")
            return None

        except httpx.ConnectError:
            self.last_error = "Connection failed"
            self.is_online = False
            logger.warning("Config fetch connection failed")
            return None

        except Exception as e:
            self.last_error = str(e)
            logger.error(f"Config fetch error: {e}")
            return None

    # ============================================
    # LOCAL CONFIG MANAGEMENT
    # ============================================

    def _save_local_config(self, config: dict):
        """Save config to local file for offline operation."""
        try:
            with open(self.local_config_path, "w") as f:
                json.dump(config, f, indent=2, default=str)
            logger.debug(f"Config saved to {self.local_config_path}")
        except Exception as e:
            logger.error(f"Failed to save local config: {e}")

    def _load_local_config(self):
        """Load config from local file."""
        if os.path.exists(self.local_config_path):
            try:
                with open(self.local_config_path, "r") as f:
                    self._cached_config = json.load(f)
                self.last_config_version = self._cached_config.get("config_version")
                logger.info(f"Loaded local config (version: {self.last_config_version})")
            except Exception as e:
                logger.error(f"Failed to load local config: {e}")
                self._cached_config = None

    def get_config(self) -> Optional[dict]:
        """
        Get current config (from cache or local file).

        Returns:
            Config dictionary or None if not available
        """
        return self._cached_config

    def get_devices(self) -> dict:
        """
        Get devices grouped by measurement_type.

        Returns dict with keys: load, sub_load, solar, generator, fuel
        Each value is a list of device configs.
        """
        if not self._cached_config:
            return {
                "load": [],
                "sub_load": [],
                "solar": [],
                "generator": [],
                "fuel": []
            }

        devices = self._cached_config.get("devices", {})
        result = {
            "load": [],
            "sub_load": [],
            "solar": [],
            "generator": [],
            "fuel": []
        }

        # Collect all devices from all categories
        all_devices = []
        for category in ["load_meters", "inverters", "generators"]:
            all_devices.extend(devices.get(category, []))

        # Re-categorize by measurement_type
        for device in all_devices:
            measurement_type = device.get("measurement_type", "unknown")
            if measurement_type in result:
                result[measurement_type].append(device)

        return result

    def get_load_devices(self) -> list:
        """Get devices that measure load (main site load)."""
        return self.get_devices().get("load", [])

    def get_sub_load_devices(self) -> list:
        """Get devices that measure sub-load (partial loads)."""
        return self.get_devices().get("sub_load", [])

    def get_solar_devices(self) -> list:
        """Get devices that measure solar output."""
        return self.get_devices().get("solar", [])

    def get_generator_devices(self) -> list:
        """Get devices that measure generator output."""
        return self.get_devices().get("generator", [])

    def get_fuel_devices(self) -> list:
        """Get devices that measure fuel levels."""
        return self.get_devices().get("fuel", [])

    # ============================================
    # SYNC LOOP
    # ============================================

    async def start(self):
        """Start the config sync loop."""
        self._running = True
        logger.info(f"Config sync started (interval: {self.sync_interval_s}s)")

        # Initial fetch
        await self.fetch_config()

        while self._running:
            try:
                await asyncio.sleep(self.sync_interval_s)
                await self.fetch_config()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Config sync error: {e}")

    def stop(self):
        """Stop the config sync loop."""
        self._running = False

    # ============================================
    # STATUS
    # ============================================

    def get_status(self) -> dict:
        """Get sync status."""
        return {
            "is_online": self.is_online,
            "last_sync_at": self.last_sync_at.isoformat() if self.last_sync_at else None,
            "last_config_version": self.last_config_version,
            "last_error": self.last_error,
            "has_local_config": self._cached_config is not None
        }
