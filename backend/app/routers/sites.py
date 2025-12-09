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
            device_count_result = db.table("project_devices").select(
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
        device_count_result = db.table("project_devices").select(
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
            device_count_result = db.table("project_devices").select(
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
        device_count_result = db.table("project_devices").select(
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
    db: Client = Depends(get_supabase)
):
    """
    Receive heartbeat from site controller.
    """
    try:
        update_data = {
            "controller_status": "online",
            "controller_last_seen": datetime.utcnow().isoformat()
        }

        if firmware_version:
            update_data["controller_firmware_version"] = firmware_version

        db.table("sites").update(update_data).eq("id", str(site_id)).execute()

        # Also insert into heartbeats table
        heartbeat_data = {
            "site_id": str(site_id),
            "firmware_version": firmware_version,
            "uptime_seconds": uptime_seconds,
            "cpu_usage_pct": cpu_usage_pct,
            "memory_usage_pct": memory_usage_pct
        }
        db.table("controller_heartbeats").insert(heartbeat_data).execute()

        return {
            "status": "received",
            "site_id": str(site_id),
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

        # Get devices for this site with measurement_type
        devices_result = db.table("project_devices").select(
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
                "generators": []
            }
        }

        # Categorize devices
        for device in devices_result.data:
            template = device.get("device_templates", {})
            device_type = template.get("device_type", "unknown")

            device_config = {
                "id": str(device["id"]),  # Device ID for reference
                "name": device["name"],
                "measurement_type": device.get("measurement_type", "unknown"),  # What device measures
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
            if device.get("registers"):
                device_config["registers"] = device["registers"]
            if device.get("logging_interval_ms"):
                device_config["logging_interval_ms"] = device["logging_interval_ms"]

            if device_type in ["meter", "load_meter"]:
                config["devices"]["load_meters"].append(device_config)
            elif device_type == "inverter":
                config["devices"]["inverters"].append(device_config)
            elif device_type == "dg":
                config["devices"]["generators"].append(device_config)

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
