"""
Alarms Router

Handles system alarms and notifications:
- Alarm creation (from controller or system)
- Alarm queries and filtering
- Acknowledgment workflow
"""

from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel

from ..services.supabase import get_supabase
from ..services.notifications import create_alarm_notifications
from ..dependencies.auth import CurrentUser, get_current_user, require_project_access

router = APIRouter()


# ============================================
# ALARM TYPES
# ============================================

ALARM_TYPES = [
    "communication_lost",    # Device stopped responding
    "control_error",         # Error in control logic
    "safe_mode_triggered",   # Safe mode was activated
    "not_reporting",         # Device not sending data
    "controller_offline",    # Site controller missed heartbeat
    "write_failed",          # Modbus write operation failed
    "command_not_taken",     # Inverter didn't accept command
]

SEVERITY_LEVELS = ["info", "warning", "critical"]


# ============================================
# SCHEMAS
# ============================================

class AlarmCreate(BaseModel):
    """Create alarm request (from controller)."""
    alarm_type: str
    device_name: Optional[str] = None
    message: str
    severity: str = "warning"


class AlarmAcknowledge(BaseModel):
    """Acknowledge alarm request."""
    acknowledged_by: str  # User ID


class AlarmResponse(BaseModel):
    """Alarm response."""
    id: str
    project_id: str
    alarm_type: str
    device_name: Optional[str]
    message: str
    severity: str
    acknowledged: bool
    acknowledged_by: Optional[str]
    acknowledged_at: Optional[datetime]
    resolved: bool
    resolved_at: Optional[datetime]
    created_at: datetime


class AlarmStats(BaseModel):
    """Alarm statistics for a project."""
    total_alarms: int
    unacknowledged: int
    critical_count: int
    warning_count: int
    info_count: int


# ============================================
# HELPER FUNCTIONS
# ============================================

def row_to_alarm_response(row: dict) -> AlarmResponse:
    """Convert a database row to AlarmResponse."""
    return AlarmResponse(
        id=row["id"],
        project_id=row["project_id"],
        alarm_type=row["alarm_type"],
        device_name=row.get("device_name"),
        message=row["message"],
        severity=row["severity"],
        acknowledged=row.get("acknowledged", False),
        acknowledged_by=row.get("acknowledged_by"),
        acknowledged_at=row.get("acknowledged_at"),
        resolved=row.get("resolved", False),
        resolved_at=row.get("resolved_at"),
        created_at=row["created_at"]
    )


# ============================================
# ENDPOINTS - ALARM MANAGEMENT
# ============================================

@router.get("/{project_id}", response_model=list[AlarmResponse])
async def list_alarms(
    project_id: UUID,
    acknowledged: Optional[bool] = Query(None, description="Filter by acknowledged status"),
    severity: Optional[str] = Query(None, description="Filter by severity"),
    alarm_type: Optional[str] = Query(None, description="Filter by alarm type"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_user: CurrentUser = Depends(require_project_access()),
    supabase=Depends(get_supabase)
):
    """
    List alarms for a project.

    Supports filtering by:
    - acknowledged: true/false
    - severity: info, warning, critical
    - alarm_type: communication_lost, control_error, etc.

    Sorted by created_at descending (newest first).
    User must have access to the project.
    """
    # Validate severity if provided
    if severity and severity not in SEVERITY_LEVELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid severity. Must be one of: {SEVERITY_LEVELS}"
        )

    # Validate alarm_type if provided
    if alarm_type and alarm_type not in ALARM_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid alarm_type. Must be one of: {ALARM_TYPES}"
        )

    # Build query
    query = supabase.table("alarms").select("*").eq(
        "project_id", str(project_id)
    )

    # Apply optional filters
    if acknowledged is not None:
        query = query.eq("acknowledged", acknowledged)
    if severity:
        query = query.eq("severity", severity)
    if alarm_type:
        query = query.eq("alarm_type", alarm_type)

    # Order by newest first, apply pagination
    query = query.order("created_at", desc=True).range(offset, offset + limit - 1)

    result = query.execute()

    # Transform to response format
    return [row_to_alarm_response(row) for row in result.data]


