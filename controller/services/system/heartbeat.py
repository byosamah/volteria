"""
Heartbeat Module

Sends heartbeat signals to the cloud every 30 seconds.
Heartbeat includes:
- System metrics (CPU, memory, disk, temp)
- Service status
- Config version
- Live readings (for dashboard)
"""

import asyncio
import os
from datetime import datetime, timezone
from typing import Any

import httpx

from common.state import SharedState, get_readings, get_service_health
from common.logging_setup import get_service_logger
from .metrics_collector import MetricsCollector

logger = get_service_logger("system.heartbeat")


class HeartbeatSender:
    """Sends heartbeat signals to cloud"""

    def __init__(
        self,
        controller_id: str,
        site_id: str | None,
        supabase_url: str,
        supabase_key: str,
        firmware_version: str = "2.0.0",
        interval_seconds: int = 30,
    ):
        self.controller_id = controller_id
        self.site_id = site_id
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        self.firmware_version = firmware_version
        self.interval_seconds = interval_seconds

        self.metrics_collector = MetricsCollector()
        self._running = False
        self._task: asyncio.Task | None = None

        # Retry policy
        self._retry_backoff = [1, 2, 4, 8, 16]
        self._consecutive_failures = 0
        self._max_consecutive_failures = 5

    async def start(self) -> None:
        """Start sending heartbeats"""
        self._running = True
        self._task = asyncio.create_task(self._heartbeat_loop())
        logger.info(f"Heartbeat sender started (interval: {self.interval_seconds}s)")

    async def stop(self) -> None:
        """Stop sending heartbeats"""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Heartbeat sender stopped")

    async def _heartbeat_loop(self) -> None:
        """Main heartbeat loop"""
        while self._running:
            try:
                await self._send_heartbeat()
                self._consecutive_failures = 0
            except Exception as e:
                self._consecutive_failures += 1
                logger.error(
                    f"Heartbeat failed ({self._consecutive_failures}): {e}",
                    extra={"consecutive_failures": self._consecutive_failures},
                )

                if self._consecutive_failures >= self._max_consecutive_failures:
                    logger.critical(
                        f"Heartbeat failed {self._consecutive_failures} consecutive times"
                    )

            await asyncio.sleep(self.interval_seconds)

    async def _send_heartbeat(self) -> None:
        """Send a single heartbeat"""
        payload = self._build_payload()

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.supabase_url}/rest/v1/controller_heartbeats",
                json=payload,
                headers={
                    "apikey": self.supabase_key,
                    "Authorization": f"Bearer {self.supabase_key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                timeout=10.0,
            )
            response.raise_for_status()

        logger.debug(
            "Heartbeat sent",
            extra={
                "controller_id": self.controller_id,
                "uptime": payload.get("uptime_seconds"),
            },
        )

    def _build_payload(self) -> dict[str, Any]:
        """Build heartbeat payload"""
        metrics = self.metrics_collector.collect()
        service_health = get_service_health()
        config = SharedState.read("config")
        readings = get_readings()

        # Build services status
        services_status = {}
        for service_name, health_data in service_health.items():
            if service_name.startswith("_"):
                continue
            status = health_data.get("status", "unknown")
            services_status[service_name] = status

        # Build live readings for dashboard
        live_readings = self._extract_live_readings(readings)

        payload = {
            "controller_id": self.controller_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "firmware_version": self.firmware_version,
            "config_version": config.get("updated_at"),
            "uptime_seconds": metrics.uptime_seconds,
            "cpu_usage_pct": metrics.cpu_usage_pct,
            "memory_usage_pct": metrics.memory_usage_pct,
            "disk_usage_pct": metrics.disk_usage_pct,
            "cpu_temp_celsius": metrics.cpu_temp_celsius,
            "services": services_status,
            "active_alarms_count": self._get_active_alarms_count(),
            "last_control_loop_ms": self._get_last_control_loop_time(),
            "live_readings": live_readings,
        }

        # Add site_id if assigned
        if self.site_id:
            payload["site_id"] = self.site_id

        # Add pending OTA info if any
        ota_status = SharedState.read("ota_status")
        if ota_status:
            payload["pending_ota"] = {
                "version": ota_status.get("version"),
                "status": ota_status.get("status"),
            }

        return payload

    def _extract_live_readings(self, readings: dict) -> dict[str, Any]:
        """Extract key readings for live dashboard display"""
        if not readings:
            return {}

        # Get calculated totals
        return {
            "total_load_kw": readings.get("total_load_kw"),
            "solar_output_kw": readings.get("total_solar_kw"),
            "dg_power_kw": readings.get("total_dg_kw"),
            "solar_limit_pct": readings.get("solar_limit_pct"),
        }

    def _get_active_alarms_count(self) -> int:
        """Get count of active alarms"""
        alarms = SharedState.read("active_alarms")
        return len(alarms.get("alarms", []))

    def _get_last_control_loop_time(self) -> float | None:
        """Get last control loop execution time in ms"""
        control_state = SharedState.read("control_state")
        return control_state.get("execution_time_ms")

    async def send_immediate(self, status: str = "online") -> None:
        """Send an immediate heartbeat (e.g., before reboot)"""
        try:
            await self._send_heartbeat()
            logger.info(f"Immediate heartbeat sent with status: {status}")
        except Exception as e:
            logger.error(f"Failed to send immediate heartbeat: {e}")
