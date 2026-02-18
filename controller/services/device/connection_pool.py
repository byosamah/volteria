"""
Modbus Connection Pool

Manages Modbus connections efficiently by reusing connections
to the same host:port combination or serial port.
"""

import asyncio
from datetime import datetime, timezone
from dataclasses import dataclass, field

from common.logging_setup import get_service_logger
from .modbus_client import ModbusClient, ModbusSerialClient

logger = get_service_logger("device.pool")


@dataclass
class PooledConnection:
    """A pooled Modbus TCP connection"""
    client: ModbusClient
    last_used: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    use_count: int = 0


@dataclass
class PooledSerialConnection:
    """A pooled Modbus serial connection with bus mutex"""
    client: ModbusSerialClient
    lock: asyncio.Lock  # Per-port mutex for bus access serialization
    last_used: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    use_count: int = 0


class ConnectionPool:
    """
    Modbus connection pool.

    Manages connections efficiently by:
    - Reusing existing connections to same host:port (TCP)
    - Reusing serial connections to same port path (RTU Direct)
    - Per-serial-port mutex to serialize bus access (multiple slaves, one bus)
    - Automatic cleanup of idle connections
    - Thread-safe connection access
    """

    def __init__(
        self,
        max_idle_seconds: int = 300,
        connection_timeout: float = 3.0,
    ):
        self._connections: dict[str, PooledConnection] = {}
        self._serial_connections: dict[str, PooledSerialConnection] = {}
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

        # Close all TCP connections
        async with self._lock:
            for key, pooled in self._connections.items():
                await pooled.client.disconnect()
            self._connections.clear()

            # Close all serial connections
            for key, pooled in self._serial_connections.items():
                await pooled.client.disconnect()
            self._serial_connections.clear()

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
        """Force close a specific TCP connection"""
        key = f"{host}:{port}"

        async with self._lock:
            if key in self._connections:
                await self._connections[key].client.disconnect()
                del self._connections[key]
                logger.debug(f"Closed connection: {key}")

    async def get_serial_connection(
        self,
        port: str,
        baudrate: int = 9600,
        parity: str = "N",
        stopbits: int = 1,
    ) -> tuple[ModbusSerialClient, asyncio.Lock]:
        """
        Get or create a Modbus serial connection.

        Multiple slaves share one RS485 bus, so we key by (port, baudrate)
        and return a per-port Lock that callers must hold during communication.

        Args:
            port: Serial port path (e.g., "/dev/ttyACM1")
            baudrate: Baud rate (9600, 19200, 38400, 115200)
            parity: Parity check ("N", "E", "O")
            stopbits: Stop bits (1 or 2)

        Returns:
            Tuple of (ModbusSerialClient, asyncio.Lock for bus serialization)
        """
        key = f"{port}:{baudrate}"

        async with self._lock:
            if key in self._serial_connections:
                pooled = self._serial_connections[key]
                pooled.last_used = datetime.now(timezone.utc)
                pooled.use_count += 1
                return pooled.client, pooled.lock

            # Create new serial connection
            client = ModbusSerialClient(
                port=port,
                baudrate=baudrate,
                parity=parity,
                stopbits=stopbits,
                timeout=self._connection_timeout,
            )

            bus_lock = asyncio.Lock()

            self._serial_connections[key] = PooledSerialConnection(
                client=client,
                lock=bus_lock,
                use_count=1,
            )

            logger.debug(
                f"Created new serial connection: {key} "
                f"(parity={parity}, stopbits={stopbits})"
            )
            return client, bus_lock

    async def close_serial_connection(self, port: str, baudrate: int) -> None:
        """Force close a specific serial connection"""
        key = f"{port}:{baudrate}"

        async with self._lock:
            if key in self._serial_connections:
                await self._serial_connections[key].client.disconnect()
                del self._serial_connections[key]
                logger.debug(f"Closed serial connection: {key}")

    async def reconnect_serial(self, port: str, baudrate: int) -> None:
        """
        Force-close stale serial connection and evict from pool.

        Next call to get_serial_connection() creates a fresh connection.
        Called by RegisterReader when a serial device hits a connection error
        (e.g., FTDI USB adapter hiccup leaves stale file descriptor lock).
        """
        key = f"{port}:{baudrate}"

        async with self._lock:
            if key in self._serial_connections:
                pooled = self._serial_connections.pop(key)
                await pooled.client.disconnect()
                logger.info(f"Force-reconnected stale serial: {key}")

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
        to_remove_tcp = []
        to_remove_serial = []

        async with self._lock:
            # Check TCP connections
            for key, pooled in self._connections.items():
                idle_seconds = (now - pooled.last_used).total_seconds()
                if idle_seconds > self._max_idle_seconds:
                    to_remove_tcp.append(key)

            for key in to_remove_tcp:
                pooled = self._connections.pop(key)
                await pooled.client.disconnect()
                logger.debug(f"Closed idle TCP connection: {key}")

            # Check serial connections
            for key, pooled in self._serial_connections.items():
                idle_seconds = (now - pooled.last_used).total_seconds()
                if idle_seconds > self._max_idle_seconds:
                    to_remove_serial.append(key)

            for key in to_remove_serial:
                pooled = self._serial_connections.pop(key)
                await pooled.client.disconnect()
                logger.debug(f"Closed idle serial connection: {key}")

        total_removed = len(to_remove_tcp) + len(to_remove_serial)
        if total_removed:
            logger.info(f"Cleaned up {total_removed} idle connections")

    def get_stats(self) -> dict:
        """Get connection pool statistics"""
        return {
            "total_connections": len(self._connections) + len(self._serial_connections),
            "tcp_connections": {
                key: {
                    "use_count": pooled.use_count,
                    "connected": pooled.client.is_connected,
                    "last_used": pooled.last_used.isoformat(),
                }
                for key, pooled in self._connections.items()
            },
            "serial_connections": {
                key: {
                    "use_count": pooled.use_count,
                    "connected": pooled.client.is_connected,
                    "last_used": pooled.last_used.isoformat(),
                    "port": pooled.client.port,
                    "baudrate": pooled.client.baudrate,
                }
                for key, pooled in self._serial_connections.items()
            },
        }
