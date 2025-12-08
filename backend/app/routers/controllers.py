"""
Controllers Router

Handles controller hardware management:
- List all controllers
- Register new controller
- Update controller status
- Generate passcodes
- Claim controller (for enterprise admins)

Accessible by super_admin, backend_admin, and enterprise_admin (for claiming).
"""

import secrets
import string
import uuid
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

class ControllerCreate(BaseModel):
    """Create controller request."""
    serial_number: str = Field(..., description="Unique serial number, e.g., 'RPI5-2024-001'")
    hardware_type_id: str = Field(..., description="UUID of the approved hardware type")
    firmware_version: Optional[str] = Field(None, description="Initial firmware version")
    notes: Optional[str] = Field(None, description="Notes about the controller")


class ControllerUpdate(BaseModel):
    """Update controller request."""
    firmware_version: Optional[str] = Field(None, description="Firmware version")
    status: Optional[str] = Field(None, description="Status: draft, ready, deployed")
    notes: Optional[str] = Field(None, description="Notes about the controller")


class ControllerClaim(BaseModel):
    """Claim controller request (for enterprise admins)."""
    serial_number: str = Field(..., description="Controller serial number")
    passcode: str = Field(..., description="UUID passcode")


class ControllerResponse(BaseModel):
    """Controller response."""
    id: str
    serial_number: str
    hardware_type_id: str
    hardware_name: Optional[str]  # From join
    hardware_type: Optional[str]  # From join
    status: str
    passcode: Optional[str]
    firmware_version: Optional[str]
    enterprise_id: Optional[str]
    enterprise_name: Optional[str]  # From join
    project_id: Optional[str]
    claimed_at: Optional[str]
    notes: Optional[str]
    is_active: bool
    created_at: str


# ============================================
# HELPER FUNCTIONS
# ============================================

def generate_passcode() -> str:
    """
    Generate a secure UUID passcode.
    Format: c159d3d6-a778-4812-a688-0d7c5d0042ea (36 characters)
    """
    return str(uuid.uuid4())


def db_row_to_controller_response(row: dict) -> ControllerResponse:
    """Convert database row to ControllerResponse."""
    # Handle joined data from approved_hardware
    hardware = row.get("approved_hardware") or {}
    if isinstance(hardware, list):
        hardware = hardware[0] if hardware else {}

    # Handle joined data from enterprises
    enterprise = row.get("enterprises") or {}
    if isinstance(enterprise, list):
        enterprise = enterprise[0] if enterprise else {}

    return ControllerResponse(
        id=str(row["id"]),
        serial_number=row.get("serial_number", ""),
        hardware_type_id=str(row.get("hardware_type_id", "")),
        hardware_name=hardware.get("name"),
        hardware_type=hardware.get("hardware_type"),
        status=row.get("status", "draft"),
        passcode=row.get("passcode"),
        firmware_version=row.get("firmware_version"),
        enterprise_id=str(row["enterprise_id"]) if row.get("enterprise_id") else None,
        enterprise_name=enterprise.get("name"),
        project_id=str(row["project_id"]) if row.get("project_id") else None,
        claimed_at=row.get("claimed_at"),
        notes=row.get("notes"),
        is_active=row.get("is_active", True),
        created_at=row.get("created_at", "")
    )


# ============================================
# ENDPOINTS - LIST & GET
# ============================================

@router.get("/", response_model=list[ControllerResponse])
async def list_controllers(
    status_filter: Optional[str] = Query(None, description="Filter by status: draft, ready, deployed"),
    enterprise_id: Optional[UUID] = Query(None, description="Filter by enterprise"),
    include_inactive: bool = Query(False, description="Include inactive controllers"),
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    List all controllers.

    Only super_admin and backend_admin can list all controllers.
    """
    try:
        query = db.table("controllers").select("""
            *,
            approved_hardware:hardware_type_id (name, hardware_type),
            enterprises:enterprise_id (name)
        """)

        if status_filter:
            query = query.eq("status", status_filter)
        if enterprise_id:
            query = query.eq("enterprise_id", str(enterprise_id))
        if not include_inactive:
            query = query.eq("is_active", True)

        result = query.order("created_at", desc=True).execute()

        return [db_row_to_controller_response(row) for row in result.data]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch controllers: {str(e)}"
        )


@router.get("/{controller_id}", response_model=ControllerResponse)
async def get_controller(
    controller_id: UUID,
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Get controller by ID.

    Only super_admin and backend_admin can access.
    """
    try:
        result = db.table("controllers").select("""
            *,
            approved_hardware:hardware_type_id (name, hardware_type),
            enterprises:enterprise_id (name)
        """).eq("id", str(controller_id)).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Controller {controller_id} not found"
            )

        return db_row_to_controller_response(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch controller: {str(e)}"
        )


# ============================================
# ENDPOINTS - CREATE & UPDATE
# ============================================

