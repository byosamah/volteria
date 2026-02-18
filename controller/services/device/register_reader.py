"""
Register Reader

Handles reading registers from devices with retry logic
and per-register polling intervals.
"""

import asyncio
from datetime import datetime, timezone
from dataclasses import dataclass, field
from typing import Any, Union

from common.config import DeviceConfig, ModbusRegister, Protocol, RegisterDataType
from common.logging_setup import get_service_logger, log_device_read
from common.state import set_register_errors, clear_register_errors
from .modbus_client import ModbusClient, ModbusSerialClient
from .connection_pool import ConnectionPool
from .device_manager import DeviceManager

logger = get_service_logger("device.reader")


@dataclass
class RegisterPollState:
    """Polling state for a register"""
    last_polled: datetime | None = None
    poll_interval_ms: int = 1000
    consecutive_failures: int = 0
    last_error: str = ""


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
    FAILURE_ALARM_THRESHOLD = 20  # Consecutive failures before alarm (~20s for 1s registers)

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

        For RTU_DIRECT protocol, acquires the per-port bus lock to serialize
        access (multiple slaves share one RS485 bus).

        Args:
            device: Device configuration

        Returns:
            Dict mapping register name to value
        """
        # Skip if device is in backoff period (reduces CPU when device unreachable)
        if not self._manager.should_poll(device.id):
            return {}

        now = datetime.now(timezone.utc)
        results = {}

        # Get client based on protocol
        bus_lock: asyncio.Lock | None = None

        if device.protocol == Protocol.RTU_DIRECT:
            client, bus_lock = await self._pool.get_serial_connection(
                port=device.serial_port,
                baudrate=device.baudrate,
                parity=device.parity,
                stopbits=device.stopbits,
            )
        else:
            client = await self._pool.get_connection(device.host, device.port)

        # Poll each register that is due
        connection_failed = False
        failed_count = 0

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

            # If connection already failed for this device, skip remaining registers
            # to avoid flooding logs with per-register errors
            if connection_failed:
                state.last_polled = now
                state.consecutive_failures += 1
                state.last_error = "Device not reachable (cascade)"
                failed_count += 1
                continue

            # Read register with retry — hold bus lock for serial
            if bus_lock:
                async with bus_lock:
                    value, is_conn_error, error_msg = await self._read_register_with_retry(
                        client=client,
                        device=device,
                        register=register,
                    )
            else:
                value, is_conn_error, error_msg = await self._read_register_with_retry(
                    client=client,
                    device=device,
                    register=register,
                )

            # Update state
            state.last_polled = now

            if value is not None:
                results[register.name] = value
                state.consecutive_failures = 0
                state.last_error = ""

                # Update device manager
                await self._manager.update_reading(
                    device_id=device.id,
                    register_name=register.name,
                    value=value,
                    success=True,
                )

                log_device_read(
                    logger.logger,
                    device.name,
                    register.name,
                    value,
                    success=True,
                )
            else:
                state.consecutive_failures += 1
                state.last_error = error_msg
                failed_count += 1

                await self._manager.update_reading(
                    device_id=device.id,
                    register_name=register.name,
                    value=None,
                    success=False,
                    error=f"Failed after {self.MAX_RETRIES} retries",
                )

                log_device_read(
                    logger.logger,
                    device.name,
                    register.name,
                    None,
                    success=False,
                )

                # Only cascade on connection errors (device unreachable).
                # Register-specific errors (ExceptionResponse) skip just
                # that register — other registers may still be readable.
                if is_conn_error:
                    connection_failed = True

        # Log summary for skipped registers and update device status once
        if connection_failed and failed_count > 1:
            logger.warning(
                f"Device {device.name} not reachable — "
                f"skipped {failed_count - 1} remaining registers"
            )
            # Single status update for the device (avoids per-register backoff escalation)
            await self._manager.update_status(
                device_id=device.id,
                success=False,
                error="Device not reachable",
            )
            # Evict stale serial connection so next poll gets a fresh one.
            # Serial ports use exclusive locks — stale locks never self-heal.
            if device.protocol == Protocol.RTU_DIRECT:
                await self._pool.reconnect_serial(device.serial_port, device.baudrate)
        elif failed_count > 0 and not connection_failed:
            logger.info(
                f"Device {device.name}: {failed_count} register(s) failed "
                f"(register-specific errors, device still reachable)"
            )

        # Report persistent register failures to SharedState for alarm creation
        persistent_failures = []
        for register in device.registers:
            key = f"{device.id}:{register.name}"
            reg_state = self._poll_states.get(key)
            if reg_state and reg_state.consecutive_failures >= self.FAILURE_ALARM_THRESHOLD:
                persistent_failures.append({
                    "name": register.name,
                    "failures": reg_state.consecutive_failures,
                    "last_error": reg_state.last_error,
                })

        if persistent_failures:
            set_register_errors(device.id, device.name, persistent_failures)
        else:
            clear_register_errors(device.id)

        return results

    async def _read_register_with_retry(
        self,
        client: Union[ModbusClient, ModbusSerialClient],
        device: DeviceConfig,
        register: ModbusRegister,
    ) -> tuple[float | str | None, bool, str]:
        """Read a register with retry logic.

        Returns:
            Tuple of (value, is_connection_error, error_message):
            - (value, False, "") on success
            - (None, False, error) on register-specific error (device responded but register invalid)
            - (None, True, error) on connection error (device unreachable)
        """
        last_error = ""
        for attempt in range(self.MAX_RETRIES + 1):
            try:
                # Determine register count based on datatype (size overrides for UTF8 etc.)
                count = ModbusClient.get_register_count(register.datatype, register.size)

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
                    return None, False, f"Unsupported type: {register.type}"

                if result.success:
                    return result.value, False, ""

                last_error = result.error or ""

                # Register-specific errors (device is reachable, but register is invalid):
                # - ExceptionResponse: device responded with Modbus exception
                #   (e.g., Illegal Data Address, Illegal Function)
                # - "address" validation: pymodbus address range check failed
                #   (e.g., "0 < address -1 < 65535 !")
                is_register_error = (
                    "ExceptionResponse" in last_error
                    or "address" in last_error.lower()
                )
                if is_register_error:
                    logger.warning(
                        f"Read failed for {device.name}.{register.name}: {last_error}"
                    )
                    return None, False, last_error

                # Other errors (timeout, connection) — retry
                if attempt < self.MAX_RETRIES:
                    logger.debug(
                        f"Read failed for {device.name}.{register.name}: {last_error}, "
                        f"retrying ({attempt + 1}/{self.MAX_RETRIES})"
                    )
                    await asyncio.sleep(self.RETRY_DELAY_MS / 1000)
                else:
                    logger.warning(
                        f"Read failed for {device.name}.{register.name}: {last_error}"
                    )

            except Exception as e:
                last_error = str(e)
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

        return None, True, last_error

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

        if device.protocol == Protocol.RTU_DIRECT:
            client, bus_lock = await self._pool.get_serial_connection(
                port=device.serial_port,
                baudrate=device.baudrate,
                parity=device.parity,
                stopbits=device.stopbits,
            )
            async with bus_lock:
                value, _, _ = await self._read_register_with_retry(client, device, register)
                return value
        else:
            client = await self._pool.get_connection(device.host, device.port)
            value, _, _ = await self._read_register_with_retry(client, device, register)
            return value
