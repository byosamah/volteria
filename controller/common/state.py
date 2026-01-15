"""
Shared State Management

File-based state sharing between services using JSON files with file locking.
Each service caches frequently-read state to avoid file I/O on every access.
"""

import json
import os
import time
from pathlib import Path
from typing import Any
from datetime import datetime, timezone
import threading

# State directory - will be created if it doesn't exist
STATE_DIR = Path(os.environ.get("VOLTERIA_STATE_DIR", "/opt/volteria/data/state"))

# Fallback for Windows development
if os.name == "nt":
    STATE_DIR = Path(__file__).parent.parent / "data" / "state"


class SharedState:
    """
    Simple file-based state sharing between services.

    Uses file locking on Unix systems for safe concurrent access.
    On Windows, uses a simple write-and-rename approach.
    """

    _cache: dict[str, tuple[dict, float]] = {}
    _cache_ttl: float = 0.1  # 100ms cache
    _lock = threading.Lock()

    @classmethod
    def _ensure_dir(cls) -> None:
        """Ensure state directory exists"""
        STATE_DIR.mkdir(parents=True, exist_ok=True)

    @classmethod
    def _get_path(cls, key: str) -> Path:
        """Get file path for state key"""
        return STATE_DIR / f"{key}.json"

    @classmethod
    def write(cls, key: str, data: dict) -> None:
        """
        Write state with file locking (Unix) or atomic rename (Windows).

        Args:
            key: State key (becomes filename without .json)
            data: Dictionary to serialize as JSON
        """
        import sys

        # DEBUG: Log entry
        pid = os.getpid()
        print(f"[DEBUG] SharedState.write START: key={key}, pid={pid}", file=sys.stderr, flush=True)

        cls._ensure_dir()
        path = cls._get_path(key)

        # DEBUG: Log path
        print(f"[DEBUG] SharedState.write: path={path}, exists={path.exists()}", file=sys.stderr, flush=True)
        if path.exists():
            stat = path.stat()
            print(f"[DEBUG] SharedState.write: BEFORE mtime={stat.st_mtime}, size={stat.st_size}", file=sys.stderr, flush=True)

        # Add metadata
        data_with_meta = {
            **data,
            "_updated_at": datetime.now(timezone.utc).isoformat(),
        }

        try:
            if os.name == "nt":
                # Windows: write to temp file, then rename (atomic on same filesystem)
                temp_path = path.with_suffix(".tmp")
                with open(temp_path, "w", encoding="utf-8") as f:
                    json.dump(data_with_meta, f, indent=2)
                temp_path.replace(path)
                print(f"[DEBUG] SharedState.write: Windows write complete", file=sys.stderr, flush=True)
            else:
                # Unix: use file locking
                import fcntl
                print(f"[DEBUG] SharedState.write: opening file for write...", file=sys.stderr, flush=True)
                with open(path, "w", encoding="utf-8") as f:
                    print(f"[DEBUG] SharedState.write: file opened, fd={f.fileno()}, acquiring lock...", file=sys.stderr, flush=True)
                    fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                    print(f"[DEBUG] SharedState.write: lock acquired, writing JSON...", file=sys.stderr, flush=True)
                    try:
                        json.dump(data_with_meta, f, indent=2)
                        f.flush()  # Ensure data is written
                        os.fsync(f.fileno())  # Force write to disk
                        print(f"[DEBUG] SharedState.write: JSON written and flushed", file=sys.stderr, flush=True)
                    finally:
                        fcntl.flock(f.fileno(), fcntl.LOCK_UN)
                        print(f"[DEBUG] SharedState.write: lock released", file=sys.stderr, flush=True)

            # DEBUG: Verify write
            if path.exists():
                stat = path.stat()
                print(f"[DEBUG] SharedState.write: AFTER mtime={stat.st_mtime}, size={stat.st_size}", file=sys.stderr, flush=True)
            else:
                print(f"[DEBUG] SharedState.write: ERROR - file does not exist after write!", file=sys.stderr, flush=True)

        except Exception as e:
            print(f"[DEBUG] SharedState.write: EXCEPTION: {e}", file=sys.stderr, flush=True)
            import traceback
            traceback.print_exc(file=sys.stderr)
            raise

        # Update cache
        with cls._lock:
            cls._cache[key] = (data_with_meta, time.time())

        print(f"[DEBUG] SharedState.write: COMPLETE for key={key}", file=sys.stderr, flush=True)

    @classmethod
    def read(cls, key: str, use_cache: bool = True) -> dict:
        """
        Read state from file with optional caching.

        Args:
            key: State key
            use_cache: Whether to use cached value if fresh enough

        Returns:
            Dictionary from JSON file, or empty dict if not found
        """
        # Check cache first
        if use_cache:
            with cls._lock:
                if key in cls._cache:
                    data, timestamp = cls._cache[key]
                    if time.time() - timestamp < cls._cache_ttl:
                        return data

        path = cls._get_path(key)
        if not path.exists():
            return {}

        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)

            # Update cache
            with cls._lock:
                cls._cache[key] = (data, time.time())

            return data
        except (json.JSONDecodeError, IOError):
            return {}

    @classmethod
    def read_fresh(cls, key: str) -> dict:
        """Read state bypassing cache"""
        return cls.read(key, use_cache=False)

    @classmethod
    def update(cls, key: str, updates: dict) -> dict:
        """
        Read, merge updates, and write state atomically.

        Args:
            key: State key
            updates: Dictionary of updates to merge

        Returns:
            Updated state dictionary
        """
        current = cls.read(key, use_cache=False)
        current.update(updates)
        cls.write(key, current)
        return current

    @classmethod
    def delete(cls, key: str) -> bool:
        """
        Delete state file.

        Args:
            key: State key

        Returns:
            True if deleted, False if not found
        """
        path = cls._get_path(key)

        with cls._lock:
            cls._cache.pop(key, None)

        if path.exists():
            path.unlink()
            return True
        return False

    @classmethod
    def list_keys(cls) -> list[str]:
        """List all state keys"""
        cls._ensure_dir()
        return [p.stem for p in STATE_DIR.glob("*.json")]

    @classmethod
    def get_age(cls, key: str) -> float | None:
        """
        Get age of state file in seconds.

        Returns:
            Age in seconds, or None if not found
        """
        path = cls._get_path(key)
        if not path.exists():
            return None
        return time.time() - path.stat().st_mtime


