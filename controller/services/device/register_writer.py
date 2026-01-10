"""
Register Writer

Handles writing registers with verification (read-back).
"""

import asyncio
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Any

from common.config import DeviceConfig
from common.exceptions import WriteError, CommandNotTakenError
from common.logging_setup import get_service_logger, log_device_write
from .modbus_client import ModbusClient
from .connection_pool import ConnectionPool

logger = get_service_logger("device.writer")


@dataclass
class WriteResult:
    """Result of a write operation"""
    success: bool
    verified: bool = False
    written_value: int | None = None
    read_back_value: int | None = None
    error: str | None = None


class RegisterWriter:
    """
    Writes registers with optional verification.

    Features:
    - Write with read-back verification
    - Configurable tolerance for verification
    - Retry logic for failed writes
    """

    VERIFY_DELAY_MS = 200  # Delay before read-back
    VERIFY_TOLERANCE_PCT = 1.0  # 1% tolerance for verification
    MAX_RETRIES = 3

    def __init__(self, connection_pool: ConnectionPool):
        self._pool = connection_pool

    async def write_register(
        self,
        device: DeviceConfig,
        register_address: int,
        value: int,
        verify: bool = True,
    ) -> WriteResult:
        """
        Write a register with optional verification.

        Args:
            device: Device configuration
            register_address: Register address to write
            value: Value to write
            verify: Whether to verify with read-back

        Returns:
            WriteResult with outcome details
        """
        client = await self._pool.get_connection(device.host, device.port)

        for attempt in range(self.MAX_RETRIES):
            try:
                # Write register
                success = await client.write_register(
                    address=register_address,
                    value=value,
                    slave_id=device.slave_id,
                )

                if not success:
                    continue

                # Verify if requested
                if verify:
                    await asyncio.sleep(self.VERIFY_DELAY_MS / 1000)

                    result = await client.read_holding_registers(
                        address=register_address,
                        count=1,
                        slave_id=device.slave_id,
                    )

                    if result.success and result.value is not None:
                        read_back = int(result.value)

                        # Check with tolerance
                        if self._values_match(value, read_back):
                            log_device_write(
                                logger._logger,
                                device.name,
                                str(register_address),
                                value,
                                success=True,
                            )

                            return WriteResult(
                                success=True,
                                verified=True,
                                written_value=value,
                                read_back_value=read_back,
                            )
                        else:
                            # Verification failed
                            logger.warning(
                                f"Write verification failed for {device.name} "
                                f"reg={register_address}: wrote {value}, read {read_back}"
                            )

                            return WriteResult(
                                success=False,
                                verified=False,
                                written_value=value,
                                read_back_value=read_back,
                                error=f"Command not taken: expected {value}, got {read_back}",
                            )

                # Write without verification succeeded
                log_device_write(
                    logger._logger,
                    device.name,
                    str(register_address),
                    value,
                    success=True,
                )

                return WriteResult(
                    success=True,
                    verified=False,
                    written_value=value,
                )

            except WriteError as e:
                if attempt < self.MAX_RETRIES - 1:
                    logger.debug(
                        f"Write failed, retrying ({attempt + 1}/{self.MAX_RETRIES}): {e}"
                    )
                    await asyncio.sleep(0.5)
                else:
                    log_device_write(
                        logger._logger,
                        device.name,
                        str(register_address),
                        value,
                        success=False,
                    )

                    return WriteResult(
                        success=False,
                        error=str(e),
                    )

            except Exception as e:
                log_device_write(
                    logger._logger,
                    device.name,
                    str(register_address),
                    value,
                    success=False,
                )

                return WriteResult(
                    success=False,
                    error=str(e),
                )

        return WriteResult(
            success=False,
            error=f"Failed after {self.MAX_RETRIES} attempts",
        )

    async def write_solar_limit(
        self,
        device: DeviceConfig,
        limit_pct: float,
        enable_register: int = 5007,
        limit_register: int = 5008,
        enable_value: int = 0xAA,
    ) -> WriteResult:
        """
        Write solar power limit to inverter.

        This is the specific sequence for Sungrow inverters:
        1. Write enable value to control register
        2. Write limit percentage to limit register
        3. Verify limit was applied

        Args:
            device: Inverter device config
            limit_pct: Power limit percentage (0-100)
            enable_register: Register to enable power limiting
            limit_register: Register for limit percentage
            enable_value: Value to write to enable (0xAA for Sungrow)

        Returns:
            WriteResult with outcome
        """
        client = await self._pool.get_connection(device.host, device.port)

        # Clamp limit to valid range
        limit_pct = max(0, min(100, limit_pct))
        limit_value = int(limit_pct * 10)  # Sungrow uses 0.1% resolution

        try:
            # Step 1: Enable power limiting
            enable_success = await client.write_register(
                address=enable_register,
                value=enable_value,
                slave_id=device.slave_id,
            )

            if not enable_success:
                return WriteResult(
                    success=False,
                    error="Failed to enable power limiting",
                )

            # Small delay
            await asyncio.sleep(0.1)

            # Step 2: Write limit percentage
            limit_success = await client.write_register(
                address=limit_register,
                value=limit_value,
                slave_id=device.slave_id,
            )

            if not limit_success:
                return WriteResult(
                    success=False,
                    error="Failed to write power limit",
                )

            # Step 3: Verify
            await asyncio.sleep(self.VERIFY_DELAY_MS / 1000)

            result = await client.read_holding_registers(
                address=limit_register,
                count=1,
                slave_id=device.slave_id,
            )

            if result.success and result.value is not None:
                read_back = int(result.value)

                if self._values_match(limit_value, read_back):
                    logger.info(
                        f"Solar limit set to {limit_pct:.1f}% on {device.name}",
                        extra={
                            "device": device.name,
                            "limit_pct": limit_pct,
                        },
                    )

                    return WriteResult(
                        success=True,
                        verified=True,
                        written_value=limit_value,
                        read_back_value=read_back,
                    )
                else:
                    raise CommandNotTakenError(
                        device_id=device.id,
                        device_name=device.name,
                        register=limit_register,
                        expected_value=limit_value,
                        actual_value=read_back,
                    )

            return WriteResult(
                success=True,
                verified=False,
                written_value=limit_value,
            )

        except CommandNotTakenError:
            raise
        except Exception as e:
            logger.error(
                f"Error writing solar limit to {device.name}: {e}",
                extra={"device": device.name, "error": str(e)},
            )

            return WriteResult(
                success=False,
                error=str(e),
            )

    def _values_match(self, expected: int, actual: int) -> bool:
        """Check if values match within tolerance"""
        if expected == 0:
            return actual == 0

        diff_pct = abs(expected - actual) / expected * 100
        return diff_pct <= self.VERIFY_TOLERANCE_PCT