@router.post("/{project_id}", response_model=AlarmResponse, status_code=status.HTTP_201_CREATED)
async def create_alarm(
    project_id: UUID,
    alarm: AlarmCreate,
    background_tasks: BackgroundTasks,
    supabase=Depends(get_supabase)
):
    """
    Create a new alarm.

    Called by the on-site controller when an alarm condition is detected.
    Also used internally for system alarms (e.g., controller offline).
    """
    # Validate alarm_type
    if alarm.alarm_type not in ALARM_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid alarm_type. Must be one of: {ALARM_TYPES}"
        )

    # Validate severity
    if alarm.severity not in SEVERITY_LEVELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid severity. Must be one of: {SEVERITY_LEVELS}"
        )

    # Verify project exists
    project_result = supabase.table("projects").select("id").eq(
        "id", str(project_id)
    ).execute()

    if not project_result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found"
        )

    # Create alarm record
    alarm_data = {
        "id": str(uuid4()),
        "project_id": str(project_id),
        "alarm_type": alarm.alarm_type,
        "device_name": alarm.device_name,
        "message": alarm.message,
        "severity": alarm.severity,
        "acknowledged": False,
        "resolved": False
    }

    result = supabase.table("alarms").insert(alarm_data).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create alarm"
        )

    # Create notifications for users with project access (runs in background)
    # This doesn't block the response - controller gets immediate confirmation
    background_tasks.add_task(
        create_alarm_notifications,
        supabase,
        alarm_data,
        str(project_id)
    )

    return row_to_alarm_response(result.data[0])


@router.get("/{project_id}/{alarm_id}", response_model=AlarmResponse)
async def get_alarm(
    project_id: UUID,
    alarm_id: UUID,
    current_user: CurrentUser = Depends(require_project_access()),
    supabase=Depends(get_supabase)
):
    """
    Get alarm details by ID.

    User must have access to the project.
    """
    result = supabase.table("alarms").select("*").eq(
        "id", str(alarm_id)
    ).eq(
        "project_id", str(project_id)
    ).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alarm {alarm_id} not found"
        )

    return row_to_alarm_response(result.data[0])


# ============================================
# ENDPOINTS - ACKNOWLEDGMENT
# ============================================

@router.post("/{project_id}/{alarm_id}/acknowledge", response_model=AlarmResponse)
async def acknowledge_alarm(
    project_id: UUID,
    alarm_id: UUID,
    current_user: CurrentUser = Depends(require_project_access()),
    supabase=Depends(get_supabase)
):
    """
    Acknowledge an alarm.

    Sets acknowledged=true and records who acknowledged it.
    User must have access to the project.
    """
    # First check if alarm exists and belongs to project
    check_result = supabase.table("alarms").select("id, acknowledged").eq(
        "id", str(alarm_id)
    ).eq(
        "project_id", str(project_id)
    ).execute()

    if not check_result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alarm {alarm_id} not found"
        )

    # Check if already acknowledged
    if check_result.data[0].get("acknowledged"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Alarm is already acknowledged"
        )

    # Update the alarm - use current_user.id for acknowledgment
    result = supabase.table("alarms").update({
        "acknowledged": True,
        "acknowledged_by": current_user.id,
        "acknowledged_at": datetime.utcnow().isoformat()
    }).eq("id", str(alarm_id)).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to acknowledge alarm"
        )

    return row_to_alarm_response(result.data[0])