@router.post("/", response_model=ControllerResponse, status_code=status.HTTP_201_CREATED)
async def create_controller(
    controller: ControllerCreate,
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Register a new controller.

    Only super_admin and backend_admin can register controllers.
    """
    try:
        # Check if serial_number already exists
        existing = db.table("controllers").select("id").eq("serial_number", controller.serial_number).execute()
        if existing.data:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Controller with serial number '{controller.serial_number}' already exists"
            )

        # Verify hardware type exists
        hardware = db.table("approved_hardware").select("id").eq("id", controller.hardware_type_id).execute()
        if not hardware.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Hardware type {controller.hardware_type_id} not found"
            )

        insert_data = {
            "serial_number": controller.serial_number,
            "hardware_type_id": controller.hardware_type_id,
            "firmware_version": controller.firmware_version,
            "notes": controller.notes,
            "status": "draft",
            "is_active": True,
            "created_by": current_user.id
        }

        result = db.table("controllers").insert(insert_data).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create controller"
            )

        # Fetch with joined data
        controller_result = db.table("controllers").select("""
            *,
            approved_hardware:hardware_type_id (name, hardware_type),
            enterprises:enterprise_id (name)
        """).eq("id", result.data[0]["id"]).execute()

        return db_row_to_controller_response(controller_result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create controller: {str(e)}"
        )


@router.patch("/{controller_id}", response_model=ControllerResponse)
async def update_controller(
    controller_id: UUID,
    update: ControllerUpdate,
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Update controller.

    Only super_admin and backend_admin can update controllers.
    """
    try:
        # Check if controller exists
        existing = db.table("controllers").select("id, status").eq("id", str(controller_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Controller {controller_id} not found"
            )

        # Build update data
        update_data = {}
        if update.firmware_version is not None:
            update_data["firmware_version"] = update.firmware_version
        if update.status is not None:
            if update.status not in ["draft", "ready", "deployed"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid status. Must be: draft, ready, or deployed"
                )
            update_data["status"] = update.status
        if update.notes is not None:
            update_data["notes"] = update.notes

        if not update_data:
            # Nothing to update
            result = db.table("controllers").select("""
                *,
                approved_hardware:hardware_type_id (name, hardware_type),
                enterprises:enterprise_id (name)
            """).eq("id", str(controller_id)).execute()
            return db_row_to_controller_response(result.data[0])

        db.table("controllers").update(update_data).eq("id", str(controller_id)).execute()

        # Fetch updated record with joins
        result = db.table("controllers").select("""
            *,
            approved_hardware:hardware_type_id (name, hardware_type),
            enterprises:enterprise_id (name)
        """).eq("id", str(controller_id)).execute()

        return db_row_to_controller_response(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update controller: {str(e)}"
        )


@router.delete("/{controller_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_controller(
    controller_id: UUID,
    current_user: CurrentUser = Depends(require_role(["super_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Soft delete controller.

    Only super_admin can delete controllers.
    """
    try:
        # Check if controller exists
        existing = db.table("controllers").select("id").eq("id", str(controller_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Controller {controller_id} not found"
            )

        # Soft delete
        db.table("controllers").update({"is_active": False}).eq("id", str(controller_id)).execute()

        return None
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete controller: {str(e)}"
        )


# ============================================
# ENDPOINTS - PASSCODE MANAGEMENT
# ============================================

@router.post("/{controller_id}/generate-passcode", response_model=ControllerResponse)
async def generate_controller_passcode(
    controller_id: UUID,
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin"])),
    db: Client = Depends(get_supabase)
):
    """
    Generate a new passcode for a controller.

    Only super_admin and backend_admin can generate passcodes.
    Also sets the controller status to 'ready' if it was 'draft'.
    """
    try:
        # Check if controller exists
        existing = db.table("controllers").select("id, status").eq("id", str(controller_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Controller {controller_id} not found"
            )

        # Generate new passcode
        new_passcode = generate_passcode()

        # Update controller with new passcode and set to ready if draft
        update_data = {"passcode": new_passcode}
        if existing.data[0]["status"] == "draft":
            update_data["status"] = "ready"

        db.table("controllers").update(update_data).eq("id", str(controller_id)).execute()

        # Fetch updated record
        result = db.table("controllers").select("""
            *,
            approved_hardware:hardware_type_id (name, hardware_type),
            enterprises:enterprise_id (name)
        """).eq("id", str(controller_id)).execute()

        return db_row_to_controller_response(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate passcode: {str(e)}"
        )


# ============================================
# ENDPOINTS - CLAIM CONTROLLER
# ============================================

@router.post("/claim", response_model=ControllerResponse)
async def claim_controller(
    claim: ControllerClaim,
    current_user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """
    Claim a controller for an enterprise.

    Enterprise admins can claim controllers using serial number + passcode.
    The controller must be in 'ready' status to be claimed.
    """
    try:
        # Only enterprise_admin can claim
        if current_user.role != "enterprise_admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only enterprise admins can claim controllers"
            )

        # Get user's enterprise_id
        user_result = db.table("users").select("enterprise_id").eq("id", current_user.id).execute()
        if not user_result.data or not user_result.data[0].get("enterprise_id"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You must be assigned to an enterprise to claim controllers"
            )

        enterprise_id = user_result.data[0]["enterprise_id"]

        # Find controller by serial number
        controller_result = db.table("controllers").select("*").eq(
            "serial_number", claim.serial_number
        ).execute()

        if not controller_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Controller with serial number '{claim.serial_number}' not found"
            )

        controller = controller_result.data[0]

        # Verify passcode
        if controller.get("passcode") != claim.passcode:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid passcode"
            )

        # Check status - must be 'ready'
        if controller.get("status") != "ready":
            if controller.get("status") == "deployed":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This controller has already been claimed"
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="This controller is not ready for claiming"
                )

        # Check if already claimed by another enterprise
        if controller.get("enterprise_id"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This controller has already been claimed by another enterprise"
            )

        # Claim the controller
        update_data = {
            "enterprise_id": enterprise_id,
            "claimed_at": datetime.utcnow().isoformat(),
            "claimed_by": current_user.id,
            "status": "deployed"
        }

        db.table("controllers").update(update_data).eq("id", controller["id"]).execute()

        # Fetch updated record with joins
        result = db.table("controllers").select("""
            *,
            approved_hardware:hardware_type_id (name, hardware_type),
            enterprises:enterprise_id (name)
        """).eq("id", controller["id"]).execute()

        return db_row_to_controller_response(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to claim controller: {str(e)}"
        )
