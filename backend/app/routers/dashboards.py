"""
Dashboards Router

Handles customizable site dashboards:
- Dashboard configuration (grid size, refresh interval)
- Widget management (CRUD operations)
- Live data endpoint for real-time values
- Batch widget position updates

Dashboards allow users to create visual layouts showing
site schematics with live data from device registers.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
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

class DashboardConfig(BaseModel):
    """Dashboard configuration."""
    name: str = "Main Dashboard"
    grid_columns: int = Field(default=12, ge=4, le=24)
    grid_rows: int = Field(default=8, ge=4, le=20)
    refresh_interval_seconds: int = Field(default=30, ge=5, le=300)


class DashboardCreate(BaseModel):
    """Create dashboard request."""
    name: str = "Main Dashboard"
    grid_columns: int = Field(default=12, ge=4, le=24)
    grid_rows: int = Field(default=8, ge=4, le=20)
    refresh_interval_seconds: int = Field(default=30, ge=5, le=300)


class DashboardUpdate(BaseModel):
    """Update dashboard request."""
    name: Optional[str] = None
    grid_columns: Optional[int] = Field(default=None, ge=4, le=24)
    grid_rows: Optional[int] = Field(default=None, ge=4, le=20)
    refresh_interval_seconds: Optional[int] = Field(default=None, ge=5, le=300)


class DashboardResponse(BaseModel):
    """Dashboard response."""
    id: str
    site_id: str
    name: str
    grid_columns: int
    grid_rows: int
    refresh_interval_seconds: int
    created_at: str
    updated_at: str
    created_by: Optional[str]
    updated_by: Optional[str]


class WidgetConfig(BaseModel):
    """Widget configuration - flexible JSONB structure."""
    icon_id: Optional[str] = None
    label: Optional[str] = None
    linked_device_id: Optional[str] = None
    linked_registers: Optional[List[Dict[str, Any]]] = None
    color: Optional[str] = None
    device_id: Optional[str] = None
    register_name: Optional[str] = None
    unit: Optional[str] = None
    decimals: Optional[int] = None
    thresholds: Optional[Dict[str, float]] = None
    chart_type: Optional[str] = None
    title: Optional[str] = None
    time_range: Optional[str] = None
    series: Optional[List[Dict[str, Any]]] = None
    max_items: Optional[int] = None
    severities: Optional[List[str]] = None
    show_resolved: Optional[bool] = None
    show_online_status: Optional[bool] = None
    show_last_seen: Optional[bool] = None

    class Config:
        extra = "allow"  # Allow additional fields


class WidgetCreate(BaseModel):
    """Create widget request."""
    widget_type: str  # 'icon', 'value_display', 'chart', 'alarm_list', 'status_indicator'
    grid_row: int = Field(ge=1)
    grid_col: int = Field(ge=1)
    grid_width: int = Field(default=1, ge=1)
    grid_height: int = Field(default=1, ge=1)
    config: Dict[str, Any] = {}
    z_index: int = 0


class WidgetUpdate(BaseModel):
    """Update widget request."""
    widget_type: Optional[str] = None
    grid_row: Optional[int] = Field(default=None, ge=1)
    grid_col: Optional[int] = Field(default=None, ge=1)
    grid_width: Optional[int] = Field(default=None, ge=1)
    grid_height: Optional[int] = Field(default=None, ge=1)
    config: Optional[Dict[str, Any]] = None
    z_index: Optional[int] = None


class WidgetResponse(BaseModel):
    """Widget response."""
    id: str
    dashboard_id: str
    widget_type: str
    grid_row: int
    grid_col: int
    grid_width: int
    grid_height: int
    config: Dict[str, Any]
    z_index: int
    created_at: str
    updated_at: str


class WidgetPositionUpdate(BaseModel):
    """Widget position update for batch operations."""
    id: str
    grid_row: int = Field(ge=1)
    grid_col: int = Field(ge=1)
    grid_width: int = Field(default=1, ge=1)
    grid_height: int = Field(default=1, ge=1)


class BatchPositionUpdate(BaseModel):
    """Batch position update request."""
    widgets: List[WidgetPositionUpdate]


class RegisterValue(BaseModel):
    """Single register value."""
    value: Optional[float] = None
    unit: Optional[str] = None
    timestamp: Optional[str] = None


class DeviceStatus(BaseModel):
    """Device online status."""
    is_online: bool
    last_seen: Optional[str] = None


class LiveDataResponse(BaseModel):
    """Live data response for dashboard."""
    timestamp: str
    registers: Dict[str, Dict[str, RegisterValue]]  # device_id -> register_name -> value
    device_status: Dict[str, DeviceStatus]  # device_id -> status


# ============================================
# HELPER FUNCTIONS
# ============================================

async def verify_site_access(
    supabase: Client,
    site_id: str,
    user: CurrentUser,
    require_edit: bool = False
) -> dict:
    """Verify user has access to site. Returns site data if authorized."""
    # Fetch site with project info
    result = supabase.table("sites").select("*, projects(enterprise_id)").eq("id", site_id).single().execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Site not found"
        )

    site = result.data

    # Super admins, backend admins, and admins have full access
    if user.role in ["super_admin", "backend_admin", "admin"]:
        return site

    # Enterprise admins have access to their enterprise's projects
    if user.role == "enterprise_admin":
        project_enterprise = site.get("projects", {}).get("enterprise_id")
        if project_enterprise == user.enterprise_id:
            return site

    # Check user_projects assignment
    project_id = site["project_id"]
    assignment = supabase.table("user_projects").select("*").eq(
        "user_id", str(user.id)
    ).eq("project_id", project_id).single().execute()

    if not assignment.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this site"
        )

    # Check edit permission if required
    if require_edit and not assignment.data.get("can_edit", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Edit permission required"
        )

    return site


def row_to_dashboard_response(row: dict) -> DashboardResponse:
    """Convert database row to DashboardResponse."""
    return DashboardResponse(
        id=str(row["id"]),
        site_id=str(row["site_id"]),
        name=row.get("name", "Main Dashboard"),
        grid_columns=row.get("grid_columns", 12),
        grid_rows=row.get("grid_rows", 8),
        refresh_interval_seconds=row.get("refresh_interval_seconds", 30),
        created_at=row.get("created_at", ""),
        updated_at=row.get("updated_at", ""),
        created_by=str(row["created_by"]) if row.get("created_by") else None,
        updated_by=str(row["updated_by"]) if row.get("updated_by") else None,
    )


def row_to_widget_response(row: dict) -> WidgetResponse:
    """Convert database row to WidgetResponse."""
    return WidgetResponse(
        id=str(row["id"]),
        dashboard_id=str(row["dashboard_id"]),
        widget_type=row["widget_type"],
        grid_row=row["grid_row"],
        grid_col=row["grid_col"],
        grid_width=row.get("grid_width", 1),
        grid_height=row.get("grid_height", 1),
        config=row.get("config", {}),
        z_index=row.get("z_index", 0),
        created_at=row.get("created_at", ""),
        updated_at=row.get("updated_at", ""),
    )


# ============================================
# DASHBOARD ENDPOINTS
# ============================================

@router.get("/site/{site_id}", response_model=DashboardResponse)
async def get_dashboard(
    site_id: str,
    supabase: Client = Depends(get_supabase),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Get dashboard for a site.
    Creates default dashboard if none exists.
    """
    await verify_site_access(supabase, site_id, user)

    # Try to fetch existing dashboard
    result = supabase.table("site_dashboards").select("*").eq("site_id", site_id).single().execute()

    if result.data:
        return row_to_dashboard_response(result.data)

    # Create default dashboard if none exists
    new_dashboard = {
        "site_id": site_id,
        "name": "Main Dashboard",
        "grid_columns": 12,
        "grid_rows": 8,
        "refresh_interval_seconds": 30,
        "created_by": str(user.id),
        "updated_by": str(user.id),
    }

    create_result = supabase.table("site_dashboards").insert(new_dashboard).execute()

    if not create_result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create dashboard"
        )

    return row_to_dashboard_response(create_result.data[0])


