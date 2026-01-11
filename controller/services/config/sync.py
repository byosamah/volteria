"""
Configuration Sync

Fetches complete site configuration from cloud.
Syncs every 5 minutes or on demand.
"""

import asyncio
from datetime import datetime, timezone
from typing import Any

import httpx

from common.logging_setup import get_service_logger

logger = get_service_logger("config.sync")


class ConfigSync:
    """
    Syncs configuration from Supabase.

    Pulls:
    - Site settings (DG reserve, control interval, safe mode)
    - All devices with complete register definitions
    - Calculated field definitions
    - Alarm definitions with site-specific overrides
    """

    def __init__(
        self,
        site_id: str,
        supabase_url: str,
        supabase_key: str,
    ):
        self.site_id = site_id
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key

    async def fetch_site_config(self) -> dict[str, Any] | None:
        """
        Fetch complete site configuration from cloud.

        Returns:
            Complete site config dict, or None on error
        """
        try:
            async with httpx.AsyncClient() as client:
                # 1. Fetch site settings
                site = await self._fetch_site(client)
                if not site:
                    return None

                # 2. Fetch devices with registers
                devices = await self._fetch_devices(client)

                # 3. Fetch calculated field definitions
                calculated_fields = await self._fetch_calculated_fields(client)

                # 4. Fetch alarm overrides for this site
                alarm_overrides = await self._fetch_alarm_overrides(client)

                # 5. Build complete config
                config = self._build_config(
                    site=site,
                    devices=devices,
                    calculated_fields=calculated_fields,
                    alarm_overrides=alarm_overrides,
                )

                logger.info(
                    f"Config synced: {len(devices)} devices, "
                    f"{len(calculated_fields)} calculated fields",
                    extra={
                        "site_id": self.site_id,
                        "device_count": len(devices),
                        "calc_field_count": len(calculated_fields),
                    },
                )

                return config

        except httpx.HTTPError as e:
            logger.error(f"HTTP error syncing config: {e}")
            return None
        except Exception as e:
            logger.error(f"Error syncing config: {e}")
            return None

    async def check_for_updates(self, current_updated_at: str | None) -> bool:
        """
        Check if site config has been updated since last sync.

        Args:
            current_updated_at: ISO timestamp of current config

        Returns:
            True if updates are available
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.supabase_url}/rest/v1/sites",
                    params={
                        "id": f"eq.{self.site_id}",
                        "select": "updated_at",
                    },
                    headers=self._headers(),
                    timeout=10.0,
                )
                response.raise_for_status()
                data = response.json()

                if not data:
                    return False

                cloud_updated_at = data[0].get("updated_at")

                if not current_updated_at:
                    return True

                return cloud_updated_at != current_updated_at

        except Exception as e:
            logger.warning(f"Error checking for updates: {e}")
            return False

    async def _fetch_site(self, client: httpx.AsyncClient) -> dict | None:
        """Fetch site settings"""
        response = await client.get(
            f"{self.supabase_url}/rest/v1/sites",
            params={
                "id": f"eq.{self.site_id}",
                "select": "*,projects(id,name,timezone)",
            },
            headers=self._headers(),
            timeout=30.0,
        )
        response.raise_for_status()
        data = response.json()

        if not data:
            logger.error(f"Site not found: {self.site_id}")
            return None

        return data[0]

    async def _fetch_devices(self, client: httpx.AsyncClient) -> list[dict]:
        """Fetch all devices assigned to site with registers"""
        response = await client.get(
            f"{self.supabase_url}/rest/v1/site_devices",
            params={
                "site_id": f"eq.{self.site_id}",
                "select": "*,device_templates(id,template_id,name,device_type,brand,model,alarm_definitions)",
            },
            headers=self._headers(),
            timeout=30.0,
        )
        response.raise_for_status()
        devices = response.json()

        # Process each device to include full register info
        processed_devices = []
        for device in devices:
            processed = {
                "id": device["id"],
                "name": device["name"],
                "device_type": device.get("device_type") or device.get("device_templates", {}).get("device_type"),
                "protocol": device.get("protocol", "tcp"),
                "host": device.get("host") or device.get("gateway_ip", ""),
                "port": device.get("port") or device.get("gateway_port", 502),
                "slave_id": device.get("slave_id", 1),
                "rated_power_kw": device.get("rated_power_kw"),
                "rated_power_kva": device.get("rated_power_kva"),
                # Get registers from device or template
                "registers": device.get("registers") or [],
                "alarm_registers": device.get("alarm_registers") or [],
                "alarm_definitions": device.get("device_templates", {}).get("alarm_definitions") or [],
            }

            # If device has a template and no custom registers, fetch template registers
            if not processed["registers"] and device.get("template_id"):
                template_registers = await self._fetch_template_registers(
                    client, device["template_id"]
                )
                processed["registers"] = template_registers

            processed_devices.append(processed)

        return processed_devices

    async def _fetch_template_registers(
        self,
        client: httpx.AsyncClient,
        template_id: str,
    ) -> list[dict]:
        """Fetch registers from device template"""
        response = await client.get(
            f"{self.supabase_url}/rest/v1/device_templates",
            params={
                "id": f"eq.{template_id}",
                "select": "registers",
            },
            headers=self._headers(),
            timeout=10.0,
        )
        response.raise_for_status()
        data = response.json()

        if data and data[0].get("registers"):
            return data[0]["registers"]
        return []

    async def _fetch_calculated_fields(self, client: httpx.AsyncClient) -> list[dict]:
        """Fetch calculated field definitions"""
        response = await client.get(
            f"{self.supabase_url}/rest/v1/calculated_field_definitions",
            params={
                "is_system": "eq.true",
                "select": "*",
            },
            headers=self._headers(),
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()

    async def _fetch_alarm_overrides(self, client: httpx.AsyncClient) -> list[dict]:
        """Fetch site-specific alarm overrides"""
        response = await client.get(
            f"{self.supabase_url}/rest/v1/site_alarm_overrides",
            params={
                "site_id": f"eq.{self.site_id}",
                "select": "*",
            },
            headers=self._headers(),
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()

    def _build_config(
        self,
        site: dict,
        devices: list[dict],
        calculated_fields: list[dict],
        alarm_overrides: list[dict],
    ) -> dict[str, Any]:
        """Build complete configuration dictionary"""
        project = site.get("projects", {})

        # Build mode settings based on operation mode
        mode_settings = {}
        operation_mode = site.get("operation_mode", "zero_dg_reverse")

        if operation_mode in ["zero_dg_reverse", "zero_dg_pf"]:
            mode_settings["dg_reserve_kw"] = site.get("dg_reserve_kw", 10.0)
        if operation_mode == "zero_dg_pf":
            mode_settings["target_power_factor"] = site.get("target_power_factor", 0.95)
        if operation_mode == "zero_dg_reactive":
            mode_settings["max_reactive_kvar"] = site.get("max_reactive_kvar", 50.0)
        if operation_mode == "peak_shaving":
            mode_settings["peak_threshold_kw"] = site.get("peak_threshold_kw", 500.0)
            mode_settings["battery_reserve_pct"] = site.get("battery_reserve_pct", 20.0)

        return {
            "id": site["id"],
            "name": site.get("name", ""),
            "operation_mode": operation_mode,
            "config_mode": site.get("config_mode", "full_system"),
            "control_interval_ms": site.get("control_interval_ms", 1000),
            "mode_settings": mode_settings,
            "logging": {
                "local_write_interval_s": site.get("logging_local_interval_ms", 10000) // 1000,
                "cloud_sync_interval_s": site.get("logging_cloud_interval_ms", 120000) // 1000,
                "aggregation_method": "last",
                "include_min_max": True,
                "local_retention_days": site.get("logging_local_retention_days", 7),
                "instant_sync_alarms": True,
            },
            "safe_mode": {
                "enabled": site.get("safe_mode_enabled", True),
                "type": site.get("safe_mode_type", "time_based"),
                "timeout_s": site.get("safe_mode_timeout_s", 30),
                "rolling_window_min": site.get("safe_mode_rolling_window_min", 3),
                "threshold_pct": site.get("safe_mode_threshold_pct", 80.0),
                "power_limit_kw": site.get("safe_mode_power_limit_kw", 0.0),
            },
            "devices": devices,
            "calculated_fields": [
                {
                    "field_id": cf["field_id"],
                    "name": cf["name"],
                    "calculation_type": cf["calculation_type"],
                    "source_devices": cf.get("source_devices", []),
                    "source_register": cf.get("source_register", ""),
                    "unit": cf.get("unit", ""),
                    "time_window": cf.get("time_window"),
                }
                for cf in calculated_fields
            ],
            "alarm_overrides": {
                override["alarm_definition_id"]: {
                    "enabled": override.get("enabled"),
                    "conditions_override": override.get("conditions_override"),
                    "cooldown_seconds_override": override.get("cooldown_seconds_override"),
                }
                for override in alarm_overrides
            },
            "project": {
                "id": project.get("id"),
                "name": project.get("name"),
                "timezone": project.get("timezone", "UTC"),
            },
            "updated_at": site.get("updated_at"),
            "synced_at": datetime.now(timezone.utc).isoformat(),
        }

    def _headers(self) -> dict[str, str]:
        """Get request headers"""
        return {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
        }
