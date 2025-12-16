"""
Usage Router

Handles data usage and storage analytics:
- System-wide usage summary (super/backend_admin)
- Per-enterprise usage with package info
- Historical usage snapshots for charts
- Manual usage recalculation trigger
- Package listing

For billing, storage management, and enterprise capacity planning.
"""

from datetime import date, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from supabase import Client

from app.services.supabase import get_supabase
from app.dependencies.auth import (
    CurrentUser,
    require_role,
)

router = APIRouter()


# ============================================
# SCHEMAS
# ============================================

class UsagePackageResponse(BaseModel):
    """Usage package details."""
    id: str
    name: str
    description: Optional[str]
    storage_limit_bytes: int
    storage_limit_gb: float  # Convenience field
    bandwidth_limit_bytes: Optional[int]
    max_sites: Optional[int]
    max_controllers: Optional[int]
    max_users: Optional[int]
    price_monthly: Optional[float]
    is_active: bool


class EnterpriseUsageResponse(BaseModel):
    """Enterprise usage summary."""
    enterprise_id: str
    enterprise_name: str

    # Package info
    package_id: Optional[str]
    package_name: Optional[str]
    storage_limit_bytes: Optional[int]
    storage_limit_gb: Optional[float]

    # Current usage
    total_storage_bytes: int
    total_storage_gb: float
    storage_usage_percent: float

    # Breakdown by category
    control_logs_bytes: int
    control_logs_rows: int
    alarms_bytes: int
    alarms_rows: int
    heartbeats_bytes: int
    audit_logs_bytes: int

    # Resource counts
    sites_count: int
    controllers_count: int
    users_count: int

    # Status
    warning_level: str  # normal, approaching, exceeded, critical
    grace_period_start: Optional[str]

    # Last updated
    snapshot_date: Optional[str]


class UsageSummaryResponse(BaseModel):
    """System-wide usage summary."""
    total_enterprises: int
    active_enterprises: int

    # Total storage across all enterprises
    total_storage_bytes: int
    total_storage_gb: float

    # Growth (compared to 30 days ago)
    storage_growth_bytes: int
    storage_growth_gb: float
    storage_growth_percent: float

    # Warning counts
    enterprises_normal: int
    enterprises_approaching: int  # 80%+
    enterprises_exceeded: int     # 100%+
    enterprises_critical: int     # 110%+


class UsageSnapshotResponse(BaseModel):
    """Daily usage snapshot for charts."""
    snapshot_date: str
    total_storage_bytes: int
    total_storage_gb: float
    storage_usage_percent: float
    control_logs_bytes: int
    alarms_bytes: int
    sites_count: int
    controllers_count: int


class RecalculateResponse(BaseModel):
    """Result of usage recalculation."""
    success: bool
    enterprises_updated: int
    message: str


# ============================================
# HELPER FUNCTIONS
# ============================================

def bytes_to_gb(bytes_val: int) -> float:
    """Convert bytes to GB with 2 decimal places."""
    return round(bytes_val / (1024 ** 3), 2)


def calculate_warning_level(usage_percent: float) -> str:
    """Determine warning level from usage percentage."""
    if usage_percent >= 110:
        return "critical"
    elif usage_percent >= 100:
        return "exceeded"
    elif usage_percent >= 80:
        return "approaching"
    return "normal"


# ============================================
# ENDPOINTS - PACKAGES
# ============================================

