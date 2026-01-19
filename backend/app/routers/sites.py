"""
Sites Router

Handles site management within projects:
- CRUD operations for sites
- Control settings configuration (moved from projects)
- Device assignment
- Controller registration and status
- Config sync for controllers

Sites are physical locations with one controller each.
Projects are virtual groupings of sites.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from supabase import Client

from app.services.supabase import get_supabase
from app.dependencies.auth import (
    CurrentUser,
    get_current_user,
    require_role,
)

router = APIRouter()


# ============================================
# SCHEMAS
# ============================================

class ControlSettings(BaseModel):
    """Control loop settings."""
    interval_ms: int = Field(default=1000, ge=100, le=10000)
    dg_reserve_kw: float = Field(default=50.0, ge=0.0)
    operation_mode: str = "zero_dg_reverse"


class LoggingSettings(BaseModel):
    """Logging configuration."""
    local_interval_ms: int = Field(default=1000, ge=100)
    cloud_interval_ms: int = Field(default=5000, ge=1000)
    local_retention_days: int = Field(default=7, ge=1, le=90)


class SafeModeSettings(BaseModel):
    """Safe mode configuration."""
    enabled: bool = True
    type: str = "rolling_average"
    timeout_s: int = Field(default=30, ge=5)
    rolling_window_min: int = Field(default=3, ge=1)
    threshold_pct: float = Field(default=80.0, ge=0, le=100)
    power_limit_kw: Optional[float] = None


class ControllerInfo(BaseModel):
    """Controller registration info."""
    serial_number: Optional[str] = None
    hardware_type: str = "raspberry_pi_5"
    firmware_version: Optional[str] = None
    status: str = "offline"
    last_seen: Optional[str] = None


class SiteCreate(BaseModel):
    """Create site request."""
    name: str
    location: Optional[str] = None
    description: Optional[str] = None
    controller_serial_number: Optional[str] = None
    control: ControlSettings = ControlSettings()
    logging: LoggingSettings = LoggingSettings()
    safe_mode: SafeModeSettings = SafeModeSettings()


class SiteUpdate(BaseModel):
    """Update site request."""
    name: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    control: Optional[ControlSettings] = None
    logging: Optional[LoggingSettings] = None
    safe_mode: Optional[SafeModeSettings] = None


class SiteResponse(BaseModel):
    """Site response."""
    id: str
    project_id: str
    name: str
    location: Optional[str]
    description: Optional[str]
    controller: ControllerInfo
    control: ControlSettings
    logging: LoggingSettings
    safe_mode: SafeModeSettings
    device_count: int = 0
    config_synced_at: Optional[str] = None
    is_active: bool


class SiteSummary(BaseModel):
    """Site summary for list view."""
    id: str
    project_id: str
    name: str
    location: Optional[str]
    controller_status: str
    device_count: int
    is_active: bool


# ============================================
# HELPER FUNCTIONS
# ============================================

def db_row_to_site_response(row: dict, device_count: int = 0) -> SiteResponse:
    """Convert database row to SiteResponse."""
    controller = ControllerInfo(
        serial_number=row.get("controller_serial_number"),
        hardware_type=row.get("controller_hardware_type", "raspberry_pi_5"),
        firmware_version=row.get("controller_firmware_version"),
        status=row.get("controller_status", "offline"),
        last_seen=row.get("controller_last_seen")
    )

    return SiteResponse(
        id=str(row["id"]),
        project_id=str(row["project_id"]),
        name=row["name"],
        location=row.get("location"),
        description=row.get("description"),
        controller=controller,
        control=ControlSettings(
            interval_ms=row.get("control_interval_ms", 1000),
            dg_reserve_kw=float(row.get("dg_reserve_kw", 50.0)),
            operation_mode=row.get("operation_mode", "zero_dg_reverse")
        ),
        logging=LoggingSettings(
            local_interval_ms=row.get("logging_local_interval_ms", 1000),
            cloud_interval_ms=row.get("logging_cloud_interval_ms", 5000),
            local_retention_days=row.get("logging_local_retention_days", 7)
        ),
        safe_mode=SafeModeSettings(
            enabled=row.get("safe_mode_enabled", True),
            type=row.get("safe_mode_type", "rolling_average"),
            timeout_s=row.get("safe_mode_timeout_s", 30),
            rolling_window_min=row.get("safe_mode_rolling_window_min", 3),
            threshold_pct=float(row.get("safe_mode_threshold_pct", 80.0)),
            power_limit_kw=row.get("safe_mode_power_limit_kw")
        ),
        device_count=device_count,
        config_synced_at=row.get("config_synced_at"),
        is_active=row.get("is_active", True)
    )


async def check_project_access(project_id: str, user: CurrentUser, db: Client) -> bool:
    """Check if user has access to the project."""
    if user.role in ["super_admin", "admin", "backend_admin"]:
        return True

    result = db.table("user_projects").select("project_id").eq(
        "user_id", user.id
    ).eq("project_id", project_id).execute()

    return len(result.data) > 0


# ============================================
# ENDPOINTS - LIST SITES
# ============================================

@router.get("/project/{project_id}", response_model=list[SiteSummary])
async def list_sites_in_project(
    project_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """
    List all sites in a project.

    User must have access to the project.
    """
    try:
        # Check project access
        if not await check_project_access(str(project_id), current_user, db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this project"
            )

        result = db.table("sites").select(
            "id, project_id, name, location, controller_status, is_active"
        ).eq("project_id", str(project_id)).eq(
            "is_active", True
        ).range(skip, skip + limit - 1).execute()

        sites = []
        for row in result.data:
            # Get device count for this site
            device_count_result = db.table("site_devices").select(
                "id", count="exact"
            ).eq("site_id", row["id"]).eq("enabled", True).execute()

            device_count = device_count_result.count or 0

            sites.append(SiteSummary(
                id=str(row["id"]),
                project_id=str(row["project_id"]),
                name=row["name"],
                location=row.get("location"),
                controller_status=row.get("controller_status", "offline"),
                device_count=device_count,
                is_active=row.get("is_active", True)
            ))

        return sites
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch sites: {str(e)}"
        )


# ============================================
# ENDPOINTS - CRUD
# ============================================

@router.post("/project/{project_id}", response_model=SiteResponse, status_code=status.HTTP_201_CREATED)
async def create_site(
    project_id: UUID,
    site: SiteCreate,
    current_user: CurrentUser = Depends(require_role(["super_admin", "admin", "enterprise_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Create a new site in a project.

    Only admin, super_admin, and enterprise_admin can create sites.
    """
    try:
        # Verify project exists
        project_result = db.table("projects").select("id").eq("id", str(project_id)).execute()
        if not project_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project {project_id} not found"
            )

        # Build insert data
        insert_data = {
            "project_id": str(project_id),
            "name": site.name,
            "location": site.location,
            "description": site.description,
            "controller_serial_number": site.controller_serial_number,
            "control_interval_ms": site.control.interval_ms,
            "dg_reserve_kw": site.control.dg_reserve_kw,
            "operation_mode": site.control.operation_mode,
            "logging_local_interval_ms": site.logging.local_interval_ms,
            "logging_cloud_interval_ms": site.logging.cloud_interval_ms,
            "logging_local_retention_days": site.logging.local_retention_days,
            "safe_mode_enabled": site.safe_mode.enabled,
            "safe_mode_type": site.safe_mode.type,
            "safe_mode_timeout_s": site.safe_mode.timeout_s,
            "safe_mode_rolling_window_min": site.safe_mode.rolling_window_min,
            "safe_mode_threshold_pct": site.safe_mode.threshold_pct,
            "safe_mode_power_limit_kw": site.safe_mode.power_limit_kw,
            "is_active": True,
            "controller_status": "offline",
            "created_by": current_user.id
        }

        result = db.table("sites").insert(insert_data).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create site"
            )

        return db_row_to_site_response(result.data[0], device_count=0)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create site: {str(e)}"
        )


