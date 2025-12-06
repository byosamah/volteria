"""
Control Logs Router

Handles control log data:
- Receiving logs from site controllers
- Querying historical data
- Data export
"""

import csv
import io
import json
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..services.supabase import get_supabase
from ..dependencies.auth import CurrentUser, require_project_access

router = APIRouter()


# ============================================
# SCHEMAS
# ============================================

class ControlLogEntry(BaseModel):
    """Single control log entry from controller."""
    timestamp: datetime
    total_load_kw: Optional[float] = None
    dg_power_kw: Optional[float] = None
    solar_output_kw: Optional[float] = None
    solar_limit_pct: Optional[float] = None
    available_headroom_kw: Optional[float] = None
    safe_mode_active: bool = False
    config_mode: Optional[str] = None  # 'meter_inverter', 'dg_inverter', 'full_system'
    load_meters_online: int = 0
    inverters_online: int = 0
    generators_online: int = 0
    raw_data: Optional[dict] = None


class ControlLogBatch(BaseModel):
    """Batch of log entries from controller."""
    entries: list[ControlLogEntry]


class ControlLogResponse(BaseModel):
    """Control log response for queries."""
    id: int
    project_id: str
    timestamp: datetime
    total_load_kw: Optional[float]
    dg_power_kw: Optional[float]
    solar_output_kw: Optional[float]
    solar_limit_pct: Optional[float]
    available_headroom_kw: Optional[float]
    safe_mode_active: bool
    config_mode: Optional[str]


class LogStats(BaseModel):
    """Statistics for a time period."""
    period_start: datetime
    period_end: datetime
    total_records: int
    avg_load_kw: Optional[float]
    max_load_kw: Optional[float]
    avg_solar_output_kw: Optional[float]
    max_solar_output_kw: Optional[float]
    avg_solar_limit_pct: Optional[float]
    safe_mode_triggers: int


# ============================================
# ENDPOINTS - DATA INGESTION
# ============================================

@router.post("/{project_id}/push", status_code=status.HTTP_201_CREATED)
async def push_logs(
    project_id: UUID,
    batch: ControlLogBatch,
    supabase=Depends(get_supabase)
):
    """
    Receive batch of control logs from site controller.

    Called periodically by the on-site controller to sync
    buffered data to the cloud. Handles:
    - Batch inserts for efficiency
    - Duplicate detection (by timestamp)
    - Offline data sync (timestamps preserved)
    """
    # First verify the project exists
    project_result = supabase.table("projects").select("id").eq(
        "id", str(project_id)
    ).execute()

    if not project_result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found"
        )

    # Prepare batch data for insert
    # Each entry becomes a row in control_logs table
    log_entries = []
    for entry in batch.entries:
        log_entries.append({
            "project_id": str(project_id),
            "timestamp": entry.timestamp.isoformat(),
            "total_load_kw": entry.total_load_kw,
            "dg_power_kw": entry.dg_power_kw,
            "solar_output_kw": entry.solar_output_kw,
            "solar_limit_pct": entry.solar_limit_pct,
            "available_headroom_kw": entry.available_headroom_kw,
            "safe_mode_active": entry.safe_mode_active,
            "config_mode": entry.config_mode,
            "load_meters_online": entry.load_meters_online,
            "inverters_online": entry.inverters_online,
            "generators_online": entry.generators_online,
            "raw_data": entry.raw_data
        })

    # Batch insert all entries
    # Using upsert to handle duplicates (same project_id + timestamp)
    if log_entries:
        result = supabase.table("control_logs").upsert(
            log_entries,
            on_conflict="project_id,timestamp"  # Assumes unique constraint on these columns
        ).execute()

    return {
        "status": "received",
        "project_id": str(project_id),
        "entries_received": len(batch.entries)
    }


# ============================================
# ENDPOINTS - DATA QUERIES
# ============================================