@router.get("/packages", response_model=list[UsagePackageResponse])
async def list_packages(
    include_inactive: bool = Query(False, description="Include inactive packages"),
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    List all usage packages.

    Super/backend admins only.
    """
    try:
        query = db.table("usage_packages").select("*")

        if not include_inactive:
            query = query.eq("is_active", True)

        result = query.order("display_order").execute()

        packages = []
        for row in result.data:
            packages.append(UsagePackageResponse(
                id=str(row["id"]),
                name=row["name"],
                description=row.get("description"),
                storage_limit_bytes=row["storage_limit_bytes"],
                storage_limit_gb=bytes_to_gb(row["storage_limit_bytes"]),
                bandwidth_limit_bytes=row.get("bandwidth_limit_bytes"),
                max_sites=row.get("max_sites"),
                max_controllers=row.get("max_controllers"),
                max_users=row.get("max_users"),
                price_monthly=float(row["price_monthly"]) if row.get("price_monthly") else None,
                is_active=row.get("is_active", True)
            ))

        return packages
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch packages: {str(e)}"
        )


# ============================================
# ENDPOINTS - SUMMARY
# ============================================

@router.get("/summary", response_model=UsageSummaryResponse)
async def get_usage_summary(
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Get system-wide usage summary.

    Shows total storage, growth, and warning counts across all enterprises.
    Super/backend admins only.
    """
    try:
        # Get all enterprises
        enterprises_result = db.table("enterprises").select("id, is_active").execute()
        total_enterprises = len(enterprises_result.data)
        active_enterprises = len([e for e in enterprises_result.data if e.get("is_active", True)])

        # Get latest snapshots for all enterprises
        today = date.today()
        latest_snapshots = db.table("enterprise_usage_snapshots") \
            .select("*") \
            .eq("snapshot_date", today.isoformat()) \
            .execute()

        # Calculate totals
        total_storage = sum(s.get("total_storage_bytes", 0) for s in latest_snapshots.data)

        # Get snapshots from 30 days ago for growth calculation
        month_ago = today - timedelta(days=30)
        old_snapshots = db.table("enterprise_usage_snapshots") \
            .select("total_storage_bytes") \
            .eq("snapshot_date", month_ago.isoformat()) \
            .execute()

        old_storage = sum(s.get("total_storage_bytes", 0) for s in old_snapshots.data)
        storage_growth = total_storage - old_storage
        growth_percent = (storage_growth / old_storage * 100) if old_storage > 0 else 0

        # Count warning levels
        warning_counts = {"normal": 0, "approaching": 0, "exceeded": 0, "critical": 0}
        for snapshot in latest_snapshots.data:
            usage_percent = snapshot.get("storage_usage_percent", 0) or 0
            level = calculate_warning_level(usage_percent)
            warning_counts[level] += 1

        return UsageSummaryResponse(
            total_enterprises=total_enterprises,
            active_enterprises=active_enterprises,
            total_storage_bytes=total_storage,
            total_storage_gb=bytes_to_gb(total_storage),
            storage_growth_bytes=storage_growth,
            storage_growth_gb=bytes_to_gb(storage_growth),
            storage_growth_percent=round(growth_percent, 1),
            enterprises_normal=warning_counts["normal"],
            enterprises_approaching=warning_counts["approaching"],
            enterprises_exceeded=warning_counts["exceeded"],
            enterprises_critical=warning_counts["critical"]
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch usage summary: {str(e)}"
        )


# ============================================
# ENDPOINTS - ENTERPRISE USAGE
# ============================================

@router.get("/enterprises", response_model=list[EnterpriseUsageResponse])
async def list_enterprise_usage(
    warning_level: Optional[str] = Query(None, description="Filter by warning level"),
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    List usage for all enterprises.

    Returns current storage usage, package info, and warning status.
    Super/backend admins only.
    """
    try:
        # Get all active enterprises with their packages
        enterprises_result = db.table("enterprises") \
            .select("id, name, usage_package_id, usage_warning_level, usage_grace_period_start") \
            .eq("is_active", True) \
            .order("name") \
            .execute()

        # Get packages for lookup
        packages_result = db.table("usage_packages").select("*").execute()
        packages_map = {str(p["id"]): p for p in packages_result.data}

        # Get latest snapshots
        today = date.today()
        snapshots_result = db.table("enterprise_usage_snapshots") \
            .select("*") \
            .eq("snapshot_date", today.isoformat()) \
            .execute()

        snapshots_map = {str(s["enterprise_id"]): s for s in snapshots_result.data}

        usage_list = []
        for enterprise in enterprises_result.data:
            ent_id = str(enterprise["id"])
            snapshot = snapshots_map.get(ent_id, {})
            package = packages_map.get(str(enterprise.get("usage_package_id"))) if enterprise.get("usage_package_id") else None

            # Calculate usage percent
            total_bytes = snapshot.get("total_storage_bytes", 0)
            limit_bytes = package["storage_limit_bytes"] if package else None
            usage_percent = (total_bytes / limit_bytes * 100) if limit_bytes else 0

            level = calculate_warning_level(usage_percent)

            # Filter by warning level if specified
            if warning_level and level != warning_level:
                continue

            usage_list.append(EnterpriseUsageResponse(
                enterprise_id=ent_id,
                enterprise_name=enterprise["name"],
                package_id=str(enterprise.get("usage_package_id")) if enterprise.get("usage_package_id") else None,
                package_name=package["name"] if package else None,
                storage_limit_bytes=limit_bytes,
                storage_limit_gb=bytes_to_gb(limit_bytes) if limit_bytes else None,
                total_storage_bytes=total_bytes,
                total_storage_gb=bytes_to_gb(total_bytes),
                storage_usage_percent=round(usage_percent, 1),
                control_logs_bytes=snapshot.get("control_logs_bytes", 0),
                control_logs_rows=snapshot.get("control_logs_rows", 0),
                alarms_bytes=snapshot.get("alarms_bytes", 0),
                alarms_rows=snapshot.get("alarms_rows", 0),
                heartbeats_bytes=snapshot.get("heartbeats_bytes", 0),
                audit_logs_bytes=snapshot.get("audit_logs_bytes", 0),
                sites_count=snapshot.get("sites_count", 0),
                controllers_count=snapshot.get("controllers_count", 0),
                users_count=snapshot.get("users_count", 0),
                warning_level=level,
                grace_period_start=enterprise.get("usage_grace_period_start"),
                snapshot_date=snapshot.get("snapshot_date")
            ))

        return usage_list
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch enterprise usage: {str(e)}"
        )


@router.get("/enterprises/{enterprise_id}", response_model=EnterpriseUsageResponse)
async def get_enterprise_usage(
    enterprise_id: UUID,
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin", "enterprise_admin", "admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Get usage details for a specific enterprise.

    Enterprise admins can only view their own enterprise.
    Super/backend admins can view any enterprise.
    """
    try:
        # Check access for enterprise_admin
        if current_user.role in ["enterprise_admin", "admin"]:
            if str(current_user.enterprise_id) != str(enterprise_id):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You can only view your own enterprise's usage"
                )

        # Get enterprise
        enterprise_result = db.table("enterprises") \
            .select("id, name, usage_package_id, usage_warning_level, usage_grace_period_start") \
            .eq("id", str(enterprise_id)) \
            .single() \
            .execute()

        if not enterprise_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Enterprise not found"
            )

        enterprise = enterprise_result.data

        # Get package
        package = None
        if enterprise.get("usage_package_id"):
            package_result = db.table("usage_packages") \
                .select("*") \
                .eq("id", enterprise["usage_package_id"]) \
                .single() \
                .execute()
            package = package_result.data if package_result.data else None

        # Get latest snapshot
        today = date.today()
        snapshot_result = db.table("enterprise_usage_snapshots") \
            .select("*") \
            .eq("enterprise_id", str(enterprise_id)) \
            .order("snapshot_date", desc=True) \
            .limit(1) \
            .execute()

        snapshot = snapshot_result.data[0] if snapshot_result.data else {}

        # Calculate usage
        total_bytes = snapshot.get("total_storage_bytes", 0)
        limit_bytes = package["storage_limit_bytes"] if package else None
        usage_percent = (total_bytes / limit_bytes * 100) if limit_bytes else 0

        return EnterpriseUsageResponse(
            enterprise_id=str(enterprise["id"]),
            enterprise_name=enterprise["name"],
            package_id=str(enterprise.get("usage_package_id")) if enterprise.get("usage_package_id") else None,
            package_name=package["name"] if package else None,
            storage_limit_bytes=limit_bytes,
            storage_limit_gb=bytes_to_gb(limit_bytes) if limit_bytes else None,
            total_storage_bytes=total_bytes,
            total_storage_gb=bytes_to_gb(total_bytes),
            storage_usage_percent=round(usage_percent, 1),
            control_logs_bytes=snapshot.get("control_logs_bytes", 0),
            control_logs_rows=snapshot.get("control_logs_rows", 0),
            alarms_bytes=snapshot.get("alarms_bytes", 0),
            alarms_rows=snapshot.get("alarms_rows", 0),
            heartbeats_bytes=snapshot.get("heartbeats_bytes", 0),
            audit_logs_bytes=snapshot.get("audit_logs_bytes", 0),
            sites_count=snapshot.get("sites_count", 0),
            controllers_count=snapshot.get("controllers_count", 0),
            users_count=snapshot.get("users_count", 0),
            warning_level=calculate_warning_level(usage_percent),
            grace_period_start=enterprise.get("usage_grace_period_start"),
            snapshot_date=snapshot.get("snapshot_date")
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch enterprise usage: {str(e)}"
        )