@router.get("/{site_id}", response_model=SiteResponse)
async def get_site(
    site_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """
    Get site details by ID.

    User must have access to the project containing this site.
    """
    try:
        result = db.table("sites").select("*").eq("id", str(site_id)).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Site {site_id} not found"
            )

        site = result.data[0]

        # Check project access
        if not await check_project_access(site["project_id"], current_user, db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this site"
            )

        # Get device count
        device_count_result = db.table("site_devices").select(
            "id", count="exact"
        ).eq("site_id", str(site_id)).eq("enabled", True).execute()

        device_count = device_count_result.count or 0

        return db_row_to_site_response(site, device_count=device_count)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch site: {str(e)}"
        )


@router.patch("/{site_id}", response_model=SiteResponse)
async def update_site(
    site_id: UUID,
    update: SiteUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """
    Update site settings.

    User must have edit permission for the project containing this site.
    """
    try:
        # Get existing site
        existing = db.table("sites").select("*").eq("id", str(site_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Site {site_id} not found"
            )

        site = existing.data[0]

        # Check project access (for now, just check if they can access the project)
        if not await check_project_access(site["project_id"], current_user, db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this site"
            )

        # Build update data
        update_data = {}

        if update.name is not None:
            update_data["name"] = update.name
        if update.location is not None:
            update_data["location"] = update.location
        if update.description is not None:
            update_data["description"] = update.description

        if update.control is not None:
            update_data["control_interval_ms"] = update.control.interval_ms
            update_data["dg_reserve_kw"] = update.control.dg_reserve_kw
            update_data["operation_mode"] = update.control.operation_mode

        if update.logging is not None:
            update_data["logging_local_interval_ms"] = update.logging.local_interval_ms
            update_data["logging_cloud_interval_ms"] = update.logging.cloud_interval_ms
            update_data["logging_local_retention_days"] = update.logging.local_retention_days

        if update.safe_mode is not None:
            update_data["safe_mode_enabled"] = update.safe_mode.enabled
            update_data["safe_mode_type"] = update.safe_mode.type
            update_data["safe_mode_timeout_s"] = update.safe_mode.timeout_s
            update_data["safe_mode_rolling_window_min"] = update.safe_mode.rolling_window_min
            update_data["safe_mode_threshold_pct"] = update.safe_mode.threshold_pct
            update_data["safe_mode_power_limit_kw"] = update.safe_mode.power_limit_kw

        if not update_data:
            # Nothing to update
            device_count_result = db.table("site_devices").select(
                "id", count="exact"
            ).eq("site_id", str(site_id)).eq("enabled", True).execute()
            return db_row_to_site_response(site, device_count=device_count_result.count or 0)

        result = db.table("sites").update(update_data).eq("id", str(site_id)).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update site"
            )

        # Get device count
        device_count_result = db.table("site_devices").select(
            "id", count="exact"
        ).eq("site_id", str(site_id)).eq("enabled", True).execute()

        return db_row_to_site_response(result.data[0], device_count=device_count_result.count or 0)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update site: {str(e)}"
        )