# Convenience functions for common state files
def get_config() -> dict:
    """Get current site configuration"""
    return SharedState.read("config")


def get_readings() -> dict:
    """Get latest device readings"""
    return SharedState.read("readings")


def get_control_state() -> dict:
    """Get current control state"""
    return SharedState.read("control_state")


def get_service_health() -> dict:
    """Get service health status"""
    return SharedState.read("service_health")


def get_pending_commands() -> dict:
    """Get pending commands from cloud"""
    return SharedState.read("commands")


def set_readings(readings: dict) -> None:
    """Update device readings"""
    SharedState.write("readings", readings)


def set_control_state(state: dict) -> None:
    """Update control state"""
    SharedState.write("control_state", state)


def set_service_health(service: str, status: dict) -> None:
    """Update health status for a service"""
    health = SharedState.read("service_health", use_cache=False)
    health[service] = {
        **status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    SharedState.write("service_health", health)


def is_config_changed() -> bool:
    """
    Check if config has changed since last acknowledgment.

    Config service sets 'config_changed' flag when new config is synced.
    Other services should call this to detect changes.

    Returns:
        True if config has changed
    """
    state = SharedState.read("config_status", use_cache=False)
    return state.get("config_changed", False)


def get_config_version() -> str | None:
    """
    Get current config version (updated_at timestamp).

    Returns:
        ISO timestamp of current config, or None if not set
    """
    state = SharedState.read("config_status")
    return state.get("version")


def acknowledge_config_change(service: str) -> None:
    """
    Acknowledge that a service has processed the config change.

    When all services have acknowledged, the config_changed flag is cleared.

    Args:
        service: Name of the service acknowledging the change
    """
    state = SharedState.read("config_status", use_cache=False)

    # Track acknowledgments
    acks = state.get("acknowledged_by", [])
    if service not in acks:
        acks.append(service)

    state["acknowledged_by"] = acks

    # All services that need to acknowledge
    required_services = {"device", "control", "logging"}

    # If all required services have acknowledged, clear the flag
    if required_services.issubset(set(acks)):
        state["config_changed"] = False
        state["acknowledged_by"] = []
        state["acknowledged_at"] = datetime.now(timezone.utc).isoformat()

    SharedState.write("config_status", state)


def notify_config_changed(version: str) -> None:
    """
    Notify that config has changed (called by config service).

    Args:
        version: New config version (updated_at timestamp)
    """
    SharedState.write("config_status", {
        "config_changed": True,
        "version": version,
        "changed_at": datetime.now(timezone.utc).isoformat(),
        "acknowledged_by": [],
    })
