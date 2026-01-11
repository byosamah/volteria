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

# Note: Control settings, logging settings, safe mode settings, and controller info
# are now managed at the SITE level, not project level.
# Projects are just containers for grouping sites.
# See: backend/app/routers/sites.py for site-level settings


class ProjectCreate(BaseModel):
    """Create project request."""
    name: str
    location: Optional[str] = None
    description: Optional[str] = None


class ProjectUpdate(BaseModel):
    """Update project request."""
    name: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None


class ProjectResponse(BaseModel):
    """Project response."""
    id: str
    name: str
    location: Optional[str]
    description: Optional[str]
    timezone: Optional[str] = "UTC"
    site_count: int = 0
    is_active: bool


class ProjectSummary(BaseModel):
    """Project summary for list view."""
    id: str
    name: str
    location: Optional[str]
    site_count: int = 0
    is_active: bool


# ============================================
# HELPER FUNCTIONS
# ============================================

def db_row_to_project_response(row: dict, site_count: int = 0) -> ProjectResponse:
    """Convert database row to ProjectResponse."""
    return ProjectResponse(
        id=str(row["id"]),
        name=row["name"],
        location=row.get("location"),
        description=row.get("description"),
        timezone=row.get("timezone", "UTC"),
        site_count=site_count,
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
                "id, name, location, is_active"
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
                "id, name, location, is_active"
            ).eq("is_active", True).in_("id", project_ids).range(skip, skip + limit - 1).execute()

        # Get site counts for all projects in one batch query (avoids N+1)
        project_ids = [row["id"] for row in result.data]
        site_count_map = {}

        if project_ids:
            # Get all sites for these projects and count per project
            sites_result = db.table("sites").select(
                "project_id"
            ).in_("project_id", project_ids).eq("is_active", True).execute()

            # Count sites per project
            for site in sites_result.data:
                pid = site["project_id"]
                site_count_map[pid] = site_count_map.get(pid, 0) + 1

        # Build response with counts from map
        projects = []
        for row in result.data:
            projects.append(ProjectSummary(
                id=str(row["id"]),
                name=row["name"],
                location=row.get("location"),
                site_count=site_count_map.get(row["id"], 0),
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
    Projects are containers for sites - all operational settings are at site level.
    """
    try:
        # Build the insert data (only basic project info)
        insert_data = {
            "name": project.name,
            "location": project.location,
            "description": project.description,
            "is_active": True
        }

        result = db.table("projects").insert(insert_data).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create project"
            )

        return db_row_to_project_response(result.data[0], site_count=0)
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
        result = db.table("projects").select(
            "id, name, location, description, timezone, is_active"
        ).eq("id", str(project_id)).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project {project_id} not found"
            )

        # Get site count
        sites_result = db.table("sites").select(
            "id", count="exact"
        ).eq("project_id", str(project_id)).eq("is_active", True).execute()
        site_count = sites_result.count or 0

        return db_row_to_project_response(result.data[0], site_count=site_count)
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
    Note: Only basic project info can be updated here.
    Control settings, logging, safe mode are managed at site level.
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

        if not update_data:
            # Nothing to update, just return current
            return await get_project(project_id, current_user, db)

        result = db.table("projects").update(update_data).eq("id", str(project_id)).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update project"
            )

        # Get site count
        sites_result = db.table("sites").select(
            "id", count="exact"
        ).eq("project_id", str(project_id)).eq("is_active", True).execute()
        site_count = sites_result.count or 0

        return db_row_to_project_response(result.data[0], site_count=site_count)
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
# These endpoints return deprecation errors.
# New code should use the /api/sites or /api/controllers router.
# ============================================

class ControllerInfo(BaseModel):
    """Controller registration info (for backward compatibility)."""
    serial_number: str
    hardware_type: str = "raspberry_pi_5"
    firmware_version: Optional[str] = None
    status: str = "offline"
    last_seen: Optional[str] = None


@router.post("/{project_id}/register-controller", deprecated=True)
async def register_controller(
    project_id: UUID,
    controller: ControllerInfo,
    current_user: CurrentUser = Depends(require_role(["super_admin", "admin"])),
    db: Client = Depends(get_supabase)
):
    """
    DEPRECATED: Controller registration is now done via /api/sites/{site_id}/register-controller.

    Projects no longer store controller info - use sites instead.
    """
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="This endpoint is deprecated. Use /api/sites/{site_id}/register-controller instead. "
               "Controller info is now stored at the site level, not project level."
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
    DEPRECATED: Heartbeats are now sent to /api/sites/{site_id}/heartbeat.

    Projects no longer track controller status - use sites instead.
    """
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="This endpoint is deprecated. Use /api/sites/{site_id}/heartbeat instead. "
               "Controller status is now tracked at the site level, not project level."
    )


@router.get("/{project_id}/config", deprecated=True)
async def get_project_config(
    project_id: UUID,
    db: Client = Depends(get_supabase)
):
    """
    DEPRECATED: Use /api/sites/{site_id}/config or /api/controllers/{controller_id}/config instead.

    This endpoint returns config from the first site in the project.
    All operational settings are now stored at the site level.
    """
    try:
        # Get first site for this project (backward compatibility)
        sites_result = db.table("sites").select("""
            id,
            name,
            location,
            operation_mode,
            dg_reserve_kw,
            control_interval_ms,
            logging_local_interval_ms,
            logging_cloud_interval_ms,
            logging_local_retention_days,
            safe_mode_enabled,
            safe_mode_type,
            safe_mode_timeout_s,
            safe_mode_rolling_window_min,
            safe_mode_threshold_pct
        """).eq("project_id", str(project_id)).eq("is_active", True).limit(1).execute()

        if not sites_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No sites found for project {project_id}. Create a site first."
            )

        site = sites_result.data[0]
        site_id = site["id"]

        # Get devices for this site
        devices_result = db.table("site_devices").select(
            "*, device_templates(*)"
        ).eq("site_id", str(site_id)).eq("enabled", True).execute()
        devices_result_data = devices_result.data or []

        # Build config structure from site data
        config = {
            "site": {
                "id": str(site_id),
                "name": site["name"],
                "location": site.get("location")
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
                "threshold_pct": float(site.get("safe_mode_threshold_pct", 80))
            },
            "devices": {
                "load_meters": [],
                "inverters": [],
                "generators": []
            }
        }

        # Categorize devices
        for device in devices_result_data:
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
            if device_type == "meter" or device_type == "load_meter" or device_type == "energy_meter":
                config["devices"]["load_meters"].append(device_config)
            elif device_type == "inverter":
                config["devices"]["inverters"].append(device_config)
            elif device_type == "dg" or device_type == "diesel_generator_controller":
                config["devices"]["generators"].append(device_config)

        return config
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get config: {str(e)}"
        )
