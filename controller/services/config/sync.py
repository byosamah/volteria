"""
Configuration Sync

Fetches complete site configuration from cloud.
Syncs every 60 minutes or on demand.

Optimized for low CPU usage:
- Reuses single HTTP client (no connection overhead per request)
- Fetches data in parallel where possible
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
        # Reusable HTTP client - avoids connection overhead per request
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create reusable HTTP client"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def close(self) -> None:
        """Close HTTP client"""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def fetch_site_config(self) -> dict[str, Any] | None:
        """
        Fetch complete site configuration from cloud.

        Returns:
            Complete site config dict, or None on error
        """
        try:
            client = await self._get_client()

            # 1. Fetch site settings first (need to confirm site exists)
            site = await self._fetch_site(client)
            if not site:
                return None

            # 2. Fetch remaining data IN PARALLEL for efficiency
            devices_task = self._fetch_devices(client)
            controller_task = self._fetch_controller_device(client)
            alarm_overrides_task = self._fetch_alarm_overrides(client)

            devices, controller_device, alarm_overrides = await asyncio.gather(
                devices_task,
                controller_task,
                alarm_overrides_task,
            )

            # 3. Fetch calculated field definitions for selected fields from controller
            selected_field_ids = []
            if controller_device:
                for cf in controller_device.get("calculated_fields") or []:
                    if cf.get("enabled", True):
                        selected_field_ids.append(cf.get("field_id"))

            calculated_fields = []
            if selected_field_ids:
                calculated_fields = await self._fetch_calculated_field_definitions(
                    client, selected_field_ids, controller_device.get("calculated_fields") or []
                )

            # 4. Build complete config
            config = self._build_config(
                site=site,
                devices=devices,
                calculated_fields=calculated_fields,
                alarm_overrides=alarm_overrides,
                controller_device=controller_device,
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
            client = await self._get_client()
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
        """Fetch enabled devices assigned to site with registers"""
        response = await client.get(
            f"{self.supabase_url}/rest/v1/site_devices",
            params={
                "site_id": f"eq.{self.site_id}",
                "enabled": "eq.true",
                "select": "*,device_templates(id,template_id,name,device_type,brand,model,alarm_registers,registers,logging_registers,visualization_registers)",
            },
            headers=self._headers(),
            timeout=30.0,
        )
        response.raise_for_status()
        devices = response.json()

        # Collect template IDs that need register fetching
        template_ids_to_fetch = []
        for device in devices:
            if not device.get("registers"):
                template = device.get("device_templates") or {}
                if not template.get("registers") and device.get("template_id"):
                    template_ids_to_fetch.append(device["template_id"])

        # Fetch all needed template registers IN PARALLEL
        template_registers_map = {}
        if template_ids_to_fetch:
            unique_ids = list(set(template_ids_to_fetch))
            fetch_tasks = [
                self._fetch_template_registers(client, tid)
                for tid in unique_ids
            ]
            results = await asyncio.gather(*fetch_tasks)
            template_registers_map = dict(zip(unique_ids, results))

        # Process each device
        processed_devices = []
        for device in devices:
            template = device.get("device_templates") or {}

            # Determine registers: device > template join > fetched template
            # Note: site_devices uses "registers", device_templates uses "logging_registers"
            registers = device.get("registers") or []
            if not registers:
                registers = template.get("registers") or template.get("logging_registers") or []
            if not registers and device.get("template_id"):
                registers = template_registers_map.get(device["template_id"], [])

            # Get visualization and alarm registers
            viz_registers = device.get("visualization_registers") or template.get("visualization_registers") or []
            alarm_registers = device.get("alarm_registers") or template.get("alarm_registers") or []

            # Normalize all register types with complete field set
            normalized_registers = [self._normalize_register(r) for r in registers]
            normalized_viz = [self._normalize_register(r) for r in viz_registers]
            normalized_alarms = [self._normalize_register(r) for r in alarm_registers]

            processed = {
                "id": device["id"],
                "name": device["name"],
                "template_id": device.get("template_id"),
                # device_type defines what the device is (load, inverter, generator, sensor, etc.)
                "device_type": device.get("device_type") or template.get("device_type"),
                "enabled": device.get("enabled", True),
                # Modbus connection settings
                "modbus": {
                    "protocol": device.get("protocol", "tcp"),
                    # TCP connection
                    "host": device.get("ip_address") or device.get("host", ""),
                    "port": device.get("port", 502),
                    # RTU Gateway connection
                    "gateway_ip": device.get("gateway_ip"),
                    "gateway_port": device.get("gateway_port"),
                    # RTU Direct (serial) connection
                    "serial_port": device.get("serial_port"),
                    "baudrate": device.get("baudrate"),
                    # Common
                    "slave_id": device.get("slave_id", 1),
                },
                # Device specs
                "rated_power_kw": device.get("rated_power_kw"),
                "rated_power_kva": device.get("rated_power_kva"),
                # Registers - normalized with all fields
                "registers": normalized_registers,
                "visualization_registers": normalized_viz,
                "alarm_registers": normalized_alarms,
                # Device logging settings
                "logging_interval_ms": device.get("logging_interval_ms", 1000),
                # Calculated fields for this device
                "calculated_fields": device.get("calculated_fields") or [],
                # Connection alarm settings
                "connection_alarm": {
                    "enabled": device.get("connection_alarm_enabled", True),
                    "severity": device.get("connection_alarm_severity", "warning"),
                },
            }

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
                "select": "registers,logging_registers",
            },
            headers=self._headers(),
            timeout=10.0,
        )
        response.raise_for_status()
        data = response.json()

        if data:
            # Prefer logging_registers (modern), fallback to registers (legacy)
            return data[0].get("logging_registers") or data[0].get("registers") or []
        return []

    def _normalize_register(self, reg: dict) -> dict:
        """
        Normalize a register with all fields and defaults.

        This ensures the controller has complete register specs for:
        - Reading/writing Modbus values
        - Applying scale/offset transformations
        - Validating min/max ranges
        - Displaying with proper decimals
        - Using in control logic via register_role
        """
        return {
            # Required fields
            "address": reg.get("address", 0),
            "name": reg.get("name", ""),
            "type": reg.get("type") or reg.get("register_type", "input"),  # input or holding
            "access": reg.get("access", "read"),  # read, write, readwrite
            "datatype": reg.get("datatype") or reg.get("data_type", "uint16"),  # uint16, int16, uint32, int32, float32

            # Transformation fields
            "scale": reg.get("scale") or reg.get("scale_factor", 1.0),  # Multiplier
            "offset": reg.get("offset", 0.0),  # Addition (can be negative)
            "scale_order": reg.get("scale_order", "multiply_first"),  # multiply_first or add_first

            # Display fields
            "unit": reg.get("unit"),
            "decimals": reg.get("decimals"),  # Display precision
            "group": reg.get("group"),  # Grouping for UI
            "description": reg.get("description"),

            # Validation fields
            "min": reg.get("min"),  # Minimum valid value
            "max": reg.get("max"),  # Maximum valid value

            # Control logic
            "register_role": reg.get("register_role"),  # e.g., solar_active_power, load_active_power

            # Logging (default 60s if not set)
            "logging_frequency": reg.get("logging_frequency") or 60,  # In seconds

            # Advanced fields
            "size": reg.get("size", 0),  # Register count override (for UTF8 multi-register strings)
            "mask": reg.get("mask"),  # Bit mask config
            "values": reg.get("values"),  # Enumeration mapping

            # Alarm thresholds (for alarm registers)
            "thresholds": reg.get("thresholds"),
        }

    async def _fetch_controller_device(self, client: httpx.AsyncClient) -> dict | None:
        """Fetch the controller master device with its calculated_fields and site_level_alarms"""
        response = await client.get(
            f"{self.supabase_url}/rest/v1/site_master_devices",
            params={
                "site_id": f"eq.{self.site_id}",
                "device_type": "eq.controller",
                "select": "id,name,calculated_fields,site_level_alarms",
            },
            headers=self._headers(),
            timeout=10.0,
        )
        response.raise_for_status()
        data = response.json()
        if data:
            return data[0]
        return None

    async def _fetch_calculated_field_definitions(
        self,
        client: httpx.AsyncClient,
        field_ids: list[str],
        controller_selections: list[dict],
    ) -> list[dict]:
        """Fetch calculated field definitions for selected field_ids and merge with controller settings"""
        if not field_ids:
            return []

        # Fetch definitions for selected fields
        response = await client.get(
            f"{self.supabase_url}/rest/v1/calculated_field_definitions",
            params={
                "field_id": f"in.({','.join(field_ids)})",
                "select": "*",
            },
            headers=self._headers(),
            timeout=10.0,
        )
        response.raise_for_status()
        definitions = response.json()

        # Create lookup for controller selections (storage_mode, enabled)
        selection_map = {s["field_id"]: s for s in controller_selections}

        # Merge definitions with controller settings
        result = []
        for defn in definitions:
            field_id = defn.get("field_id")
            selection = selection_map.get(field_id, {})
            calc_config = defn.get("calculation_config") or {}
            result.append({
                "field_id": field_id,
                "name": defn.get("name"),
                "calculation_type": defn.get("calculation_type"),
                "source_devices": calc_config.get("source_device_types", []),
                "source_register": calc_config.get("source_register", ""),
                "register_role": calc_config.get("register_role"),
                "calculation_config": calc_config,
                "unit": defn.get("unit", ""),
                "time_window": defn.get("time_window"),
                "logging_frequency": defn.get("logging_frequency_seconds", 60),
                # Controller-specific settings
                "storage_mode": selection.get("storage_mode", "log"),
                "enabled": selection.get("enabled", True),
            })

        return result

    async def _fetch_alarm_overrides(self, client: httpx.AsyncClient) -> list[dict]:
        """Fetch site-specific alarm overrides (optional table)"""
        try:
            response = await client.get(
                f"{self.supabase_url}/rest/v1/site_alarm_overrides",
                params={
                    "site_id": f"eq.{self.site_id}",
                    "select": "*",
                },
                headers=self._headers(),
                timeout=10.0,
            )
            # Return empty list if table doesn't exist (404)
            if response.status_code == 404:
                return []
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError:
            # Table may not exist yet, return empty list
            return []

    def _build_config(
        self,
        site: dict,
        devices: list[dict],
        calculated_fields: list[dict],
        alarm_overrides: list[dict],
        controller_device: dict | None = None,
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

        # Build site_calculations from calculated_fields that have register_role
        site_calculations = []
        for cf in calculated_fields:
            register_role = cf.get("register_role")
            if register_role and cf.get("enabled", True):
                site_calculations.append({
                    "field_id": cf["field_id"],
                    "name": cf["name"],
                    "register_role": register_role,
                    "type": cf.get("calculation_type", "sum"),
                    "unit": cf.get("unit", ""),
                    "logging_frequency": cf.get("logging_frequency", 60),
                })

        # Controller device ID (for site calculations storage)
        controller_device_id = controller_device.get("id") if controller_device else None

        # Build virtual controller device for logging whitelist
        # This ensures the logging service includes site calculation fields
        if controller_device_id and site_calculations:
            controller_virtual_device = {
                "id": controller_device_id,
                "name": controller_device.get("name", "Site Controller"),
                "device_type": "site_controller",
                "enabled": True,
                "modbus": {},
                "registers": [
                    {
                        "name": sc["name"],
                        "address": 0,
                        "type": "virtual",
                        "datatype": "float32",
                        "unit": sc.get("unit", ""),
                        "logging_frequency": sc.get("logging_frequency", 60),
                        "register_role": sc.get("register_role"),
                    }
                    for sc in site_calculations
                ],
                "visualization_registers": [],
                "alarm_registers": [],
            }
            devices = devices + [controller_virtual_device]

        return {
            "id": site["id"],
            "project_id": site.get("project_id"),
            "name": site.get("name", ""),
            "location": site.get("location"),
            "description": site.get("description"),
            "operation_mode": operation_mode,
            "config_mode": site.get("config_mode", "full_system"),
            "control_method": site.get("control_method", "onsite_controller"),
            "control_method_backup": site.get("control_method_backup"),
            "grid_connection": site.get("grid_connection", "off_grid"),
            "control_interval_ms": site.get("control_interval_ms", 1000),
            "dg_reserve_kw": site.get("dg_reserve_kw", 0),
            "mode_settings": mode_settings,
            "logging": {
                # RAM buffering: sample readings every N seconds (default 1s)
                # This captures readings from SharedState into RAM buffer
                "local_sample_interval_s": site.get("logging_sample_interval_ms", 1000) // 1000,
                # RAM to SQLite flush interval (default 60s)
                # Reduces SSD/SD card wear by batching writes
                "local_flush_interval_s": site.get("logging_flush_interval_ms", 60000) // 1000,
                # Cloud sync bucket interval (default 3 min = 180s for batching)
                # Readings are downsampled per-register based on logging_frequency
                "cloud_sync_interval_s": site.get("logging_cloud_interval_ms", 180000) // 1000,
                "aggregation_method": "last",
                "include_min_max": True,
                "local_retention_days": site.get("logging_local_retention_days", 7),
                "local_enabled": site.get("logging_local_enabled", True),
                "cloud_enabled": site.get("logging_cloud_enabled", True),
                "gateway_enabled": site.get("logging_gateway_enabled", False),
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
            "config_sync_interval_s": site.get("config_sync_interval_s", 3600),
            "devices": devices,
            # Site-level calculated fields (from controller device selection)
            "calculated_fields": calculated_fields,
            # Site calculations for register_role-based computation
            "site_calculations": site_calculations,
            "controller_device_id": controller_device_id,
            # Site-level alarms (from controller device)
            "site_level_alarms": (controller_device.get("site_level_alarms") or []) if controller_device else [],
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