@router.get("/{project_id}", response_model=list[ControlLogResponse])
async def get_logs(
    project_id: UUID,
    start: Optional[datetime] = Query(None, description="Start time (ISO format)"),
    end: Optional[datetime] = Query(None, description="End time (ISO format)"),
    limit: int = Query(1000, ge=1, le=10000),
    offset: int = Query(0, ge=0),
    current_user: CurrentUser = Depends(require_project_access()),
    supabase=Depends(get_supabase)
):
    """
    Query control logs for a project.

    Returns logs within the specified time range.
    Sorted by timestamp descending (newest first).
    User must have access to the project.
    """
    # Build query
    query = supabase.table("control_logs").select(
        "id, project_id, timestamp, total_load_kw, dg_power_kw, "
        "solar_output_kw, solar_limit_pct, available_headroom_kw, "
        "safe_mode_active, config_mode"
    ).eq("project_id", str(project_id))

    # Apply time range filters if provided
    if start:
        query = query.gte("timestamp", start.isoformat())
    if end:
        query = query.lte("timestamp", end.isoformat())

    # Order by timestamp descending, apply pagination
    query = query.order("timestamp", desc=True).range(offset, offset + limit - 1)

    result = query.execute()

    # Transform to response format
    logs = []
    for row in result.data:
        logs.append(ControlLogResponse(
            id=row["id"],
            project_id=row["project_id"],
            timestamp=row["timestamp"],
            total_load_kw=row.get("total_load_kw"),
            dg_power_kw=row.get("dg_power_kw"),
            solar_output_kw=row.get("solar_output_kw"),
            solar_limit_pct=row.get("solar_limit_pct"),
            available_headroom_kw=row.get("available_headroom_kw"),
            safe_mode_active=row.get("safe_mode_active", False),
            config_mode=row.get("config_mode")
        ))

    return logs


@router.get("/{project_id}/latest", response_model=ControlLogResponse)
async def get_latest_log(
    project_id: UUID,
    current_user: CurrentUser = Depends(require_project_access()),
    supabase=Depends(get_supabase)
):
    """
    Get the most recent control log entry.

    Useful for dashboard real-time display.
    User must have access to the project.
    """
    result = supabase.table("control_logs").select(
        "id, project_id, timestamp, total_load_kw, dg_power_kw, "
        "solar_output_kw, solar_limit_pct, available_headroom_kw, "
        "safe_mode_active, config_mode"
    ).eq(
        "project_id", str(project_id)
    ).order(
        "timestamp", desc=True
    ).limit(1).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No logs found for this project"
        )

    row = result.data[0]
    return ControlLogResponse(
        id=row["id"],
        project_id=row["project_id"],
        timestamp=row["timestamp"],
        total_load_kw=row.get("total_load_kw"),
        dg_power_kw=row.get("dg_power_kw"),
        solar_output_kw=row.get("solar_output_kw"),
        solar_limit_pct=row.get("solar_limit_pct"),
        available_headroom_kw=row.get("available_headroom_kw"),
        safe_mode_active=row.get("safe_mode_active", False),
        config_mode=row.get("config_mode")
    )