@router.post("/site/{site_id}", response_model=DashboardResponse)
async def create_or_update_dashboard(
    site_id: str,
    data: DashboardCreate,
    supabase: Client = Depends(get_supabase),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Create or update dashboard for a site.
    Requires edit permission (Configurator+).
    """
    await verify_site_access(supabase, site_id, user, require_edit=True)

    # Check if dashboard exists
    existing = supabase.table("site_dashboards").select("id").eq("site_id", site_id).single().execute()

    if existing.data:
        # Update existing
        update_data = {
            "name": data.name,
            "grid_columns": data.grid_columns,
            "grid_rows": data.grid_rows,
            "refresh_interval_seconds": data.refresh_interval_seconds,
            "updated_by": str(user.id),
        }

        result = supabase.table("site_dashboards").update(update_data).eq(
            "id", existing.data["id"]
        ).execute()
    else:
        # Create new
        new_dashboard = {
            "site_id": site_id,
            "name": data.name,
            "grid_columns": data.grid_columns,
            "grid_rows": data.grid_rows,
            "refresh_interval_seconds": data.refresh_interval_seconds,
            "created_by": str(user.id),
            "updated_by": str(user.id),
        }

        result = supabase.table("site_dashboards").insert(new_dashboard).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save dashboard"
        )

    return row_to_dashboard_response(result.data[0])


# ============================================
# WIDGET ENDPOINTS
# ============================================

@router.get("/site/{site_id}/widgets", response_model=List[WidgetResponse])
async def get_widgets(
    site_id: str,
    supabase: Client = Depends(get_supabase),
    user: CurrentUser = Depends(get_current_user),
):
    """Get all widgets for a site's dashboard."""
    await verify_site_access(supabase, site_id, user)

    # Get dashboard ID
    dashboard = supabase.table("site_dashboards").select("id").eq("site_id", site_id).single().execute()

    if not dashboard.data:
        return []  # No dashboard yet = no widgets

    # Fetch widgets
    widgets = supabase.table("dashboard_widgets").select("*").eq(
        "dashboard_id", dashboard.data["id"]
    ).order("z_index", desc=False).execute()

    return [row_to_widget_response(w) for w in (widgets.data or [])]


@router.post("/site/{site_id}/widgets", response_model=WidgetResponse)
async def create_widget(
    site_id: str,
    data: WidgetCreate,
    supabase: Client = Depends(get_supabase),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Add a widget to the dashboard.
    Requires edit permission (Configurator+).
    Max 30 widgets per dashboard.
    """
    await verify_site_access(supabase, site_id, user, require_edit=True)

    # Get or create dashboard
    dashboard = supabase.table("site_dashboards").select("id").eq("site_id", site_id).single().execute()

    if not dashboard.data:
        # Create default dashboard first
        new_dash = supabase.table("site_dashboards").insert({
            "site_id": site_id,
            "created_by": str(user.id),
            "updated_by": str(user.id),
        }).execute()
        dashboard_id = new_dash.data[0]["id"]
    else:
        dashboard_id = dashboard.data["id"]

    # Check widget count (max 30)
    count_result = supabase.table("dashboard_widgets").select(
        "id", count="exact"
    ).eq("dashboard_id", dashboard_id).execute()

    if count_result.count and count_result.count >= 30:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum 30 widgets per dashboard"
        )

    # Create widget
    widget_data = {
        "dashboard_id": dashboard_id,
        "widget_type": data.widget_type,
        "grid_row": data.grid_row,
        "grid_col": data.grid_col,
        "grid_width": data.grid_width,
        "grid_height": data.grid_height,
        "config": data.config,
        "z_index": data.z_index,
    }

    result = supabase.table("dashboard_widgets").insert(widget_data).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create widget"
        )

    return row_to_widget_response(result.data[0])


@router.patch("/site/{site_id}/widgets/{widget_id}", response_model=WidgetResponse)
async def update_widget(
    site_id: str,
    widget_id: str,
    data: WidgetUpdate,
    supabase: Client = Depends(get_supabase),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Update a widget.
    Requires edit permission (Configurator+).
    """
    await verify_site_access(supabase, site_id, user, require_edit=True)

    # Verify widget belongs to this site's dashboard
    widget = supabase.table("dashboard_widgets").select(
        "*, site_dashboards!inner(site_id)"
    ).eq("id", widget_id).single().execute()

    if not widget.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Widget not found"
        )

    if str(widget.data["site_dashboards"]["site_id"]) != site_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Widget does not belong to this site"
        )

    # Build update data (only include non-None fields)
    update_data = {}
    if data.widget_type is not None:
        update_data["widget_type"] = data.widget_type
    if data.grid_row is not None:
        update_data["grid_row"] = data.grid_row
    if data.grid_col is not None:
        update_data["grid_col"] = data.grid_col
    if data.grid_width is not None:
        update_data["grid_width"] = data.grid_width
    if data.grid_height is not None:
        update_data["grid_height"] = data.grid_height
    if data.config is not None:
        update_data["config"] = data.config
    if data.z_index is not None:
        update_data["z_index"] = data.z_index

    if not update_data:
        # No updates, return existing widget
        return row_to_widget_response(widget.data)

    result = supabase.table("dashboard_widgets").update(update_data).eq("id", widget_id).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update widget"
        )

    return row_to_widget_response(result.data[0])


