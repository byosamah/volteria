"""
Register Reader

Handles reading registers from devices with retry logic
and per-register polling intervals.
"""

import asyncio
from datetime import datetime, timezone
from dataclasses import dataclass, field
from typing import Any

from common.config import DeviceConfig, ModbusRegister, RegisterDataType
from common.logging_setup import get_service_logger, log_device_read
from .modbus_client import ModbusClient
from .connection_pool import ConnectionPool
from .device_manager import DeviceManager

logger = get_service_logger("device.reader")


@dataclass
class RegisterPollState:
    """Polling state for a register"""
    last_polled: datetime | None = None
    poll_interval_ms: int = 1000
    consecutive_failures: int = 0


class RegisterReader:
    """
    Reads registers from devices at configured intervals.

    Features:
    - Per-register polling intervals
    - Automatic retry with backoff
    - Optimized batch reading where possible
    """

    MAX_RETRIES = 2
    RETRY_DELAY_MS = 500

    def __init__(
        self,
        connection_pool: ConnectionPool,
        device_manager: DeviceManager,
    ):
        self._pool = connection_pool
        self._manager = device_manager
        self._poll_states: dict[str, RegisterPollState] = {}
        self._running = False

    async def start_polling(self, devices: list[DeviceConfig]) -> None:
        """Initialize polling for devices"""
        self._running = True

        # Clear old poll states to ensure renamed registers get new keys
        # This is critical when config reloads with renamed registers
        self._poll_states.clear()

        # Initialize poll states for all registers
        for device in devices:
            for register in device.registers:
                key = f"{device.id}:{register.name}"
                self._poll_states[key] = RegisterPollState(
                    poll_interval_ms=register.poll_interval_ms,
                )

        logger.info(f"Initialized polling for {len(self._poll_states)} registers")

    def stop_polling(self) -> None:
        """Stop polling"""
        self._running = False

    async def poll_device(self, device: DeviceConfig) -> dict[str, Any]:
        """
        Poll all due registers from a device.

        Args:
            device: Device configuration

        Returns:
            Dict mapping register name to value
        """
        now = datetime.now(timezone.utc)
        results = {}

        # Get client for this device
        client = await self._pool.get_connection(device.host, device.port)

        # Poll each register that is due
        for register in device.registers:
            key = f"{device.id}:{register.name}"
            state = self._poll_states.get(key)

            if not state:
                continue

            # Check if due for polling
            if state.last_polled is not None:
                elapsed_ms = (now - state.last_polled).total_seconds() * 1000
                if elapsed_ms < state.poll_interval_ms:
                    continue

            # Read register with retry
            value = await self._read_register_with_retry(
                client=client,
                device=device,
                register=register,
            )

            # Update state
            state.last_polled = now

            if value is not None:
                results[register.name] = value
                state.consecutive_failures = 0

                # Update device manager
                await self._manager.update_reading(
                    device_id=device.id,
                    register_name=register.name,
                    value=value,
                    success=True,
                )

                log_device_read(
                    logger._logger,
                    device.name,
                    register.name,
                    value,
                    success=True,
                )
            else:
                state.consecutive_failures += 1

                await self._manager.update_reading(
                    device_id=device.id,
                    register_name=register.name,
                    value=None,
                    success=False,
                    error=f"Failed after {self.MAX_RETRIES} retries",
                )

                log_device_read(
                    logger._logger,
                    device.name,
                    register.name,
                    None,
                    success=False,
                )

        return results

    async def _read_register_with_retry(
        self,
        client: ModbusClient,
        device: DeviceConfig,
        register: ModbusRegister,
    ) -> float | None:
        """Read a register with retry logic"""
        for attempt in range(self.MAX_RETRIES + 1):
            try:
                # Determine register count based on datatype
                count = ModbusClient.get_register_count(register.datatype)

                # Read based on register type
                if register.type == "holding":
                    result = await client.read_holding_registers(
                        address=register.address,
                        count=count,
                        slave_id=device.slave_id,
                        datatype=register.datatype,
                        scale=register.scale,
                    )
                elif register.type == "input":
                    result = await client.read_input_registers(
                        address=register.address,
                        count=count,
                        slave_id=device.slave_id,
                        datatype=register.datatype,
                        scale=register.scale,
                    )
                else:
                    logger.warning(f"Unsupported register type: {register.type}")
                    return None

                if result.success:
                    return result.value

                # Log error and retry
                if attempt < self.MAX_RETRIES:
                    logger.debug(
                        f"Read failed for {device.name}.{register.name}: {result.error}, "
                        f"retrying ({attempt + 1}/{self.MAX_RETRIES})"
                    )
                    await asyncio.sleep(self.RETRY_DELAY_MS / 1000)
                else:
                    logger.warning(
                        f"Read failed for {device.name}.{register.name}: {result.error}"
                    )

            except Exception as e:
                if attempt < self.MAX_RETRIES:
                    logger.debug(
                        f"Exception reading {device.name}.{register.name}: {e}, "
                        f"retrying ({attempt + 1}/{self.MAX_RETRIES})"
                    )
                    await asyncio.sleep(self.RETRY_DELAY_MS / 1000)
                else:
                    logger.warning(
                        f"Exception reading {device.name}.{register.name}: {e}"
                    )

        return None

    async def read_single_register(
        self,
        device: DeviceConfig,
        register_name: str,
    ) -> float | None:
        """Read a single register by name"""
        # Find register config
        register = next(
            (r for r in device.registers if r.name == register_name),
            None,
        )

        if not register:
            logger.warning(f"Register not found: {device.name}.{register_name}")
            return None

        client = await self._pool.get_connection(device.host, device.port)
        return await self._read_register_with_retry(client, device, register)