@router.get("/enterprises/{enterprise_id}/history", response_model=list[UsageSnapshotResponse])
async def get_enterprise_usage_history(
    enterprise_id: UUID,
    start_date: date = Query(..., description="Start date (inclusive)"),
    end_date: date = Query(..., description="End date (inclusive)"),
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin", "enterprise_admin", "admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Get historical usage snapshots for an enterprise.

    Used for charts. Maximum 30-day range.
    Enterprise admins can only view their own enterprise.
    """
    try:
        # Validate date range (max 30 days)
        date_diff = (end_date - start_date).days
        if date_diff > 30:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Date range cannot exceed 30 days"
            )

        if date_diff < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="End date must be after start date"
            )

        # Check access for enterprise_admin
        if current_user.role in ["enterprise_admin", "admin"]:
            if str(current_user.enterprise_id) != str(enterprise_id):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You can only view your own enterprise's history"
                )

        # Get snapshots
        result = db.table("enterprise_usage_snapshots") \
            .select("*") \
            .eq("enterprise_id", str(enterprise_id)) \
            .gte("snapshot_date", start_date.isoformat()) \
            .lte("snapshot_date", end_date.isoformat()) \
            .order("snapshot_date") \
            .execute()

        return [
            UsageSnapshotResponse(
                snapshot_date=row["snapshot_date"],
                total_storage_bytes=row.get("total_storage_bytes", 0),
                total_storage_gb=bytes_to_gb(row.get("total_storage_bytes", 0)),
                storage_usage_percent=row.get("storage_usage_percent", 0) or 0,
                control_logs_bytes=row.get("control_logs_bytes", 0),
                alarms_bytes=row.get("alarms_bytes", 0),
                sites_count=row.get("sites_count", 0),
                controllers_count=row.get("controllers_count", 0)
            )
            for row in result.data
        ]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch usage history: {str(e)}"
        )


# ============================================
# ENDPOINTS - RECALCULATION
# ============================================

@router.post("/calculate", response_model=RecalculateResponse)
async def recalculate_usage(
    enterprise_id: Optional[UUID] = Query(None, description="Specific enterprise to recalculate"),
    current_user: CurrentUser = Depends(require_role(["super_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Trigger usage recalculation.

    If enterprise_id is provided, only recalculate for that enterprise.
    Otherwise, recalculate for all active enterprises.

    Super admin only.
    """
    try:
        if enterprise_id:
            # Recalculate for specific enterprise
            result = db.rpc("create_usage_snapshot", {
                "p_enterprise_id": str(enterprise_id),
                "p_date": date.today().isoformat()
            }).execute()

            return RecalculateResponse(
                success=True,
                enterprises_updated=1,
                message=f"Usage recalculated for enterprise {enterprise_id}"
            )
        else:
            # Recalculate for all enterprises
            result = db.rpc("create_all_usage_snapshots", {
                "p_date": date.today().isoformat()
            }).execute()

            count = result.data if result.data else 0

            return RecalculateResponse(
                success=True,
                enterprises_updated=count,
                message=f"Usage recalculated for {count} enterprises"
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to recalculate usage: {str(e)}"
        )
