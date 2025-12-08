"""
Enterprises Router

Handles enterprise (organization) management:
- List all enterprises
- Create new enterprise
- Update enterprise settings
- Get enterprise details with statistics
- List enterprise's projects, controllers, and users

Only super_admin can access these endpoints.
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

class EnterpriseCreate(BaseModel):
    """Create enterprise request."""
    name: str = Field(..., description="Enterprise display name")
    enterprise_id: str = Field(..., description="Unique identifier/slug, e.g., 'acme-corp'")
    contact_email: Optional[str] = Field(None, description="Contact email address")
    contact_phone: Optional[str] = Field(None, description="Contact phone number")
    address: Optional[str] = Field(None, description="Street address")
    city: Optional[str] = Field(None, description="City")
    country: Optional[str] = Field(None, description="Country")


class EnterpriseUpdate(BaseModel):
    """Update enterprise request."""
    contact_email: Optional[str] = Field(None, description="Contact email address")
    contact_phone: Optional[str] = Field(None, description="Contact phone number")
    address: Optional[str] = Field(None, description="Street address")
    city: Optional[str] = Field(None, description="City")
    country: Optional[str] = Field(None, description="Country")
    is_active: Optional[bool] = Field(None, description="Whether enterprise is active")
    settings: Optional[dict] = Field(None, description="Enterprise-specific settings as JSON")


class EnterpriseResponse(BaseModel):
    """Enterprise response."""
    id: str
    name: str
    enterprise_id: str
    contact_email: Optional[str]
    contact_phone: Optional[str]
    address: Optional[str]
    city: Optional[str]
    country: Optional[str]
    settings: Optional[dict]
    is_active: bool
    created_at: str


class EnterpriseStats(BaseModel):
    """Enterprise statistics."""
    total_projects: int
    online_projects: int
    total_controllers: int
    total_users: int


class EnterpriseWithStats(EnterpriseResponse):
    """Enterprise response with statistics."""
    stats: Optional[EnterpriseStats] = None


# ============================================
# HELPER FUNCTIONS
# ============================================

def db_row_to_enterprise_response(row: dict) -> EnterpriseResponse:
    """Convert database row to EnterpriseResponse."""
    return EnterpriseResponse(
        id=str(row["id"]),
        name=row.get("name", ""),
        enterprise_id=row.get("enterprise_id", ""),
        contact_email=row.get("contact_email"),
        contact_phone=row.get("contact_phone"),
        address=row.get("address"),
        city=row.get("city"),
        country=row.get("country"),
        settings=row.get("settings"),
        is_active=row.get("is_active", True),
        created_at=row.get("created_at", "")
    )


# ============================================
# ENDPOINTS - LIST & GET
# ============================================

@router.get("/", response_model=list[EnterpriseResponse])
async def list_enterprises(
    include_inactive: bool = Query(False, description="Include inactive enterprises"),
    current_user: CurrentUser = Depends(require_role(["super_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    List all enterprises.

    Only super_admin can list enterprises.
    """
    try:
        query = db.table("enterprises").select("*")

        if not include_inactive:
            query = query.eq("is_active", True)

        result = query.order("name").execute()

        return [db_row_to_enterprise_response(row) for row in result.data]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch enterprises: {str(e)}"
        )