@router.delete("/site/{site_id}/widgets/{widget_id}")
async def delete_widget(
    site_id: str,
    widget_id: str,
    supabase: Client = Depends(get_supabase),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Delete a widget.
    Requires edit permission (Configurator+).
    """
    await verify_site_access(supabase, site_id, user, require_edit=True)

    # Verify widget belongs to this site's dashboard
    widget = supabase.table("dashboard_widgets").select(
        "id, site_dashboards!inner(site_id)"
    ).eq("id", widget_id).single().execute()

    if not widget.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Widget not found"
        )

    if str(widget.data["site_dashboards"]["site_id"]) != site_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Widget does not belong to this site"
        )

    supabase.table("dashboard_widgets").delete().eq("id", widget_id).execute()

    return {"status": "deleted"}


@router.put("/site/{site_id}/widgets/batch", response_model=List[WidgetResponse])
async def batch_update_positions(
    site_id: str,
    data: BatchPositionUpdate,
    supabase: Client = Depends(get_supabase),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Batch update widget positions (for drag-and-drop).
    Requires edit permission (Configurator+).
    """
    await verify_site_access(supabase, site_id, user, require_edit=True)

    # Get dashboard
    dashboard = supabase.table("site_dashboards").select("id").eq("site_id", site_id).single().execute()

    if not dashboard.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dashboard not found"
        )

    dashboard_id = dashboard.data["id"]

    # Update each widget position
    updated_widgets = []
    for widget_update in data.widgets:
        result = supabase.table("dashboard_widgets").update({
            "grid_row": widget_update.grid_row,
            "grid_col": widget_update.grid_col,
            "grid_width": widget_update.grid_width,
            "grid_height": widget_update.grid_height,
        }).eq("id", widget_update.id).eq("dashboard_id", dashboard_id).execute()

        if result.data:
            updated_widgets.append(row_to_widget_response(result.data[0]))

    return updated_widgets


