"""
Async Modbus Client

Wrapper around pymodbus for async Modbus TCP, RTU gateway, and RTU direct
serial communication.
"""

import asyncio
import math
import struct
from typing import Any
from dataclasses import dataclass

from pymodbus.client import AsyncModbusTcpClient, AsyncModbusSerialClient
from pymodbus.exceptions import ModbusException

from common.config import RegisterDataType
from common.exceptions import CommunicationError, WriteError
from common.logging_setup import get_service_logger

logger = get_service_logger("device.modbus")


@dataclass
class ReadResult:
    """Result of a register read operation"""
    success: bool
    value: float | int | None = None
    raw_registers: list[int] | None = None
    error: str | None = None


class ModbusClient:
    """
    Async Modbus TCP client with support for various data types.

    Handles:
    - Modbus TCP connections
    - RTU over TCP (gateway mode)
    - Various register data types (uint16, int16, uint32, int32, float32)
    - Big-endian and little-endian byte ordering
    """

    def __init__(
        self,
        host: str,
        port: int = 502,
        timeout: float = 3.0,
    ):
        self.host = host
        self.port = port
        self.timeout = timeout

        self._client: AsyncModbusTcpClient | None = None
        self._lock = asyncio.Lock()
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected and self._client is not None

    async def connect(self) -> bool:
        """Establish connection to Modbus device"""
        async with self._lock:
            if self._connected:
                return True

            try:
                self._client = AsyncModbusTcpClient(
                    host=self.host,
                    port=self.port,
                    timeout=self.timeout,
                )

                await self._client.connect()
                self._connected = self._client.connected

                if self._connected:
                    logger.debug(
                        f"Connected to Modbus device at {self.host}:{self.port}"
                    )
                else:
                    logger.warning(
                        f"Failed to connect to Modbus device at {self.host}:{self.port}"
                    )

                return self._connected

            except Exception as e:
                logger.error(f"Connection error to {self.host}:{self.port}: {e}")
                self._connected = False
                return False

    async def disconnect(self) -> None:
        """Close connection"""
        async with self._lock:
            if self._client:
                self._client.close()
                self._client = None
            self._connected = False
            logger.debug(f"Disconnected from {self.host}:{self.port}")

    async def read_holding_registers(
        self,
        address: int,
        count: int,
        slave_id: int = 1,
        datatype: RegisterDataType = RegisterDataType.UINT16,
        scale: float = 1.0,
    ) -> ReadResult:
        """
        Read holding registers with data type conversion.

        Args:
            address: Starting register address
            count: Number of registers to read
            slave_id: Modbus slave ID
            datatype: Data type for conversion
            scale: Scale factor to apply

        Returns:
            ReadResult with converted value
        """
        if not await self._ensure_connected():
            return ReadResult(
                success=False,
                error=f"Not connected to {self.host}:{self.port}",
            )

        try:
            response = await self._client.read_holding_registers(
                address=address,
                count=count,
                device_id=slave_id,
            )

            if response.isError():
                return ReadResult(
                    success=False,
                    error=f"Modbus error: {response}",
                )

            # Convert to value based on datatype
            value = self._convert_registers(response.registers, datatype)
            scaled_value = value * scale if value is not None and not isinstance(value, str) else value

            return ReadResult(
                success=True,
                value=scaled_value,
                raw_registers=list(response.registers),
            )

        except ModbusException as e:
            return ReadResult(success=False, error=f"Modbus exception: {e}")
        except asyncio.TimeoutError:
            return ReadResult(success=False, error="Read timeout")
        except Exception as e:
            return ReadResult(success=False, error=str(e))

    async def read_input_registers(
        self,
        address: int,
        count: int,
        slave_id: int = 1,
        datatype: RegisterDataType = RegisterDataType.UINT16,
        scale: float = 1.0,
    ) -> ReadResult:
        """Read input registers with data type conversion"""
        if not await self._ensure_connected():
            return ReadResult(
                success=False,
                error=f"Not connected to {self.host}:{self.port}",
            )

        try:
            response = await self._client.read_input_registers(
                address=address,
                count=count,
                device_id=slave_id,
            )

            if response.isError():
                return ReadResult(
                    success=False,
                    error=f"Modbus error: {response}",
                )

            value = self._convert_registers(response.registers, datatype)
            scaled_value = value * scale if value is not None and not isinstance(value, str) else value

            return ReadResult(
                success=True,
                value=scaled_value,
                raw_registers=list(response.registers),
            )

        except ModbusException as e:
            return ReadResult(success=False, error=f"Modbus exception: {e}")
        except asyncio.TimeoutError:
            return ReadResult(success=False, error="Read timeout")
        except Exception as e:
            return ReadResult(success=False, error=str(e))

    async def write_register(
        self,
        address: int,
        value: int,
        slave_id: int = 1,
    ) -> bool:
        """
        Write a single holding register.

        Args:
            address: Register address
            value: Value to write (16-bit integer)
            slave_id: Modbus slave ID

        Returns:
            True if write successful
        """
        if not await self._ensure_connected():
            raise CommunicationError(
                f"Not connected to {self.host}:{self.port}",
                host=self.host,
                port=self.port,
            )

        try:
            response = await self._client.write_register(
                address=address,
                value=value,
                device_id=slave_id,
            )

            if response.isError():
                raise WriteError(
                    f"Write failed: {response}",
                    register=address,
                    value=value,
                )

            logger.debug(
                f"Write successful: {self.host}:{self.port} slave={slave_id} "
                f"reg={address} value={value}"
            )
            return True

        except ModbusException as e:
            raise WriteError(
                f"Modbus exception: {e}",
                register=address,
                value=value,
            )

    async def write_multiple_registers(
        self,
        address: int,
        values: list[int],
        slave_id: int = 1,
    ) -> bool:
        """
        Write multiple holding registers.

        Args:
            address: Starting register address
            values: List of 16-bit integer values
            slave_id: Modbus slave ID

        Returns:
            True if write successful
        """
        if not await self._ensure_connected():
            raise CommunicationError(
                f"Not connected to {self.host}:{self.port}",
                host=self.host,
                port=self.port,
            )

        try:
            response = await self._client.write_registers(
                address=address,
                values=values,
                device_id=slave_id,
            )

            if response.isError():
                raise WriteError(
                    f"Write failed: {response}",
                    register=address,
                    value=values[0] if values else None,
                )

            return True

        except ModbusException as e:
            raise WriteError(
                f"Modbus exception: {e}",
                register=address,
                value=values[0] if values else None,
            )

    async def _ensure_connected(self) -> bool:
        """Ensure connection is established"""
        if not self._connected:
            return await self.connect()

        # Check if still connected
        if self._client and not self._client.connected:
            self._connected = False
            return await self.connect()

        return True

    def _convert_registers(
        self,
        registers: list[int],
        datatype: RegisterDataType,
    ) -> float | int | str | None:
        """Convert raw registers to typed value"""
        if not registers:
            return None

        try:
            if datatype == RegisterDataType.UINT16:
                return registers[0]

            elif datatype == RegisterDataType.INT16:
                value = registers[0]
                if value >= 0x8000:
                    value -= 0x10000
                return value

            elif datatype == RegisterDataType.UINT32:
                if len(registers) < 2:
                    return None
                # Big-endian: high word first
                return (registers[0] << 16) | registers[1]

            elif datatype == RegisterDataType.INT32:
                if len(registers) < 2:
                    return None
                value = (registers[0] << 16) | registers[1]
                if value >= 0x80000000:
                    value -= 0x100000000
                return value

            elif datatype == RegisterDataType.FLOAT32:
                if len(registers) < 2:
                    return None
                # Pack as big-endian unsigned shorts, unpack as float
                packed = struct.pack(">HH", registers[0], registers[1])
                value = struct.unpack(">f", packed)[0]
                if math.isnan(value) or math.isinf(value):
                    return None
                return value

            elif datatype == RegisterDataType.FLOAT64:
                if len(registers) < 4:
                    return None
                packed = struct.pack(
                    ">HHHH",
                    registers[0],
                    registers[1],
                    registers[2],
                    registers[3],
                )
                value = struct.unpack(">d", packed)[0]
                if math.isnan(value) or math.isinf(value):
                    return None
                return value

            elif datatype == RegisterDataType.UTF8:
                raw_bytes = b""
                for reg in registers:
                    raw_bytes += reg.to_bytes(2, byteorder="big")
                return raw_bytes.decode("utf-8", errors="replace").rstrip("\x00").strip()

            return registers[0]

        except (struct.error, IndexError) as e:
            logger.warning(f"Error converting registers: {e}")
            return None

    @staticmethod
    def get_register_count(datatype: RegisterDataType, size: int = 0) -> int:
        """Get number of registers for a data type. size overrides default if > 0."""
        if size > 0:
            return size
        counts = {
            RegisterDataType.UINT16: 1,
            RegisterDataType.INT16: 1,
            RegisterDataType.UINT32: 2,
            RegisterDataType.INT32: 2,
            RegisterDataType.FLOAT32: 2,
            RegisterDataType.FLOAT64: 4,
            RegisterDataType.UTF8: 20,
        }
        return counts.get(datatype, 1)