@router.delete("/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_site(
    site_id: UUID,
    current_user: CurrentUser = Depends(require_role(["super_admin", "admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Delete a site (soft delete).

    Only admin and super_admin can delete sites.
    """
    try:
        existing = db.table("sites").select("id").eq("id", str(site_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Site {site_id} not found"
            )

        db.table("sites").update({"is_active": False}).eq("id", str(site_id)).execute()
        return None
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete site: {str(e)}"
        )


# ============================================
# CONTROLLER ENDPOINTS
# ============================================

@router.post("/{site_id}/register-controller", response_model=ControllerInfo)
async def register_controller(
    site_id: UUID,
    controller: ControllerInfo,
    current_user: CurrentUser = Depends(require_role(["super_admin", "admin", "backend_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Register a controller with this site.
    """
    try:
        existing = db.table("sites").select("id").eq("id", str(site_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Site {site_id} not found"
            )

        update_data = {
            "controller_serial_number": controller.serial_number,
            "controller_hardware_type": controller.hardware_type,
            "controller_firmware_version": controller.firmware_version,
            "controller_status": "offline",
            "controller_last_seen": None
        }

        db.table("sites").update(update_data).eq("id", str(site_id)).execute()

        # Create site_master_devices record for controller assignment
        # This is what the /controllers/{id}/config endpoint checks to determine assignment
        controller_result = db.table("controllers").select("id").eq(
            "serial_number", controller.serial_number
        ).execute()

        if controller_result.data and len(controller_result.data) > 0:
            controller_uuid = controller_result.data[0]["id"]

            # Check if a site_master_devices record already exists for this controller
            existing_device = db.table("site_master_devices").select("id").eq(
                "controller_id", controller_uuid
            ).execute()

            if existing_device.data and len(existing_device.data) > 0:
                # Update existing record to point to new site
                db.table("site_master_devices").update({
                    "site_id": str(site_id),
                    "is_active": True
                }).eq("controller_id", controller_uuid).execute()
            else:
                # Create new site_master_devices record
                db.table("site_master_devices").insert({
                    "site_id": str(site_id),
                    "device_type": "controller",
                    "name": f"Controller {controller.serial_number}",
                    "controller_id": controller_uuid,
                    "is_active": True,
                    "created_by": str(current_user.id)
                }).execute()

            # Update controller status to deployed and link to site
            db.table("controllers").update({
                "status": "deployed",
                "site_id": str(site_id)
            }).eq("id", controller_uuid).execute()

        return controller
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to register controller: {str(e)}"
        )


@router.post("/{site_id}/heartbeat")
async def site_heartbeat(
    site_id: UUID,
    firmware_version: Optional[str] = None,
    uptime_seconds: Optional[int] = None,
    cpu_usage_pct: Optional[float] = None,
    memory_usage_pct: Optional[float] = None,
    disk_usage_pct: Optional[float] = None,
    metadata: Optional[dict] = None,
    db: Client = Depends(get_supabase)
):
    """
    Receive heartbeat from site controller.
    Stores all system metrics including CPU, memory, disk, and temperature.
    """
    try:
        update_data = {
            "controller_status": "online",
            "controller_last_seen": datetime.utcnow().isoformat()
        }

        if firmware_version:
            update_data["controller_firmware_version"] = firmware_version

        db.table("sites").update(update_data).eq("id", str(site_id)).execute()

        # Look up controller_id from site_master_devices
        # This links heartbeats to the controller for frontend queries
        controller_id = None
        try:
            master_result = db.table("site_master_devices").select("controller_id").eq(
                "site_id", str(site_id)
            ).eq("device_type", "controller").limit(1).execute()

            if master_result.data and master_result.data[0].get("controller_id"):
                controller_id = master_result.data[0]["controller_id"]
        except Exception:
            # Continue without controller_id if lookup fails
            pass

        # Insert heartbeat with ALL fields including controller_id
        heartbeat_data = {
            "site_id": str(site_id),
            "controller_id": controller_id,
            "firmware_version": firmware_version,
            "uptime_seconds": uptime_seconds,
            "cpu_usage_pct": cpu_usage_pct,
            "memory_usage_pct": memory_usage_pct,
            "disk_usage_pct": disk_usage_pct,
            "metadata": metadata or {}
        }
        db.table("controller_heartbeats").insert(heartbeat_data).execute()

        return {
            "status": "received",
            "site_id": str(site_id),
            "controller_id": controller_id,
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process heartbeat: {str(e)}"
        )


@router.get("/{site_id}/config")
async def get_site_config(
    site_id: UUID,
    db: Client = Depends(get_supabase)
):
    """
    Get full site configuration for controller.

    Returns all settings and device configurations
    in a format suitable for the on-site controller.
    """
    try:
        # Get site with project info
        site_result = db.table("sites").select("*, projects(id, name, enterprise_id)").eq(
            "id", str(site_id)
        ).execute()

        if not site_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Site {site_id} not found"
            )

        site = site_result.data[0]
        project = site.get("projects", {})

        # Get devices for this site with device_type
        devices_result = db.table("site_devices").select(
            "*, device_templates(*)"
        ).eq("site_id", str(site_id)).eq("enabled", True).execute()

        # Get config version for sync tracking (use site updated_at)
        config_version = site.get("updated_at") or site.get("created_at")

        # Build config
        config = {
            "config_version": config_version,  # For sync tracking
            "site": {
                "id": str(site["id"]),
                "name": site["name"],
                "location": site.get("location"),
                "project_id": str(site["project_id"]),
                "project_name": project.get("name") if project else None
            },
            "control": {
                "interval_ms": site.get("control_interval_ms", 1000),
                "dg_reserve_kw": float(site.get("dg_reserve_kw", 50)),
                "operation_mode": site.get("operation_mode", "zero_dg_reverse")
            },
            "logging": {
                "local_interval_ms": site.get("logging_local_interval_ms", 1000),
                "cloud_interval_ms": site.get("logging_cloud_interval_ms", 5000),
                "local_retention_days": site.get("logging_local_retention_days", 7)
            },
            "safe_mode": {
                "enabled": site.get("safe_mode_enabled", True),
                "type": site.get("safe_mode_type", "rolling_average"),
                "timeout_s": site.get("safe_mode_timeout_s", 30),
                "rolling_window_min": site.get("safe_mode_rolling_window_min", 3),
                "threshold_pct": float(site.get("safe_mode_threshold_pct", 80)),
                "power_limit_kw": site.get("safe_mode_power_limit_kw")
            },
            "devices": {
                "load_meters": [],
                "inverters": [],
                "generators": [],
                "sensors": [],
                "other": []
            }
        }

        # Categorize devices - use device's own device_type, fallback to template's
        for device in devices_result.data:
            template = device.get("device_templates") or {}
            # Prefer device-level device_type, fallback to template's device_type
            device_type = device.get("device_type") or template.get("device_type") or "unknown"

            device_config = {
                "id": str(device["id"]),  # Device ID for reference
                "name": device["name"],
                "device_type": device_type,  # Device type for control logic
                "template": template.get("template_id", "unknown"),
                "protocol": device.get("protocol", "tcp"),
                "slave_id": device.get("slave_id", 1)
            }

            if device.get("ip_address"):
                device_config["ip"] = device["ip_address"]
            if device.get("port"):
                device_config["port"] = device["port"]
            if device.get("gateway_ip"):
                device_config["gateway_ip"] = device["gateway_ip"]
            if device.get("gateway_port"):
                device_config["gateway_port"] = device["gateway_port"]
            if device.get("rated_power_kw"):
                device_config["rated_power_kw"] = float(device["rated_power_kw"])
            if device.get("rated_power_kva"):
                device_config["rated_power_kva"] = float(device["rated_power_kva"])
            # Support both new column name (logging_registers) and legacy (registers) for backward compatibility
            device_registers = device.get("logging_registers") or device.get("registers")
            if device_registers:
                device_config["registers"] = device_registers
            # Include visualization and alarm registers for controller
            if device.get("visualization_registers"):
                device_config["visualization_registers"] = device["visualization_registers"]
            if device.get("alarm_registers"):
                device_config["alarm_registers"] = device["alarm_registers"]
            if device.get("logging_interval_ms"):
                device_config["logging_interval_ms"] = device["logging_interval_ms"]

            # Categorize by device type
            if device_type in ["meter", "load_meter", "load", "subload", "energy_meter"]:
                config["devices"]["load_meters"].append(device_config)
            elif device_type in ["inverter", "solar_meter"]:
                config["devices"]["inverters"].append(device_config)
            elif device_type in ["dg", "diesel_generator", "gas_generator"]:
                config["devices"]["generators"].append(device_config)
            elif device_type in ["sensor", "temperature_humidity_sensor", "solar_sensor", "solar_radiation_sensor", "wind_sensor", "fuel_level_sensor"]:
                config["devices"]["sensors"].append(device_config)
            else:
                # Catch-all for other device types (wind_turbine, bess, capacitor_bank, etc.)
                config["devices"]["other"].append(device_config)

        return config
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get config: {str(e)}"
        )


@router.post("/{site_id}/sync")
async def sync_site_config(
    site_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """
    Mark site configuration as synced.

    Called after successfully pushing config to controller.
    Updates config_synced_at timestamp.
    """
    try:
        # Get site
        existing = db.table("sites").select("project_id").eq("id", str(site_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Site {site_id} not found"
            )

        # Check access
        if not await check_project_access(existing.data[0]["project_id"], current_user, db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this site"
            )

        # Update sync timestamp
        now = datetime.utcnow().isoformat()
        db.table("sites").update({"config_synced_at": now}).eq("id", str(site_id)).execute()

        return {
            "status": "synced",
            "site_id": str(site_id),
            "synced_at": now
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to sync config: {str(e)}"
        )


# ============================================
# TEMPLATE SYNC ENDPOINTS
# ============================================

@router.get("/{site_id}/template-sync-status")
async def get_template_sync_status(
    site_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """
    Get template sync status for all devices in a site.

    Returns:
    - last_config_update: Most recent template update across all templates used by devices
    - last_sync: Oldest sync timestamp across all devices (shows when site was fully synced)
    - needs_sync: True if any device's template was updated after last sync
    - devices: List of devices with their individual sync status
    """
    try:
        # Get all devices in the site with their template info
        devices_result = db.table("site_devices").select(
            "id, name, template_id, template_synced_at"
        ).eq("site_id", str(site_id)).eq("enabled", True).execute()

        if not devices_result.data:
            return {
                "last_config_update": None,
                "last_sync": None,
                "needs_sync": False,
                "devices": [],
                "total_devices": 0,
                "devices_needing_sync": 0
            }

        # Get all unique template IDs
        template_ids = list(set(
            d["template_id"] for d in devices_result.data
            if d.get("template_id")
        ))

        # Fetch template update timestamps
        templates_map = {}
        if template_ids:
            templates_result = db.table("device_templates").select(
                "id, updated_at, name"
            ).in_("id", template_ids).execute()

            templates_map = {
                t["id"]: t for t in templates_result.data
            } if templates_result.data else {}

        # Build device sync status list
        devices_status = []
        last_config_update = None
        last_sync = None
        devices_needing_sync = 0

        for device in devices_result.data:
            template_id = device.get("template_id")
            template = templates_map.get(template_id) if template_id else None

            device_sync_at = device.get("template_synced_at")
            template_updated_at = template.get("updated_at") if template else None

            # Determine if this device needs sync
            device_needs_sync = False
            if template_id and template_updated_at:
                if not device_sync_at:
                    device_needs_sync = True
                elif device_sync_at < template_updated_at:
                    device_needs_sync = True

            if device_needs_sync:
                devices_needing_sync += 1

            # Track global timestamps
            if template_updated_at:
                if not last_config_update or template_updated_at > last_config_update:
                    last_config_update = template_updated_at

            if device_sync_at:
                if not last_sync or device_sync_at < last_sync:
                    last_sync = device_sync_at

            devices_status.append({
                "id": device["id"],
                "name": device["name"],
                "template_id": template_id,
                "template_name": template.get("name") if template else None,
                "template_synced_at": device_sync_at,
                "template_updated_at": template_updated_at,
                "needs_sync": device_needs_sync
            })

        return {
            "last_config_update": last_config_update,
            "last_sync": last_sync,
            "needs_sync": devices_needing_sync > 0,
            "devices": devices_status,
            "total_devices": len(devices_result.data),
            "devices_needing_sync": devices_needing_sync
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get sync status: {str(e)}"
        )


@router.post("/{site_id}/sync-templates")
async def sync_site_templates(
    site_id: UUID,
    current_user: CurrentUser = Depends(require_role(["super_admin", "admin", "enterprise_admin", "configurator"])),
    db: Client = Depends(get_supabase)
):
    """
    Sync all devices in a site from their templates.

    For each register type (logging, visualization, alarm):
    - Replaces all registers with source:"template" with fresh copies from template
    - Preserves all registers with source:"manual"
    - New template registers are marked with source:"template"

    Calculated fields are freely editable at device level, so they're only synced
    if the device has no calculated fields yet.

    Returns count of synced devices and timestamp.
    """
    try:
        # Get all devices in site that have a template_id
        devices_result = db.table("site_devices").select(
            "id, template_id, registers, visualization_registers, alarm_registers, calculated_fields"
        ).eq("site_id", str(site_id)).eq("enabled", True).not_.is_("template_id", "null").execute()

        if not devices_result.data:
            return {
                "synced_devices": 0,
                "synced_at": datetime.utcnow().isoformat(),
                "message": "No devices with templates found in this site"
            }

        synced_count = 0
        errors = []

        # Helper: add source:"template" to all registers and ensure logging_frequency
        def add_template_source(registers):
            if not registers:
                return []
            result = []
            for r in registers:
                reg = {**r, "source": "template"}
                # Ensure logging_frequency is always set (default: 60 seconds = 1 minute)
                if "logging_frequency" not in reg or reg.get("logging_frequency") is None:
                    reg["logging_frequency"] = 60
                result.append(reg)
            return result

        # Helper: filter manual registers from device
        def get_manual_registers(registers):
            if not registers:
                return []
            return [r for r in registers if r.get("source") == "manual"]

        for device in devices_result.data:
            try:
                # Get template data
                print(f"[SYNC] Syncing device {device['id']} with template_id {device['template_id']}")
                template_result = db.table("device_templates").select(
                    "logging_registers, visualization_registers, alarm_registers, calculated_fields, registers"
                ).eq("id", device["template_id"]).single().execute()

                if template_result.data:
                    print(f"[SYNC] Found template with {len(template_result.data.get('logging_registers') or template_result.data.get('registers') or [])} logging registers")
                    template = template_result.data

                    # Get manual registers to preserve
                    manual_logging = get_manual_registers(device.get("registers"))
                    manual_viz = get_manual_registers(device.get("visualization_registers"))
                    manual_alarm = get_manual_registers(device.get("alarm_registers"))

                    # Get fresh template registers with source:"template"
                    template_logging = add_template_source(
                        template.get("logging_registers") or template.get("registers") or []
                    )
                    template_viz = add_template_source(template.get("visualization_registers") or [])
                    template_alarm = add_template_source(template.get("alarm_registers") or [])

                    # Merge: template registers + manual registers
                    merged_logging = template_logging + manual_logging
                    merged_viz = template_viz + manual_viz
                    merged_alarm = template_alarm + manual_alarm

                    # Build update data
                    update_data = {
                        "registers": merged_logging if merged_logging else [],
                        "visualization_registers": merged_viz if merged_viz else [],
                        "alarm_registers": merged_alarm if merged_alarm else [],
                        "template_synced_at": datetime.utcnow().isoformat()
                    }

                    # Only sync calculated_fields if device has none (freely editable)
                    if not device.get("calculated_fields"):
                        update_data["calculated_fields"] = template.get("calculated_fields") or []

                    db.table("site_devices").update(update_data).eq("id", device["id"]).execute()
                    print(f"[SYNC] Successfully updated device {device['id']} with {len(merged_logging)} logging, {len(merged_viz)} viz, {len(merged_alarm)} alarm registers")

                    synced_count += 1
                else:
                    print(f"[SYNC] Template not found for device {device['id']}")
            except Exception as device_error:
                print(f"[SYNC] Error syncing device {device['id']}: {device_error}")
                errors.append({
                    "device_id": device["id"],
                    "error": str(device_error)
                })

        result = {
            "synced_devices": synced_count,
            "synced_at": datetime.utcnow().isoformat(),
            "total_devices": len(devices_result.data)
        }

        if errors:
            result["errors"] = errors

        return result
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to sync templates: {str(e)}"
        )