@router.post("/{project_id}/acknowledge-all")
async def acknowledge_all_alarms(
    project_id: UUID,
    severity: Optional[str] = Query(None, description="Only acknowledge this severity"),
    current_user: CurrentUser = Depends(require_project_access()),
    supabase=Depends(get_supabase)
):
    """
    Acknowledge all unacknowledged alarms for a project.

    Optionally filter by severity level.
    User must have access to the project.
    """
    if severity and severity not in SEVERITY_LEVELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid severity. Must be one of: {SEVERITY_LEVELS}"
        )

    # Build query for unacknowledged alarms
    query = supabase.table("alarms").select("id").eq(
        "project_id", str(project_id)
    ).eq(
        "acknowledged", False
    )

    if severity:
        query = query.eq("severity", severity)

    # Get count of alarms to acknowledge
    count_result = query.execute()
    count = len(count_result.data) if count_result.data else 0

    if count == 0:
        return {
            "status": "acknowledged",
            "count": 0,
            "message": "No unacknowledged alarms found"
        }

    # Build update query - use current_user.id for acknowledgment
    update_query = supabase.table("alarms").update({
        "acknowledged": True,
        "acknowledged_by": current_user.id,
        "acknowledged_at": datetime.utcnow().isoformat()
    }).eq(
        "project_id", str(project_id)
    ).eq(
        "acknowledged", False
    )

    if severity:
        update_query = update_query.eq("severity", severity)

    # Execute update
    update_query.execute()

    return {
        "status": "acknowledged",
        "count": count
    }


@router.post("/{project_id}/{alarm_id}/resolve", response_model=AlarmResponse)
async def resolve_alarm(
    project_id: UUID,
    alarm_id: UUID,
    current_user: CurrentUser = Depends(require_project_access()),
    supabase=Depends(get_supabase)
):
    """
    Mark an alarm as resolved.

    Sets resolved=true and resolved_at to current time.
    User must have access to the project.
    """
    # First check if alarm exists and belongs to project
    check_result = supabase.table("alarms").select("id, resolved").eq(
        "id", str(alarm_id)
    ).eq(
        "project_id", str(project_id)
    ).execute()

    if not check_result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alarm {alarm_id} not found"
        )

    # Check if already resolved
    if check_result.data[0].get("resolved"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Alarm is already resolved"
        )

    # Update the alarm
    result = supabase.table("alarms").update({
        "resolved": True,
        "resolved_at": datetime.utcnow().isoformat()
    }).eq("id", str(alarm_id)).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to resolve alarm"
        )

    return row_to_alarm_response(result.data[0])


# ============================================
# ENDPOINTS - STATISTICS
# ============================================

@router.get("/{project_id}/stats", response_model=AlarmStats)
async def get_alarm_stats(
    project_id: UUID,
    current_user: CurrentUser = Depends(require_project_access()),
    supabase=Depends(get_supabase)
):
    """
    Get alarm statistics for a project.

    Returns counts by severity and acknowledgment status.
    User must have access to the project.
    """
    # Query all alarms for the project
    result = supabase.table("alarms").select(
        "severity, acknowledged"
    ).eq(
        "project_id", str(project_id)
    ).execute()

    if not result.data:
        return AlarmStats(
            total_alarms=0,
            unacknowledged=0,
            critical_count=0,
            warning_count=0,
            info_count=0
        )

    # Calculate statistics
    total_alarms = len(result.data)
    unacknowledged = sum(1 for r in result.data if not r.get("acknowledged", False))
    critical_count = sum(1 for r in result.data if r.get("severity") == "critical")
    warning_count = sum(1 for r in result.data if r.get("severity") == "warning")
    info_count = sum(1 for r in result.data if r.get("severity") == "info")

    return AlarmStats(
        total_alarms=total_alarms,
        unacknowledged=unacknowledged,
        critical_count=critical_count,
        warning_count=warning_count,
        info_count=info_count
    )


@router.get("/{project_id}/unacknowledged/count")
async def get_unacknowledged_count(
    project_id: UUID,
    current_user: CurrentUser = Depends(require_project_access()),
    supabase=Depends(get_supabase)
):
    """
    Get count of unacknowledged alarms.

    Useful for dashboard badge display.
    User must have access to the project.
    """
    result = supabase.table("alarms").select("id").eq(
        "project_id", str(project_id)
    ).eq(
        "acknowledged", False
    ).execute()

    count = len(result.data) if result.data else 0

    return {"count": count}