class ModbusSerialClient:
    """
    Async Modbus RTU serial client for direct RS485/RS232 connections.

    Used with Protocol.RTU_DIRECT on hardware with built-in serial ports
    (e.g., SOL532-E16 with 3x RS485 at /dev/ttyACM1-3 and 1x RS232 at /dev/ttyACM0).

    Multiple slaves can share one RS485 bus — access is serialized
    via an asyncio Lock managed by the ConnectionPool.
    """

    def __init__(
        self,
        port: str,
        baudrate: int = 9600,
        parity: str = "N",
        stopbits: int = 1,
        timeout: float = 3.0,
    ):
        self.port = port
        self.baudrate = baudrate
        self.parity = parity
        self.stopbits = stopbits
        self.timeout = timeout

        self._client: AsyncModbusSerialClient | None = None
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected and self._client is not None

    async def connect(self) -> bool:
        """Establish serial connection to Modbus device"""
        if self._connected:
            return True

        try:
            self._client = AsyncModbusSerialClient(
                port=self.port,
                baudrate=self.baudrate,
                parity=self.parity,
                stopbits=self.stopbits,
                timeout=self.timeout,
            )

            await self._client.connect()
            self._connected = self._client.connected

            if self._connected:
                logger.debug(
                    f"Connected to serial port {self.port} "
                    f"(baud={self.baudrate}, parity={self.parity}, stop={self.stopbits})"
                )
            else:
                logger.warning(
                    f"Failed to connect to serial port {self.port}"
                )

            return self._connected

        except Exception as e:
            logger.error(f"Serial connection error on {self.port}: {e}")
            self._connected = False
            return False

    async def disconnect(self) -> None:
        """Close serial connection"""
        if self._client:
            self._client.close()
            self._client = None
        self._connected = False
        logger.debug(f"Disconnected from serial port {self.port}")

    async def read_holding_registers(
        self,
        address: int,
        count: int,
        slave_id: int = 1,
        datatype: RegisterDataType = RegisterDataType.UINT16,
        scale: float = 1.0,
    ) -> ReadResult:
        """Read holding registers with data type conversion"""
        if not await self._ensure_connected():
            return ReadResult(
                success=False,
                error=f"Not connected to serial port {self.port}",
            )

        try:
            response = await self._client.read_holding_registers(
                address=address,
                count=count,
                device_id=slave_id,
            )

            if response.isError():
                return ReadResult(
                    success=False,
                    error=f"Modbus error: {response}",
                )

            value = self._convert_registers(response.registers, datatype)
            scaled_value = value * scale if value is not None and not isinstance(value, str) else value

            return ReadResult(
                success=True,
                value=scaled_value,
                raw_registers=list(response.registers),
            )

        except ModbusException as e:
            return ReadResult(success=False, error=f"Modbus exception: {e}")
        except asyncio.TimeoutError:
            return ReadResult(success=False, error="Read timeout")
        except Exception as e:
            return ReadResult(success=False, error=str(e))

    async def read_input_registers(
        self,
        address: int,
        count: int,
        slave_id: int = 1,
        datatype: RegisterDataType = RegisterDataType.UINT16,
        scale: float = 1.0,
    ) -> ReadResult:
        """Read input registers with data type conversion"""
        if not await self._ensure_connected():
            return ReadResult(
                success=False,
                error=f"Not connected to serial port {self.port}",
            )

        try:
            response = await self._client.read_input_registers(
                address=address,
                count=count,
                device_id=slave_id,
            )

            if response.isError():
                return ReadResult(
                    success=False,
                    error=f"Modbus error: {response}",
                )

            value = self._convert_registers(response.registers, datatype)
            scaled_value = value * scale if value is not None and not isinstance(value, str) else value

            return ReadResult(
                success=True,
                value=scaled_value,
                raw_registers=list(response.registers),
            )

        except ModbusException as e:
            return ReadResult(success=False, error=f"Modbus exception: {e}")
        except asyncio.TimeoutError:
            return ReadResult(success=False, error="Read timeout")
        except Exception as e:
            return ReadResult(success=False, error=str(e))

    async def write_register(
        self,
        address: int,
        value: int,
        slave_id: int = 1,
    ) -> bool:
        """Write a single holding register"""
        if not await self._ensure_connected():
            raise CommunicationError(
                f"Not connected to serial port {self.port}",
                host=self.port,
                port=0,
            )

        try:
            response = await self._client.write_register(
                address=address,
                value=value,
                device_id=slave_id,
            )

            if response.isError():
                raise WriteError(
                    f"Write failed: {response}",
                    register=address,
                    value=value,
                )

            logger.debug(
                f"Write successful: {self.port} slave={slave_id} "
                f"reg={address} value={value}"
            )
            return True

        except ModbusException as e:
            raise WriteError(
                f"Modbus exception: {e}",
                register=address,
                value=value,
            )

    async def write_multiple_registers(
        self,
        address: int,
        values: list[int],
        slave_id: int = 1,
    ) -> bool:
        """Write multiple holding registers"""
        if not await self._ensure_connected():
            raise CommunicationError(
                f"Not connected to serial port {self.port}",
                host=self.port,
                port=0,
            )

        try:
            response = await self._client.write_registers(
                address=address,
                values=values,
                device_id=slave_id,
            )

            if response.isError():
                raise WriteError(
                    f"Write failed: {response}",
                    register=address,
                    value=values[0] if values else None,
                )

            return True

        except ModbusException as e:
            raise WriteError(
                f"Modbus exception: {e}",
                register=address,
                value=values[0] if values else None,
            )

    async def _ensure_connected(self) -> bool:
        """Ensure serial connection is established"""
        if not self._connected:
            return await self.connect()

        # Check if still connected
        if self._client and not self._client.connected:
            self._connected = False
            return await self.connect()

        return True

    def _convert_registers(
        self,
        registers: list[int],
        datatype: RegisterDataType,
    ) -> float | int | str | None:
        """Convert raw registers to typed value (same logic as TCP client)"""
        if not registers:
            return None

        try:
            if datatype == RegisterDataType.UINT16:
                return registers[0]

            elif datatype == RegisterDataType.INT16:
                value = registers[0]
                if value >= 0x8000:
                    value -= 0x10000
                return value

            elif datatype == RegisterDataType.UINT32:
                if len(registers) < 2:
                    return None
                return (registers[0] << 16) | registers[1]

            elif datatype == RegisterDataType.INT32:
                if len(registers) < 2:
                    return None
                value = (registers[0] << 16) | registers[1]
                if value >= 0x80000000:
                    value -= 0x100000000
                return value

            elif datatype == RegisterDataType.FLOAT32:
                if len(registers) < 2:
                    return None
                packed = struct.pack(">HH", registers[0], registers[1])
                value = struct.unpack(">f", packed)[0]
                if math.isnan(value) or math.isinf(value):
                    return None
                return value

            elif datatype == RegisterDataType.FLOAT64:
                if len(registers) < 4:
                    return None
                packed = struct.pack(
                    ">HHHH",
                    registers[0],
                    registers[1],
                    registers[2],
                    registers[3],
                )
                value = struct.unpack(">d", packed)[0]
                if math.isnan(value) or math.isinf(value):
                    return None
                return value

            elif datatype == RegisterDataType.UTF8:
                raw_bytes = b""
                for reg in registers:
                    raw_bytes += reg.to_bytes(2, byteorder="big")
                return raw_bytes.decode("utf-8", errors="replace").rstrip("\x00").strip()

            return registers[0]

        except (struct.error, IndexError) as e:
            logger.warning(f"Error converting registers: {e}")
            return None

    @staticmethod
    def get_register_count(datatype: RegisterDataType, size: int = 0) -> int:
        """Get number of registers for a data type. size overrides default if > 0."""
        return ModbusClient.get_register_count(datatype, size)
