"""
Hardware Router

Handles approved hardware types management:
- List hardware types
- Create new hardware type
- Update hardware
- Soft delete hardware

Only super_admin and backend_admin can access these endpoints.
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

class HardwareCreate(BaseModel):
    """Create hardware type request."""
    hardware_type: str = Field(..., description="Unique identifier, e.g., 'raspberry_pi_5'")
    name: str = Field(..., description="Display name, e.g., 'Raspberry Pi 5'")
    manufacturer: Optional[str] = Field(None, description="Hardware manufacturer")
    description: Optional[str] = Field(None, description="Description of the hardware")
    features: Optional[dict] = Field(None, description="Hardware features as JSON, e.g., {'wifi': true, 'ethernet': true}")


class HardwareUpdate(BaseModel):
    """Update hardware type request."""
    name: Optional[str] = Field(None, description="Display name")
    manufacturer: Optional[str] = Field(None, description="Hardware manufacturer")
    description: Optional[str] = Field(None, description="Description of the hardware")
    features: Optional[dict] = Field(None, description="Hardware features as JSON")
    is_active: Optional[bool] = Field(None, description="Whether hardware type is active")


class HardwareResponse(BaseModel):
    """Hardware type response."""
    id: str
    hardware_type: str
    name: str
    manufacturer: Optional[str]
    description: Optional[str]
    features: Optional[dict]
    is_active: bool
    created_at: str


# ============================================
# HELPER FUNCTIONS
# ============================================

def db_row_to_hardware_response(row: dict) -> HardwareResponse:
    """Convert database row to HardwareResponse."""
    return HardwareResponse(
        id=str(row["id"]),
        hardware_type=row.get("hardware_type", ""),
        name=row.get("name", ""),
        manufacturer=row.get("manufacturer"),
        description=row.get("description"),
        features=row.get("features"),
        is_active=row.get("is_active", True),
        created_at=row.get("created_at", "")
    )


# ============================================
# ENDPOINTS
# ============================================

@router.get("/", response_model=list[HardwareResponse])
async def list_hardware(
    include_inactive: bool = Query(False, description="Include inactive hardware types"),
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    List all approved hardware types.

    Only super_admin and backend_admin can access.
    """
    try:
        query = db.table("approved_hardware").select("*")

        if not include_inactive:
            query = query.eq("is_active", True)

        result = query.order("name").execute()

        return [db_row_to_hardware_response(row) for row in result.data]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch hardware types: {str(e)}"
        )


@router.get("/{hardware_id}", response_model=HardwareResponse)
async def get_hardware(
    hardware_id: UUID,
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Get hardware type by ID.

    Only super_admin and backend_admin can access.
    """
    try:
        result = db.table("approved_hardware").select("*").eq("id", str(hardware_id)).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Hardware type {hardware_id} not found"
            )

        return db_row_to_hardware_response(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch hardware type: {str(e)}"
        )


@router.post("/", response_model=HardwareResponse, status_code=status.HTTP_201_CREATED)
async def create_hardware(
    hardware: HardwareCreate,
    current_user: CurrentUser = Depends(require_role(["super_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Create a new hardware type.

    Only super_admin can create hardware types.
    """
    try:
        # Check if hardware_type already exists
        existing = db.table("approved_hardware").select("id").eq("hardware_type", hardware.hardware_type).execute()
        if existing.data:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Hardware type '{hardware.hardware_type}' already exists"
            )

        insert_data = {
            "hardware_type": hardware.hardware_type,
            "name": hardware.name,
            "manufacturer": hardware.manufacturer,
            "description": hardware.description,
            "features": hardware.features or {},
            "is_active": True
        }

        result = db.table("approved_hardware").insert(insert_data).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create hardware type"
            )

        return db_row_to_hardware_response(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create hardware type: {str(e)}"
        )


@router.patch("/{hardware_id}", response_model=HardwareResponse)
async def update_hardware(
    hardware_id: UUID,
    update: HardwareUpdate,
    current_user: CurrentUser = Depends(require_role(["super_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Update hardware type.

    Only super_admin can update hardware types.
    """
    try:
        # Check if hardware exists
        existing = db.table("approved_hardware").select("id").eq("id", str(hardware_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Hardware type {hardware_id} not found"
            )

        # Build update data (only include non-None fields)
        update_data = {}
        if update.name is not None:
            update_data["name"] = update.name
        if update.manufacturer is not None:
            update_data["manufacturer"] = update.manufacturer
        if update.description is not None:
            update_data["description"] = update.description
        if update.features is not None:
            update_data["features"] = update.features
        if update.is_active is not None:
            update_data["is_active"] = update.is_active

        if not update_data:
            # Nothing to update, return current
            result = db.table("approved_hardware").select("*").eq("id", str(hardware_id)).execute()
            return db_row_to_hardware_response(result.data[0])

        db.table("approved_hardware").update(update_data).eq("id", str(hardware_id)).execute()

        # Fetch updated record
        result = db.table("approved_hardware").select("*").eq("id", str(hardware_id)).execute()

        return db_row_to_hardware_response(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update hardware type: {str(e)}"
        )


@router.delete("/{hardware_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_hardware(
    hardware_id: UUID,
    current_user: CurrentUser = Depends(require_role(["super_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Soft delete hardware type (set is_active to false).

    Only super_admin can delete hardware types.
    """
    try:
        # Check if hardware exists
        existing = db.table("approved_hardware").select("id").eq("id", str(hardware_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Hardware type {hardware_id} not found"
            )

        # Soft delete - set is_active to false
        db.table("approved_hardware").update({"is_active": False}).eq("id", str(hardware_id)).execute()

        return None
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete hardware type: {str(e)}"
        )