# ============================================
# LIVE DATA ENDPOINT
# ============================================

@router.get("/site/{site_id}/live-data", response_model=LiveDataResponse)
async def get_live_data(
    site_id: str,
    supabase: Client = Depends(get_supabase),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Get current values for all devices/registers linked to dashboard widgets.
    This endpoint is called periodically by the frontend for live updates.
    """
    await verify_site_access(supabase, site_id, user)

    # Get dashboard and widgets
    dashboard = supabase.table("site_dashboards").select("id").eq("site_id", site_id).single().execute()

    if not dashboard.data:
        # No dashboard, return empty data
        return LiveDataResponse(
            timestamp=datetime.utcnow().isoformat() + "Z",
            registers={},
            device_status={},
        )

    # Get all widgets
    widgets = supabase.table("dashboard_widgets").select("config").eq(
        "dashboard_id", dashboard.data["id"]
    ).execute()

    # Extract unique device IDs from widget configs
    device_ids = set()
    for w in (widgets.data or []):
        config = w.get("config", {})
        if config.get("device_id"):
            device_ids.add(config["device_id"])
        if config.get("linked_device_id"):
            device_ids.add(config["linked_device_id"])
        # Extract from chart series
        for series in config.get("series", []):
            if series.get("device_id"):
                device_ids.add(series["device_id"])

    if not device_ids:
        return LiveDataResponse(
            timestamp=datetime.utcnow().isoformat() + "Z",
            registers={},
            device_status={},
        )

    # Fetch device status
    devices = supabase.table("project_devices").select(
        "id, is_online, last_seen"
    ).in_("id", list(device_ids)).execute()

    device_status = {}
    for d in (devices.data or []):
        device_status[str(d["id"])] = DeviceStatus(
            is_online=d.get("is_online", False),
            last_seen=d.get("last_seen"),
        )

    # Fetch latest readings from device_readings table
    # Group by device_id and get most recent value per register
    registers: Dict[str, Dict[str, RegisterValue]] = {}

    for device_id in device_ids:
        readings = supabase.table("device_readings").select(
            "register_name, value, unit, timestamp"
        ).eq("device_id", device_id).order(
            "timestamp", desc=True
        ).limit(50).execute()  # Get recent readings

        if readings.data:
            # Group by register_name, keep latest
            device_registers: Dict[str, RegisterValue] = {}
            seen_registers = set()

            for r in readings.data:
                reg_name = r["register_name"]
                if reg_name not in seen_registers:
                    seen_registers.add(reg_name)
                    device_registers[reg_name] = RegisterValue(
                        value=r.get("value"),
                        unit=r.get("unit"),
                        timestamp=r.get("timestamp"),
                    )

            if device_registers:
                registers[device_id] = device_registers

    # Also try to get aggregate data from control_logs for totals
    latest_log = supabase.table("control_logs").select(
        "total_load_kw, solar_output_kw, dg_power_kw, solar_limit_pct, timestamp"
    ).eq("site_id", site_id).order("timestamp", desc=True).limit(1).execute()

    # Add aggregate values as a special "site" entry
    if latest_log.data:
        log = latest_log.data[0]
        registers["_site_aggregate"] = {
            "total_load_kw": RegisterValue(
                value=log.get("total_load_kw"),
                unit="kW",
                timestamp=log.get("timestamp"),
            ),
            "solar_output_kw": RegisterValue(
                value=log.get("solar_output_kw"),
                unit="kW",
                timestamp=log.get("timestamp"),
            ),
            "dg_power_kw": RegisterValue(
                value=log.get("dg_power_kw"),
                unit="kW",
                timestamp=log.get("timestamp"),
            ),
            "solar_limit_pct": RegisterValue(
                value=log.get("solar_limit_pct"),
                unit="%",
                timestamp=log.get("timestamp"),
            ),
        }

    return LiveDataResponse(
        timestamp=datetime.utcnow().isoformat() + "Z",
        registers=registers,
        device_status=device_status,
    )
