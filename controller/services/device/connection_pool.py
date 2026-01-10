"""
Modbus Connection Pool

Manages Modbus connections efficiently by reusing connections
to the same host:port combination.
"""

import asyncio
from datetime import datetime, timezone
from dataclasses import dataclass, field

from common.logging_setup import get_service_logger
from .modbus_client import ModbusClient

logger = get_service_logger("device.pool")


@dataclass
class PooledConnection:
    """A pooled Modbus connection"""
    client: ModbusClient
    last_used: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    use_count: int = 0


class ConnectionPool:
    """
    Modbus connection pool.

    Manages connections efficiently by:
    - Reusing existing connections to same host:port
    - Automatic cleanup of idle connections
    - Thread-safe connection access
    """

    def __init__(
        self,
        max_idle_seconds: int = 300,
        connection_timeout: float = 3.0,
    ):
        self._connections: dict[str, PooledConnection] = {}
        self._lock = asyncio.Lock()
        self._max_idle_seconds = max_idle_seconds
        self._connection_timeout = connection_timeout
        self._cleanup_task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        """Start the connection pool"""
        self._running = True
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        logger.info("Connection pool started")

    async def stop(self) -> None:
        """Stop the connection pool and close all connections"""
        self._running = False

        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

        # Close all connections
        async with self._lock:
            for key, pooled in self._connections.items():
                await pooled.client.disconnect()
            self._connections.clear()

        logger.info("Connection pool stopped")

    async def get_connection(self, host: str, port: int) -> ModbusClient:
        """
        Get or create a Modbus connection.

        Args:
            host: Target host
            port: Target port

        Returns:
            ModbusClient instance (connected or will auto-connect)
        """
        key = f"{host}:{port}"

        async with self._lock:
            if key in self._connections:
                pooled = self._connections[key]
                pooled.last_used = datetime.now(timezone.utc)
                pooled.use_count += 1
                return pooled.client

            # Create new connection
            client = ModbusClient(
                host=host,
                port=port,
                timeout=self._connection_timeout,
            )

            self._connections[key] = PooledConnection(
                client=client,
                use_count=1,
            )

            logger.debug(f"Created new connection: {key}")
            return client

    async def release_connection(self, host: str, port: int) -> None:
        """
        Mark connection as available (no-op for this simple pool).

        The pool reuses connections without explicit release.
        """
        pass

    async def close_connection(self, host: str, port: int) -> None:
        """Force close a specific connection"""
        key = f"{host}:{port}"

        async with self._lock:
            if key in self._connections:
                await self._connections[key].client.disconnect()
                del self._connections[key]
                logger.debug(f"Closed connection: {key}")

    async def _cleanup_loop(self) -> None:
        """Periodic cleanup of idle connections"""
        while self._running:
            await asyncio.sleep(60)  # Check every minute

            try:
                await self._cleanup_idle_connections()
            except Exception as e:
                logger.warning(f"Error in cleanup loop: {e}")

    async def _cleanup_idle_connections(self) -> None:
        """Close connections that have been idle too long"""
        now = datetime.now(timezone.utc)
        to_remove = []

        async with self._lock:
            for key, pooled in self._connections.items():
                idle_seconds = (now - pooled.last_used).total_seconds()

                if idle_seconds > self._max_idle_seconds:
                    to_remove.append(key)

            for key in to_remove:
                pooled = self._connections.pop(key)
                await pooled.client.disconnect()
                logger.debug(f"Closed idle connection: {key}")

        if to_remove:
            logger.info(f"Cleaned up {len(to_remove)} idle connections")

    def get_stats(self) -> dict:
        """Get connection pool statistics"""
        return {
            "total_connections": len(self._connections),
            "connections": {
                key: {
                    "use_count": pooled.use_count,
                    "connected": pooled.client.is_connected,
                    "last_used": pooled.last_used.isoformat(),
                }
                for key, pooled in self._connections.items()
            },
        }
