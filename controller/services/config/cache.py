"""
Configuration Cache

Local file caching for offline operation.
Maintains current config and version history.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common.state import SharedState
from common.logging_setup import get_service_logger

logger = get_service_logger("config.cache")


class ConfigCache:
    """
    Local configuration cache.

    Stores:
    - Current active configuration
    - Version history (last 5 configs)
    """

    def __init__(
        self,
        cache_dir: Path | None = None,
        max_versions: int = 5,
    ):
        self.cache_dir = cache_dir or Path("/opt/volteria/data/config_history")
        self.max_versions = max_versions

        # Ensure directory exists
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def save(self, config: dict[str, Any]) -> None:
        """
        Save configuration to cache.

        Saves to SharedState for other services to read.
        """
        # Add cache metadata
        config_with_meta = {
            **config,
            "_cached_at": datetime.now(timezone.utc).isoformat(),
        }

        try:
            # Write to SharedState (uses VOLTERIA_STATE_DIR, same as other services)
            SharedState.write("config", config_with_meta)
            logger.info("Config saved to SharedState")

        except Exception as e:
            logger.error(f"Failed to save config to SharedState: {e}", exc_info=True)
            raise  # Re-raise to fail the sync properly

        # Save versioned copy
        version_timestamp = config.get("updated_at", datetime.now(timezone.utc).isoformat())
        # Sanitize timestamp for filename
        safe_timestamp = version_timestamp.replace(":", "-").replace("+", "_")
        version_file = self.cache_dir / f"v_{safe_timestamp}.json"

        with open(version_file, "w", encoding="utf-8") as f:
            json.dump(config_with_meta, f, indent=2)

        logger.info(
            f"Config saved to cache (version: {version_timestamp})",
            extra={"version": version_timestamp},
        )

        # Cleanup old versions
        self._cleanup_old_versions()

    def load(self) -> dict[str, Any] | None:
        """
        Load configuration from cache.

        Returns:
            Cached config dict, or None if not found
        """
        # Try shared state first (in-memory cache)
        config = SharedState.read("config")
        if config and config.get("id"):
            return config

        # Try latest version file
        version_files = sorted(self.cache_dir.glob("v_*.json"), reverse=True)
        if version_files:
            try:
                with open(version_files[0], "r", encoding="utf-8") as f:
                    config = json.load(f)
                    # Update shared state
                    SharedState.write("config", config)
                    return config
            except (json.JSONDecodeError, IOError) as e:
                logger.error(f"Error loading cached config: {e}")

        return None

    def get_version(self, version: str) -> dict[str, Any] | None:
        """
        Load a specific config version.

        Args:
            version: ISO timestamp of the version

        Returns:
            Config dict for that version, or None
        """
        safe_version = version.replace(":", "-").replace("+", "_")
        version_file = self.cache_dir / f"v_{safe_version}.json"

        if version_file.exists():
            try:
                with open(version_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                logger.error(f"Error loading version {version}: {e}")

        return None

    def get_versions(self) -> list[dict[str, str]]:
        """
        Get list of available config versions.

        Returns:
            List of version info dicts with version and cached_at
        """
        versions = []
        for version_file in sorted(self.cache_dir.glob("v_*.json"), reverse=True):
            try:
                with open(version_file, "r", encoding="utf-8") as f:
                    config = json.load(f)
                    versions.append({
                        "version": config.get("updated_at", ""),
                        "cached_at": config.get("_cached_at", ""),
                        "file": version_file.name,
                    })
            except (json.JSONDecodeError, IOError):
                continue

        return versions

    def get_current_version(self) -> str | None:
        """Get the timestamp of current config version"""
        config = self.load()
        if config:
            return config.get("updated_at")
        return None

    def rollback(self, version: str) -> bool:
        """
        Rollback to a previous config version.

        Args:
            version: ISO timestamp of version to restore

        Returns:
            True if rollback successful
        """
        old_config = self.get_version(version)
        if not old_config:
            logger.error(f"Version not found: {version}")
            return False

        # Save as new current config
        SharedState.write("config", old_config)

        logger.info(f"Rolled back to config version: {version}")
        return True

    def clear(self) -> None:
        """Clear all cached configs"""
        for version_file in self.cache_dir.glob("v_*.json"):
            version_file.unlink()

        SharedState.delete("config")
        logger.info("Config cache cleared")

    def _cleanup_old_versions(self) -> None:
        """Remove old version files beyond max_versions"""
        version_files = sorted(self.cache_dir.glob("v_*.json"), reverse=True)

        if len(version_files) > self.max_versions:
            for old_file in version_files[self.max_versions:]:
                old_file.unlink()
                logger.debug(f"Removed old config version: {old_file.name}")