@router.get("/{enterprise_id}", response_model=EnterpriseWithStats)
async def get_enterprise(
    enterprise_id: UUID,
    current_user: CurrentUser = Depends(require_role(["super_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Get enterprise details with statistics.

    Only super_admin can access.
    Returns enterprise info plus counts of projects, controllers, and users.
    """
    try:
        # Get enterprise
        result = db.table("enterprises").select("*").eq("id", str(enterprise_id)).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Enterprise {enterprise_id} not found"
            )

        enterprise = db_row_to_enterprise_response(result.data[0])

        # Get statistics
        # Count projects
        projects_result = db.table("projects").select("id, controller_status").eq(
            "enterprise_id", str(enterprise_id)
        ).execute()
        total_projects = len(projects_result.data)
        online_projects = len([p for p in projects_result.data if p.get("controller_status") == "online"])

        # Count controllers
        controllers_result = db.table("controllers").select("id").eq(
            "enterprise_id", str(enterprise_id)
        ).eq("is_active", True).execute()
        total_controllers = len(controllers_result.data)

        # Count users
        users_result = db.table("users").select("id").eq(
            "enterprise_id", str(enterprise_id)
        ).execute()
        total_users = len(users_result.data)

        stats = EnterpriseStats(
            total_projects=total_projects,
            online_projects=online_projects,
            total_controllers=total_controllers,
            total_users=total_users
        )

        return EnterpriseWithStats(
            **enterprise.model_dump(),
            stats=stats
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch enterprise: {str(e)}"
        )


# ============================================
# ENDPOINTS - CREATE & UPDATE
# ============================================

@router.post("/", response_model=EnterpriseResponse, status_code=status.HTTP_201_CREATED)
async def create_enterprise(
    enterprise: EnterpriseCreate,
    current_user: CurrentUser = Depends(require_role(["super_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Create a new enterprise.

    Only super_admin can create enterprises.
    """
    try:
        # Check if enterprise_id already exists
        existing = db.table("enterprises").select("id").eq("enterprise_id", enterprise.enterprise_id).execute()
        if existing.data:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Enterprise with ID '{enterprise.enterprise_id}' already exists"
            )

        insert_data = {
            "name": enterprise.name,
            "enterprise_id": enterprise.enterprise_id,
            "contact_email": enterprise.contact_email,
            "contact_phone": enterprise.contact_phone,
            "address": enterprise.address,
            "city": enterprise.city,
            "country": enterprise.country,
            "is_active": True,
            "created_by": current_user.id
        }

        result = db.table("enterprises").insert(insert_data).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create enterprise"
            )

        return db_row_to_enterprise_response(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create enterprise: {str(e)}"
        )


@router.patch("/{enterprise_id}", response_model=EnterpriseResponse)
async def update_enterprise(
    enterprise_id: UUID,
    update: EnterpriseUpdate,
    current_user: CurrentUser = Depends(require_role(["super_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Update enterprise settings.

    Only super_admin can update enterprises.
    Note: Enterprise name cannot be changed after creation.
    """
    try:
        # Check if enterprise exists
        existing = db.table("enterprises").select("id").eq("id", str(enterprise_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Enterprise {enterprise_id} not found"
            )

        # Build update data
        update_data = {}
        if update.contact_email is not None:
            update_data["contact_email"] = update.contact_email
        if update.contact_phone is not None:
            update_data["contact_phone"] = update.contact_phone
        if update.address is not None:
            update_data["address"] = update.address
        if update.city is not None:
            update_data["city"] = update.city
        if update.country is not None:
            update_data["country"] = update.country
        if update.is_active is not None:
            update_data["is_active"] = update.is_active
        if update.settings is not None:
            update_data["settings"] = update.settings

        if not update_data:
            # Nothing to update
            result = db.table("enterprises").select("*").eq("id", str(enterprise_id)).execute()
            return db_row_to_enterprise_response(result.data[0])

        db.table("enterprises").update(update_data).eq("id", str(enterprise_id)).execute()

        # Fetch updated record
        result = db.table("enterprises").select("*").eq("id", str(enterprise_id)).execute()

        return db_row_to_enterprise_response(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update enterprise: {str(e)}"
        )


@router.delete("/{enterprise_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_enterprise(
    enterprise_id: UUID,
    current_user: CurrentUser = Depends(require_role(["super_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Soft delete enterprise (set is_active to false).

    Only super_admin can delete enterprises.
    """
    try:
        # Check if enterprise exists
        existing = db.table("enterprises").select("id").eq("id", str(enterprise_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Enterprise {enterprise_id} not found"
            )

        # Soft delete
        db.table("enterprises").update({"is_active": False}).eq("id", str(enterprise_id)).execute()

        return None
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete enterprise: {str(e)}"
        )


# ============================================
# ENDPOINTS - RELATED ENTITIES
# ============================================

@router.get("/{enterprise_id}/stats", response_model=EnterpriseStats)
async def get_enterprise_stats(
    enterprise_id: UUID,
    current_user: CurrentUser = Depends(require_role(["super_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Get enterprise statistics.

    Returns counts of projects, controllers, and users.
    """
    try:
        # Verify enterprise exists
        existing = db.table("enterprises").select("id").eq("id", str(enterprise_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Enterprise {enterprise_id} not found"
            )

        # Count projects
        projects_result = db.table("projects").select("id, controller_status").eq(
            "enterprise_id", str(enterprise_id)
        ).execute()
        total_projects = len(projects_result.data)
        online_projects = len([p for p in projects_result.data if p.get("controller_status") == "online"])

        # Count controllers
        controllers_result = db.table("controllers").select("id").eq(
            "enterprise_id", str(enterprise_id)
        ).eq("is_active", True).execute()
        total_controllers = len(controllers_result.data)

        # Count users
        users_result = db.table("users").select("id").eq(
            "enterprise_id", str(enterprise_id)
        ).execute()
        total_users = len(users_result.data)

        return EnterpriseStats(
            total_projects=total_projects,
            online_projects=online_projects,
            total_controllers=total_controllers,
            total_users=total_users
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch enterprise stats: {str(e)}"
        )


@router.get("/{enterprise_id}/projects")
async def get_enterprise_projects(
    enterprise_id: UUID,
    current_user: CurrentUser = Depends(require_role(["super_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    List all projects belonging to an enterprise.
    """
    try:
        # Verify enterprise exists
        existing = db.table("enterprises").select("id").eq("id", str(enterprise_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Enterprise {enterprise_id} not found"
            )

        result = db.table("projects").select(
            "id, name, location, controller_status, created_at"
        ).eq("enterprise_id", str(enterprise_id)).order("name").execute()

        return result.data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch enterprise projects: {str(e)}"
        )


@router.get("/{enterprise_id}/controllers")
async def get_enterprise_controllers(
    enterprise_id: UUID,
    current_user: CurrentUser = Depends(require_role(["super_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    List all controllers claimed by an enterprise.
    """
    try:
        # Verify enterprise exists
        existing = db.table("enterprises").select("id").eq("id", str(enterprise_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Enterprise {enterprise_id} not found"
            )

        result = db.table("controllers").select("""
            id, serial_number, status, firmware_version, claimed_at,
            approved_hardware:hardware_type_id (name, hardware_type)
        """).eq("enterprise_id", str(enterprise_id)).eq("is_active", True).order(
            "claimed_at", desc=True
        ).execute()

        # Transform hardware relation
        controllers = []
        for row in result.data:
            hardware = row.get("approved_hardware") or {}
            if isinstance(hardware, list):
                hardware = hardware[0] if hardware else {}
            controllers.append({
                "id": row["id"],
                "serial_number": row["serial_number"],
                "status": row["status"],
                "firmware_version": row.get("firmware_version"),
                "claimed_at": row.get("claimed_at"),
                "hardware_name": hardware.get("name"),
                "hardware_type": hardware.get("hardware_type")
            })

        return controllers
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch enterprise controllers: {str(e)}"
        )


@router.get("/{enterprise_id}/users")
async def get_enterprise_users(
    enterprise_id: UUID,
    current_user: CurrentUser = Depends(require_role(["super_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    List all users assigned to an enterprise.
    """
    try:
        # Verify enterprise exists
        existing = db.table("enterprises").select("id").eq("id", str(enterprise_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Enterprise {enterprise_id} not found"
            )

        result = db.table("users").select(
            "id, email, full_name, role, is_active, created_at"
        ).eq("enterprise_id", str(enterprise_id)).order("created_at", desc=True).execute()

        return result.data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch enterprise users: {str(e)}"
        )
