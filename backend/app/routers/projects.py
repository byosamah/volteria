"""
Projects Router

Handles project (site) management:
- CRUD operations for projects
- Control settings configuration
- Device assignment
- Controller registration and status
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
    require_project_access,
    check_project_access
)

router = APIRouter()


# ============================================
# SCHEMAS
# ============================================

class ControlSettings(BaseModel):
    """Control loop settings."""
    interval_ms: int = Field(default=1000, ge=100, le=10000)
    dg_reserve_kw: float = Field(default=50.0, ge=0.0)  # Cannot be negative!
    operation_mode: str = "zero_dg_reverse"


class LoggingSettings(BaseModel):
    """Logging configuration."""
    local_interval_ms: int = Field(default=1000, ge=100)
    cloud_interval_ms: int = Field(default=5000, ge=1000)
    local_retention_days: int = Field(default=7, ge=1, le=90)


class SafeModeSettings(BaseModel):
    """Safe mode configuration."""
    enabled: bool = True
    type: str = "rolling_average"  # 'time_based' or 'rolling_average'
    timeout_s: int = Field(default=30, ge=5)
    rolling_window_min: int = Field(default=3, ge=1)
    threshold_pct: float = Field(default=80.0, ge=0, le=100)


class ProjectCreate(BaseModel):
    """Create project request."""
    name: str
    location: Optional[str] = None
    description: Optional[str] = None
    controller_serial_number: Optional[str] = None
    control: ControlSettings = ControlSettings()
    logging: LoggingSettings = LoggingSettings()
    safe_mode: SafeModeSettings = SafeModeSettings()


class ProjectUpdate(BaseModel):
    """Update project request."""
    name: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    control: Optional[ControlSettings] = None
    logging: Optional[LoggingSettings] = None
    safe_mode: Optional[SafeModeSettings] = None


class ControllerInfo(BaseModel):
    """Controller registration info."""
    serial_number: str
    hardware_type: str = "raspberry_pi_5"
    firmware_version: Optional[str] = None
    status: str = "offline"
    last_seen: Optional[str] = None


class ProjectResponse(BaseModel):
    """Project response."""
    id: str
    name: str
    location: Optional[str]
    description: Optional[str]
    controller: Optional[ControllerInfo]
    control: ControlSettings
    logging: LoggingSettings
    safe_mode: SafeModeSettings
    device_count: int = 0
    is_active: bool


class ProjectSummary(BaseModel):
    """Project summary for list view."""
    id: str
    name: str
    location: Optional[str]
    controller_status: str
    device_count: int
    is_active: bool


# ============================================
# HELPER FUNCTIONS
# ============================================

def db_row_to_project_response(row: dict, device_count: int = 0) -> ProjectResponse:
    """Convert database row to ProjectResponse."""
    # Build controller info if serial number exists
    controller = None
    if row.get("controller_serial_number"):
        controller = ControllerInfo(
            serial_number=row.get("controller_serial_number", ""),
            hardware_type=row.get("controller_hardware_type", "raspberry_pi_5"),
            firmware_version=row.get("controller_firmware_version"),
            status=row.get("controller_status", "offline"),
            last_seen=row.get("controller_last_seen")
        )

    return ProjectResponse(
        id=str(row["id"]),
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
            threshold_pct=float(row.get("safe_mode_threshold_pct", 80.0))
        ),
        device_count=device_count,
        is_active=row.get("is_active", True)
    )


# ============================================
# ENDPOINTS
# ============================================

@router.get("/", response_model=list[ProjectSummary])
async def list_projects(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """
    List all projects the user has access to.

    - admin/super_admin: See all projects
    - configurator/viewer: Only see assigned projects

    Returns summary information for each project.
    Pagination supported via skip/limit.
    """
    try:
        # Admin and super_admin see all projects
        if current_user.role in ["super_admin", "admin"]:
            result = db.table("projects").select(
                "id, name, location, controller_status, is_active"
            ).eq("is_active", True).range(skip, skip + limit - 1).execute()
        else:
            # Other roles only see assigned projects
            # First get the project IDs the user has access to
            user_projects = db.table("user_projects").select(
                "project_id"
            ).eq("user_id", current_user.id).execute()

            project_ids = [p["project_id"] for p in user_projects.data]

            if not project_ids:
                return []  # No assigned projects

            result = db.table("projects").select(
                "id, name, location, controller_status, is_active"
            ).eq("is_active", True).in_("id", project_ids).range(skip, skip + limit - 1).execute()

        # Get device counts for all projects in one batch query (avoids N+1)
        project_ids = [row["id"] for row in result.data]
        device_count_map = {}

        if project_ids:
            device_rows = db.table("project_devices").select(
                "project_id"
            ).in_("project_id", project_ids).eq("enabled", True).execute()

            # Count devices per project
            for device in device_rows.data:
                pid = device["project_id"]
                device_count_map[pid] = device_count_map.get(pid, 0) + 1

        # Build response with counts from map
        projects = []
        for row in result.data:
            projects.append(ProjectSummary(
                id=str(row["id"]),
                name=row["name"],
                location=row.get("location"),
                controller_status=row.get("controller_status", "offline"),
                device_count=device_count_map.get(row["id"], 0),
                is_active=row.get("is_active", True)
            ))

        return projects
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch projects: {str(e)}"
        )


@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    project: ProjectCreate,
    current_user: CurrentUser = Depends(require_role(["super_admin", "admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Create a new project.

    Only admin and super_admin can create projects.
    """
    try:
        # Build the insert data
        insert_data = {
            "name": project.name,
            "location": project.location,
            "description": project.description,
            "controller_serial_number": project.controller_serial_number,
            "control_interval_ms": project.control.interval_ms,
            "dg_reserve_kw": project.control.dg_reserve_kw,
            "operation_mode": project.control.operation_mode,
            "logging_local_interval_ms": project.logging.local_interval_ms,
            "logging_cloud_interval_ms": project.logging.cloud_interval_ms,
            "logging_local_retention_days": project.logging.local_retention_days,
            "safe_mode_enabled": project.safe_mode.enabled,
            "safe_mode_type": project.safe_mode.type,
            "safe_mode_timeout_s": project.safe_mode.timeout_s,
            "safe_mode_rolling_window_min": project.safe_mode.rolling_window_min,
            "safe_mode_threshold_pct": project.safe_mode.threshold_pct,
            "is_active": True,
            "controller_status": "offline"
        }

        result = db.table("projects").insert(insert_data).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create project"
            )

        return db_row_to_project_response(result.data[0], device_count=0)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create project: {str(e)}"
        )


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: UUID,
    current_user: CurrentUser = Depends(require_project_access()),
    db: Client = Depends(get_supabase)
):
    """
    Get project details by ID.

    User must have access to this project.
    """
    try:
        result = db.table("projects").select("*").eq("id", str(project_id)).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project {project_id} not found"
            )

        # Get device count
        device_count_result = db.table("project_devices").select(
            "id", count="exact"
        ).eq("project_id", str(project_id)).eq("enabled", True).execute()

        device_count = device_count_result.count or 0

        return db_row_to_project_response(result.data[0], device_count=device_count)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch project: {str(e)}"
        )


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID,
    update: ProjectUpdate,
    current_user: CurrentUser = Depends(require_project_access(require_edit=True)),
    db: Client = Depends(get_supabase)
):
    """
    Update project settings.

    User must have edit permission for this project.
    """
    try:
        # Check if project exists
        existing = db.table("projects").select("id").eq("id", str(project_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project {project_id} not found"
            )

        # Build update data (only include non-None fields)
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

        if not update_data:
            # Nothing to update, just return current
            return await get_project(project_id, db)

        result = db.table("projects").update(update_data).eq("id", str(project_id)).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update project"
            )

        # Get device count
        device_count_result = db.table("project_devices").select(
            "id", count="exact"
        ).eq("project_id", str(project_id)).eq("enabled", True).execute()

        device_count = device_count_result.count or 0

        return db_row_to_project_response(result.data[0], device_count=device_count)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update project: {str(e)}"
        )


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: UUID,
    current_user: CurrentUser = Depends(require_role(["super_admin", "admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Delete a project (soft delete).

    Only admin and super_admin can delete projects.
    This sets is_active to false rather than actually deleting.
    """
    try:
        # Check if project exists
        existing = db.table("projects").select("id").eq("id", str(project_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project {project_id} not found"
            )

        # Soft delete - set is_active to false
        db.table("projects").update({"is_active": False}).eq("id", str(project_id)).execute()

        return None
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete project: {str(e)}"
        )


# ============================================
# CONTROLLER ENDPOINTS (DEPRECATED - Use /api/sites instead)
# These endpoints are kept for backward compatibility.
# New code should use the /api/sites router.
# ============================================

@router.post("/{project_id}/register-controller", response_model=ControllerInfo, deprecated=True)
async def register_controller(
    project_id: UUID,
    controller: ControllerInfo,
    current_user: CurrentUser = Depends(require_role(["super_admin", "admin"])),
    db: Client = Depends(get_supabase)
):
    """
    DEPRECATED: Use /api/sites/{site_id}/heartbeat instead.

    Register a site controller with this project.

    Called when a new Raspberry Pi controller is set up.
    Links the hardware serial number to this project.
    Only admin and super_admin can register controllers.
    """
    try:
        # Check if project exists
        existing = db.table("projects").select("id").eq("id", str(project_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project {project_id} not found"
            )

        # Update project with controller info
        update_data = {
            "controller_serial_number": controller.serial_number,
            "controller_hardware_type": controller.hardware_type,
            "controller_firmware_version": controller.firmware_version,
            "controller_status": "offline",
            "controller_last_seen": None
        }

        db.table("projects").update(update_data).eq("id", str(project_id)).execute()

        return controller
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to register controller: {str(e)}"
        )


@router.post("/{project_id}/heartbeat", deprecated=True)
async def controller_heartbeat(
    project_id: UUID,
    firmware_version: Optional[str] = None,
    uptime_seconds: Optional[int] = None,
    cpu_usage_pct: Optional[float] = None,
    memory_usage_pct: Optional[float] = None,
    db: Client = Depends(get_supabase)
):
    """
    DEPRECATED: Use /api/sites/{site_id}/heartbeat instead.

    Receive heartbeat from site controller.

    Called every 5 minutes by the on-site controller.
    Updates controller status to 'online' and records metrics.
    """
    try:
        # Update controller status
        update_data = {
            "controller_status": "online",
            "controller_last_seen": datetime.utcnow().isoformat()
        }

        if firmware_version:
            update_data["controller_firmware_version"] = firmware_version

        db.table("projects").update(update_data).eq("id", str(project_id)).execute()

        return {
            "status": "received",
            "project_id": str(project_id),
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process heartbeat: {str(e)}"
        )


@router.get("/{project_id}/config", deprecated=True)
async def get_project_config(
    project_id: UUID,
    db: Client = Depends(get_supabase)
):
    """
    DEPRECATED: Use /api/sites/{site_id}/config instead.

    Get full project configuration for controller.

    Returns all settings and device configurations
    in a format suitable for the on-site controller.
    This is what the controller downloads on startup.
    """
    try:
        # Get project
        project_result = db.table("projects").select("*").eq("id", str(project_id)).execute()
        if not project_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project {project_id} not found"
            )

        project = project_result.data[0]

        # Get devices with their templates
        devices_result = db.table("project_devices").select(
            "*, device_templates(*)"
        ).eq("project_id", str(project_id)).eq("enabled", True).execute()

        # Build config structure similar to config.yaml
        config = {
            "site": {
                "id": str(project["id"]),
                "name": project["name"],
                "location": project.get("location")
            },
            "control": {
                "interval_ms": project.get("control_interval_ms", 1000),
                "dg_reserve_kw": float(project.get("dg_reserve_kw", 50)),
                "operation_mode": project.get("operation_mode", "zero_dg_reverse")
            },
            "logging": {
                "local_interval_ms": project.get("logging_local_interval_ms", 1000),
                "cloud_interval_ms": project.get("logging_cloud_interval_ms", 5000),
                "local_retention_days": project.get("logging_local_retention_days", 7)
            },
            "safe_mode": {
                "enabled": project.get("safe_mode_enabled", True),
                "type": project.get("safe_mode_type", "rolling_average"),
                "timeout_s": project.get("safe_mode_timeout_s", 30),
                "rolling_window_min": project.get("safe_mode_rolling_window_min", 3),
                "threshold_pct": float(project.get("safe_mode_threshold_pct", 80))
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
                "name": device["name"],
                "template": template.get("template_id", "unknown"),
                "protocol": device.get("protocol", "tcp"),
                "slave_id": device.get("slave_id", 1)
            }

            # Add connection details based on protocol
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

            # Add to appropriate category
            if device_type == "meter" or device_type == "load_meter":
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
