"""
Device Manager

Manages device discovery, status tracking, and reading aggregation.
"""

import asyncio
from datetime import datetime, timezone
from dataclasses import dataclass, field
from typing import Any

from common.config import DeviceConfig, DeviceType
from common.state import SharedState
from common.logging_setup import get_service_logger

logger = get_service_logger("device.manager")


@dataclass
class DeviceStatus:
    """Current status of a device"""
    device_id: str
    device_name: str
    device_type: DeviceType
    is_online: bool = False
    last_seen: datetime | None = None
    last_error: str | None = None
    consecutive_failures: int = 0
    readings: dict[str, Any] = field(default_factory=dict)


@dataclass
class AggregatedReading:
    """Aggregated reading with statistics"""
    last: float | None = None
    min: float | None = None
    max: float | None = None
    avg: float | None = None
    count: int = 0
    timestamp: datetime | None = None


class DeviceManager:
    """
    Manages device status and readings.

    Tracks:
    - Device online/offline status
    - Latest readings per register
    - Aggregated readings for logging
    """

    # Number of failures before marking device offline
    OFFLINE_THRESHOLD = 3

    def __init__(self):
        self._devices: dict[str, DeviceStatus] = {}
        self._reading_buffers: dict[str, list[float]] = {}
        self._lock = asyncio.Lock()

    def register_device(self, device: DeviceConfig) -> None:
        """Register a device for tracking"""
        self._devices[device.id] = DeviceStatus(
            device_id=device.id,
            device_name=device.name,
            device_type=device.device_type,
        )
        logger.debug(f"Registered device: {device.name} ({device.id})")

    def register_devices(self, devices: list[DeviceConfig]) -> None:
        """Register multiple devices"""
        for device in devices:
            self.register_device(device)

    async def update_reading(
        self,
        device_id: str,
        register_name: str,
        value: float | None,
        success: bool = True,
        error: str | None = None,
    ) -> None:
        """
        Update device reading.

        Args:
            device_id: Device ID
            register_name: Register name
            value: Reading value (None if failed)
            success: Whether read was successful
            error: Error message if failed
        """
        async with self._lock:
            if device_id not in self._devices:
                return

            status = self._devices[device_id]
            now = datetime.now(timezone.utc)

            if success and value is not None:
                # Update readings
                status.readings[register_name] = {
                    "value": value,
                    "timestamp": now.isoformat(),
                }

                # Add to buffer for aggregation
                buffer_key = f"{device_id}:{register_name}"
                if buffer_key not in self._reading_buffers:
                    self._reading_buffers[buffer_key] = []
                self._reading_buffers[buffer_key].append(value)

                # Update status
                status.is_online = True
                status.last_seen = now
                status.consecutive_failures = 0
                status.last_error = None

            else:
                # Handle failure
                status.consecutive_failures += 1
                status.last_error = error

                if status.consecutive_failures >= self.OFFLINE_THRESHOLD:
                    status.is_online = False

    async def update_status(
        self,
        device_id: str,
        success: bool,
        error: str | None = None,
    ) -> None:
        """Update device status without a specific reading"""
        async with self._lock:
            if device_id not in self._devices:
                return

            status = self._devices[device_id]

            if success:
                status.is_online = True
                status.last_seen = datetime.now(timezone.utc)
                status.consecutive_failures = 0
                status.last_error = None
            else:
                status.consecutive_failures += 1
                status.last_error = error

                if status.consecutive_failures >= self.OFFLINE_THRESHOLD:
                    status.is_online = False

    def get_status(self, device_id: str) -> DeviceStatus | None:
        """Get device status"""
        return self._devices.get(device_id)

    def get_all_status(self) -> dict[str, DeviceStatus]:
        """Get status of all devices"""
        return self._devices.copy()

    def get_online_devices(self, device_type: DeviceType | None = None) -> list[str]:
        """Get list of online device IDs"""
        devices = []
        for device_id, status in self._devices.items():
            if status.is_online:
                if device_type is None or status.device_type == device_type:
                    devices.append(device_id)
        return devices

    def get_offline_devices(self, device_type: DeviceType | None = None) -> list[str]:
        """Get list of offline device IDs"""
        devices = []
        for device_id, status in self._devices.items():
            if not status.is_online:
                if device_type is None or status.device_type == device_type:
                    devices.append(device_id)
        return devices

    def get_device_readings(self, device_id: str) -> dict[str, Any]:
        """Get latest readings for a device"""
        status = self._devices.get(device_id)
        if status:
            return status.readings.copy()
        return {}

    def get_all_readings(self) -> dict[str, dict[str, Any]]:
        """Get all device readings"""
        return {
            device_id: status.readings.copy()
            for device_id, status in self._devices.items()
        }

    async def get_aggregated_readings(self) -> dict[str, AggregatedReading]:
        """
        Get aggregated readings and clear buffers.

        Returns:
            Dict mapping buffer_key to AggregatedReading
        """
        async with self._lock:
            aggregated = {}

            for buffer_key, values in self._reading_buffers.items():
                if not values:
                    continue

                aggregated[buffer_key] = AggregatedReading(
                    last=values[-1],
                    min=min(values),
                    max=max(values),
                    avg=sum(values) / len(values),
                    count=len(values),
                    timestamp=datetime.now(timezone.utc),
                )

            # Clear buffers
            self._reading_buffers.clear()

            return aggregated

    def get_reading_value(
        self,
        device_id: str,
        register_name: str,
    ) -> float | None:
        """Get a specific reading value"""
        status = self._devices.get(device_id)
        if status and register_name in status.readings:
            return status.readings[register_name].get("value")
        return None

    def get_device_count(self, device_type: DeviceType | None = None) -> dict:
        """Get device count statistics"""
        total = 0
        online = 0

        for status in self._devices.values():
            if device_type is None or status.device_type == device_type:
                total += 1
                if status.is_online:
                    online += 1

        return {
            "total": total,
            "online": online,
            "offline": total - online,
        }

    async def update_shared_state(self) -> None:
        """Update shared state with device readings and status"""
        readings_data = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "devices": {},
            "status": {},
        }

        for device_id, status in self._devices.items():
            readings_data["devices"][device_id] = {
                "readings": status.readings,
            }
            readings_data["status"][device_id] = {
                "is_online": status.is_online,
                "last_seen": status.last_seen.isoformat() if status.last_seen else None,
                "last_error": status.last_error,
            }

        # Also add computed totals
        totals = await self._compute_totals()
        readings_data.update(totals)

        SharedState.write("readings", readings_data)

    async def _compute_totals(self) -> dict:
        """Compute total values (solar, load, DG)"""
        total_solar = 0.0
        total_load = 0.0
        total_dg = 0.0

        for status in self._devices.values():
            if not status.is_online:
                continue

            # Look for power readings
            power = status.readings.get("active_power_kw", {}).get("value")
            if power is None:
                power = status.readings.get("total_power_kw", {}).get("value")

            if power is not None:
                if status.device_type == DeviceType.INVERTER:
                    total_solar += power
                elif status.device_type == DeviceType.LOAD_METER:
                    total_load += power
                elif status.device_type == DeviceType.DG:
                    total_dg += power

        return {
            "total_solar_kw": total_solar,
            "total_load_kw": total_load,
            "total_dg_kw": total_dg,
        }