@router.get("/{project_id}/stats", response_model=LogStats)
async def get_log_stats(
    project_id: UUID,
    start: datetime = Query(..., description="Start time (required)"),
    end: datetime = Query(..., description="End time (required)"),
    current_user: CurrentUser = Depends(require_project_access()),
    supabase=Depends(get_supabase)
):
    """
    Get statistics for a time period.

    Returns aggregated metrics like average load,
    max solar output, safe mode triggers, etc.
    User must have access to the project.
    """
    # Query logs within time range
    result = supabase.table("control_logs").select(
        "total_load_kw, solar_output_kw, solar_limit_pct, safe_mode_active"
    ).eq(
        "project_id", str(project_id)
    ).gte(
        "timestamp", start.isoformat()
    ).lte(
        "timestamp", end.isoformat()
    ).execute()

    if not result.data:
        return LogStats(
            period_start=start,
            period_end=end,
            total_records=0,
            avg_load_kw=None,
            max_load_kw=None,
            avg_solar_output_kw=None,
            max_solar_output_kw=None,
            avg_solar_limit_pct=None,
            safe_mode_triggers=0
        )

    # Calculate statistics from the data
    # Note: Supabase doesn't support aggregate functions directly in client,
    # so we calculate in Python. For production, consider using RPC functions.

    total_records = len(result.data)

    # Extract values, filtering out None
    loads = [r["total_load_kw"] for r in result.data if r.get("total_load_kw") is not None]
    solar_outputs = [r["solar_output_kw"] for r in result.data if r.get("solar_output_kw") is not None]
    solar_limits = [r["solar_limit_pct"] for r in result.data if r.get("solar_limit_pct") is not None]
    safe_mode_triggers = sum(1 for r in result.data if r.get("safe_mode_active"))

    return LogStats(
        period_start=start,
        period_end=end,
        total_records=total_records,
        avg_load_kw=sum(loads) / len(loads) if loads else None,
        max_load_kw=max(loads) if loads else None,
        avg_solar_output_kw=sum(solar_outputs) / len(solar_outputs) if solar_outputs else None,
        max_solar_output_kw=max(solar_outputs) if solar_outputs else None,
        avg_solar_limit_pct=sum(solar_limits) / len(solar_limits) if solar_limits else None,
        safe_mode_triggers=safe_mode_triggers
    )


# ============================================
# ENDPOINTS - DATA EXPORT
# ============================================

@router.get("/{project_id}/export")
async def export_logs(
    project_id: UUID,
    start: datetime = Query(..., description="Start time (required)"),
    end: datetime = Query(..., description="End time (required)"),
    format: str = Query("csv", description="Export format: csv or json"),
    current_user: CurrentUser = Depends(require_project_access()),
    supabase=Depends(get_supabase)
):
    """
    Export control logs for download.

    Returns data in CSV or JSON format for the specified time range.
    Useful for offline analysis or reporting.
    User must have access to the project.
    """
    if format not in ["csv", "json"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Format must be 'csv' or 'json'"
        )

    # Query all logs in time range (no pagination for export)
    result = supabase.table("control_logs").select(
        "timestamp, total_load_kw, dg_power_kw, solar_output_kw, "
        "solar_limit_pct, available_headroom_kw, safe_mode_active, config_mode"
    ).eq(
        "project_id", str(project_id)
    ).gte(
        "timestamp", start.isoformat()
    ).lte(
        "timestamp", end.isoformat()
    ).order(
        "timestamp", desc=False  # Ascending for export (oldest first)
    ).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No logs found for the specified time range"
        )

    # Generate filename
    filename = f"control_logs_{project_id}_{start.date()}_{end.date()}"

    if format == "json":
        # Return JSON file
        json_content = json.dumps(result.data, indent=2, default=str)
        return StreamingResponse(
            io.BytesIO(json_content.encode()),
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}.json"'
            }
        )
    else:
        # Return CSV file
        output = io.StringIO()

        # Define CSV columns
        fieldnames = [
            "timestamp", "total_load_kw", "dg_power_kw", "solar_output_kw",
            "solar_limit_pct", "available_headroom_kw", "safe_mode_active", "config_mode"
        ]

        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()

        for row in result.data:
            writer.writerow({
                "timestamp": row.get("timestamp"),
                "total_load_kw": row.get("total_load_kw", ""),
                "dg_power_kw": row.get("dg_power_kw", ""),
                "solar_output_kw": row.get("solar_output_kw", ""),
                "solar_limit_pct": row.get("solar_limit_pct", ""),
                "available_headroom_kw": row.get("available_headroom_kw", ""),
                "safe_mode_active": row.get("safe_mode_active", ""),
                "config_mode": row.get("config_mode", "")
            })

        output.seek(0)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode()),
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}.csv"'
            }
        )


# ============================================
# ENDPOINTS - REAL-TIME (Future)
# ============================================

# TODO: Add WebSocket endpoint for real-time log streaming
# @router.websocket("/{project_id}/stream")
# async def stream_logs(project_id: UUID, websocket: WebSocket):
#     """Stream logs in real-time via WebSocket."""
#     pass
