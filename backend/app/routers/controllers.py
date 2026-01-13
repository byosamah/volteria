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
    status: Optional[str] = Field(None, description="Status: draft, ready, claimed, deployed, eol")
    notes: Optional[str] = Field(None, description="Notes about the controller")
    enterprise_id: Optional[str] = Field(None, description="Enterprise ID (Super Admin only can change)")


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
    status_filter: Optional[str] = Query(None, description="Filter by status: draft, ready, claimed, deployed, eol"),
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


# ============================================
# ENDPOINTS - SERIAL-BASED REGISTRATION (MUST BE BEFORE /{controller_id})
# ============================================
# NOTE: This route MUST come before /{controller_id} to avoid route conflicts
# FastAPI matches routes in order - more specific routes need to be defined first

class SerialRegisterResponse(BaseModel):
    """Response for serial-based registration (called by setup script)."""
    controller_id: str
    serial_number: str
    supabase_url: str
    supabase_anon_key: str
    status: str  # "registered" (existing) or "new" (just created)
    message: str
    ssh_tunnel_port: Optional[int] = None


class SetupScriptRegisterRequest(BaseModel):
    """Request from setup-controller.sh script."""
    serial_number: str = Field(..., description="Pi hardware serial from /proc/cpuinfo")
    hardware_type: str = Field(..., description="Hardware type identifier")
    firmware_version: str = Field(..., description="Controller firmware version")


class SetupScriptRegisterResponse(BaseModel):
    """Response for setup script registration."""
    controller_id: str
    ssh_tunnel_port: Optional[int] = None
    supabase_key: Optional[str] = None
    status: str  # "registered" or "new"
    message: str


@router.post("/register", response_model=SetupScriptRegisterResponse)
async def register_from_setup_script(
    request: SetupScriptRegisterRequest,
    db: Client = Depends(get_supabase)
):
    """
    Register controller from setup-controller.sh script.

    This endpoint is called by the Raspberry Pi setup script to:
    1. Register the controller with its hardware serial
    2. Get assigned SSH tunnel port
    3. Get Supabase credentials for cloud sync

    No authentication required - controller identifies itself by hardware serial.
    """
    import os

    try:
        # Check if controller with this serial already exists
        existing = db.table("controllers").select(
            "id, serial_number, status, ssh_tunnel_port"
        ).eq("serial_number", request.serial_number).execute()

        if existing.data:
            # Controller already registered
            controller = existing.data[0]

            # Get Supabase anon key for cloud sync
            supabase_key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

            return SetupScriptRegisterResponse(
                controller_id=str(controller["id"]),
                ssh_tunnel_port=controller.get("ssh_tunnel_port"),
                supabase_key=supabase_key,
                status="registered",
                message="Controller already registered"
            )

        # Find hardware type by identifier
        hardware_result = db.table("approved_hardware").select("id").eq(
            "hardware_type", request.hardware_type
        ).eq("is_active", True).execute()

        if not hardware_result.data:
            # Try to find any active hardware type as fallback
            hardware_result = db.table("approved_hardware").select("id").eq(
                "is_active", True
            ).limit(1).execute()

        hardware_type_id = hardware_result.data[0]["id"] if hardware_result.data else None

        # Allocate SSH port (find next available in range 10000-20000)
        # Use ssh_port as the primary field for the reverse tunnel port
        port_result = db.table("controllers").select("ssh_port").order(
            "ssh_port", desc=True
        ).limit(1).execute()

        next_port = 10000
        if port_result.data and port_result.data[0].get("ssh_port"):
            next_port = port_result.data[0]["ssh_port"] + 1

        # SSH credentials for controller access
        # voltadmin user is created on Pi during setup with standard password
        SSH_USERNAME = "voltadmin"
        SSH_PASSWORD = "Solar@1996"

        # Create new controller
        new_controller = {
            "serial_number": request.serial_number,
            "firmware_version": request.firmware_version,
            "ssh_port": next_port,
            "ssh_tunnel_port": next_port,  # Keep for backward compatibility
            "ssh_username": SSH_USERNAME,
            "ssh_password": SSH_PASSWORD,
            "status": "draft",
            "is_active": True,
            "notes": f"Auto-registered by setup script v{request.firmware_version}"
        }

        if hardware_type_id:
            new_controller["hardware_type_id"] = hardware_type_id

        result = db.table("controllers").insert(new_controller).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create controller record"
            )

        controller = result.data[0]

        # Get Supabase anon key for cloud sync
        supabase_key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

        return SetupScriptRegisterResponse(
            controller_id=str(controller["id"]),
            ssh_tunnel_port=next_port,
            supabase_key=supabase_key,
            status="new",
            message="Controller registered successfully. Assign it to a site via the Volteria platform."
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to register controller: {str(e)}"
        )


@router.get("/by-serial/{serial}/register", response_model=SerialRegisterResponse)
async def register_by_serial(
    serial: str,
    db: Client = Depends(get_supabase)
):
    """
    Register or fetch controller config using Pi's hardware serial number.

    This endpoint is called by the setup script on the Raspberry Pi.
    It reads the Pi's hardware serial from /proc/cpuinfo and calls this endpoint.

    Behavior:
    - If a controller with this serial exists → return its config
    - If no controller exists → create a new one in "draft" status

    No authentication required - the Pi identifies itself by its hardware serial.
    The serial number is unique to each Raspberry Pi and cannot be spoofed easily.
    """
    import os

    # Get Supabase credentials from environment
    # The Pi needs these to connect to Supabase for cloud sync
    supabase_url = os.environ.get("SUPABASE_URL", "")
    # Use anon key if available, otherwise fall back to service key
    # (service key works for Pi but anon key is more appropriate)
    supabase_anon_key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_SERVICE_KEY", "")

    if not supabase_url or not supabase_anon_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server configuration error: Supabase credentials not set"
        )

    try:
        # Check if controller with this serial already exists
        existing = db.table("controllers").select("id, serial_number, status").eq(
            "serial_number", serial
        ).execute()

        if existing.data:
            # Controller already exists - return its config
            controller = existing.data[0]
            return SerialRegisterResponse(
                controller_id=str(controller["id"]),
                serial_number=controller["serial_number"],
                supabase_url=supabase_url,
                supabase_anon_key=supabase_anon_key,
                status="registered",
                message="Controller already registered"
            )

        # Controller doesn't exist - create a new one (self-registration)
        # First, get the default hardware type (Raspberry Pi 5)
        hardware_result = db.table("approved_hardware").select("id").eq(
            "is_active", True
        ).limit(1).execute()

        hardware_type_id = None
        if hardware_result.data:
            hardware_type_id = hardware_result.data[0]["id"]

        # Allocate SSH port (find next available in range 10000-20000)
        port_result = db.table("controllers").select("ssh_port").order(
            "ssh_port", desc=True
        ).limit(1).execute()

        next_port = 10000
        if port_result.data and port_result.data[0].get("ssh_port"):
            next_port = port_result.data[0]["ssh_port"] + 1

        # SSH credentials for controller access
        SSH_USERNAME = "voltadmin"
        SSH_PASSWORD = "Solar@1996"

        # Create new controller in draft status
        new_controller = {
            "serial_number": serial,
            "ssh_port": next_port,
            "ssh_tunnel_port": next_port,
            "ssh_username": SSH_USERNAME,
            "ssh_password": SSH_PASSWORD,
            "status": "draft",
            "is_active": True,
            "notes": "Auto-registered by setup script"
        }

        if hardware_type_id:
            new_controller["hardware_type_id"] = hardware_type_id

        result = db.table("controllers").insert(new_controller).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create controller record"
            )

        controller = result.data[0]

        return SerialRegisterResponse(
            controller_id=str(controller["id"]),
            serial_number=serial,
            supabase_url=supabase_url,
            supabase_anon_key=supabase_anon_key,
            status="new",
            message="Controller registered successfully. Assign it to a site via the Volteria platform."
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to register controller: {str(e)}"
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
        # Check if controller exists (include enterprise_id for reassignment protection)
        existing = db.table("controllers").select("id, status, enterprise_id").eq("id", str(controller_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Controller {controller_id} not found"
            )

        # Check if controller is deployed - cannot edit deployed controllers
        current_status = existing.data[0].get("status")
        if current_status == "deployed":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot edit a deployed controller. Remove it from the site first."
            )

        # Build update data
        update_data = {}
        if update.firmware_version is not None:
            update_data["firmware_version"] = update.firmware_version
        if update.status is not None:
            if update.status not in ["draft", "ready", "claimed", "deployed", "eol"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid status. Must be: draft, ready, claimed, deployed, or eol"
                )
            update_data["status"] = update.status
        if update.notes is not None:
            update_data["notes"] = update.notes

        # Enterprise reassignment protection - only Super Admin can change enterprise
        if update.enterprise_id is not None:
            existing_enterprise = existing.data[0].get("enterprise_id") if existing.data else None
            if existing_enterprise is not None:
                # Controller already has an enterprise - only super_admin can change
                if current_user.role != "super_admin":
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Only Super Admin can reassign a claimed controller to a different enterprise"
                    )
            update_data["enterprise_id"] = update.enterprise_id

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
        # Check if controller exists and get its status
        existing = db.table("controllers").select("id, status").eq("id", str(controller_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Controller {controller_id} not found"
            )

        # Check if controller is deployed - cannot delete deployed controllers
        current_status = existing.data[0].get("status")
        if current_status == "deployed":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot delete a deployed controller. Remove it from the site first."
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
        # Only enterprise_admin or configurator can claim
        if current_user.role not in ["enterprise_admin", "configurator"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only enterprise admins and configurators can claim controllers"
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
            if controller.get("status") in ["claimed", "deployed"]:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This controller has already been claimed"
                )
            elif controller.get("status") == "eol":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="This controller has been decommissioned and cannot be claimed"
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

        # Claim the controller - status becomes 'claimed' (not 'deployed')
        # Controller will become 'deployed' when added to a site
        update_data = {
            "enterprise_id": enterprise_id,
            "claimed_at": datetime.utcnow().isoformat(),
            "claimed_by": current_user.id,
            "status": "claimed"
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


# ============================================
# ENDPOINTS - CONTROLLER CONFIGURATION
# ============================================

class ControllerConfigResponse(BaseModel):
    """Configuration response for controller startup."""
    status: str  # "assigned", "unassigned", or "error"
    message: Optional[str] = None
    controller: Optional[dict] = None
    site: Optional[dict] = None


@router.get("/{controller_id}/config", response_model=ControllerConfigResponse)
async def get_controller_config(
    controller_id: UUID,
    db: Client = Depends(get_supabase)
):
    """
    Get configuration for a controller.

    This endpoint is called by controllers on startup to fetch their configuration.
    No authentication required - controllers identify themselves by their ID.

    Returns:
    - If controller is assigned to a site: full site configuration
    - If controller is not assigned: status "unassigned"
    """
    try:
        # 1. Find the controller
        controller_result = db.table("controllers").select("""
            *,
            approved_hardware:hardware_type_id (name, hardware_type)
        """).eq("id", str(controller_id)).execute()

        if not controller_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Controller {controller_id} not found"
            )

        controller = controller_result.data[0]

        # 2. Check if controller is assigned to a site
        # Primary: Check controllers.site_id (set when deployed via register_controller)
        # Fallback: Check site_master_devices table
        site = None
        site_id = controller.get("site_id")

        if site_id:
            # Controller has site_id set directly - fetch site config
            site_result = db.table("sites").select("""
                id,
                name,
                location,
                project_id,
                control_method,
                control_method_backup,
                grid_connection,
                operation_mode,
                dg_reserve_kw,
                control_interval_ms,
                logging_local_interval_ms,
                logging_cloud_interval_ms,
                logging_local_retention_days,
                logging_cloud_enabled,
                logging_gateway_enabled,
                safe_mode_enabled,
                safe_mode_type,
                safe_mode_timeout_s,
                safe_mode_rolling_window_min,
                safe_mode_threshold_pct,
                safe_mode_power_limit_kw,
                is_active
            """).eq("id", str(site_id)).execute()

            if site_result.data:
                site = site_result.data[0]

        # Fallback: Check site_master_devices if no site found via controllers.site_id
        if not site:
            site_assignment = db.table("site_master_devices").select("""
                site_id,
                sites:site_id (
                    id,
                    name,
                    location,
                    project_id,
                    control_method,
                    control_method_backup,
                    grid_connection,
                    operation_mode,
                    dg_reserve_kw,
                    control_interval_ms,
                    logging_local_interval_ms,
                    logging_cloud_interval_ms,
                    logging_local_retention_days,
                    logging_cloud_enabled,
                    logging_gateway_enabled,
                    safe_mode_enabled,
                    safe_mode_type,
                    safe_mode_timeout_s,
                    safe_mode_rolling_window_min,
                    safe_mode_threshold_pct,
                    safe_mode_power_limit_kw,
                    is_active
                )
            """).eq("controller_id", str(controller_id)).execute()

            if site_assignment.data and site_assignment.data[0].get("sites"):
                site = site_assignment.data[0]["sites"]

        # If still no site found, controller is not assigned
        if not site:
            return ControllerConfigResponse(
                status="unassigned",
                message="Controller not yet assigned to a site. Assign via the Volteria platform.",
                controller={
                    "id": str(controller["id"]),
                    "serial_number": controller.get("serial_number"),
                    "hardware_type": controller.get("approved_hardware", {}).get("hardware_type"),
                    "status": controller.get("status")
                }
            )

        # 3. Get site data (site is already populated from above)
        site_id = site["id"]

        # 4. Get all devices for this site
        # Query both logging_registers (new) and registers (legacy) for backward compatibility
        devices_result = db.table("site_devices").select("""
            *,
            device_templates:template_id (
                template_id,
                name,
                device_type,
                brand,
                model,
                rated_power_kw,
                rated_power_kva,
                logging_registers,
                registers
            )
        """).eq("site_id", str(site_id)).eq("enabled", True).execute()

        # 5. Organize devices by type
        load_meters = []
        inverters = []
        generators = []

        for device in devices_result.data or []:
            template = device.get("device_templates") or {}
            device_type = template.get("device_type", "")

            device_config = {
                "id": str(device["id"]),
                "name": device.get("name"),
                "template": template.get("template_id"),
                "device_type": device_type,
                "protocol": device.get("protocol"),
                "ip": device.get("ip_address"),
                "port": device.get("port"),
                "slave_id": device.get("slave_id"),
                "rated_power_kw": template.get("rated_power_kw"),
                "rated_power_kva": template.get("rated_power_kva"),
                "measurement_type": device.get("measurement_type"),
                # Use logging_registers if available, fall back to legacy registers
                "registers": template.get("logging_registers") or template.get("registers", [])
            }

            if device_type == "load_meter":
                load_meters.append(device_config)
            elif device_type == "inverter":
                inverters.append(device_config)
            elif device_type == "dg":
                generators.append(device_config)

        # 6. Build site configuration
        site_config = {
            "id": str(site_id),
            "name": site.get("name"),
            "location": site.get("location"),
            "project_id": str(site.get("project_id")),
            "control": {
                "method": site.get("control_method"),
                "method_backup": site.get("control_method_backup"),
                "grid_connection": site.get("grid_connection"),
                "operation_mode": site.get("operation_mode"),
                "dg_reserve_kw": site.get("dg_reserve_kw"),
                "interval_ms": site.get("control_interval_ms")
            },
            "logging": {
                "local_interval_ms": site.get("logging_local_interval_ms"),
                "cloud_interval_ms": site.get("logging_cloud_interval_ms"),
                "local_retention_days": site.get("logging_local_retention_days"),
                "cloud_enabled": site.get("logging_cloud_enabled"),
                "gateway_enabled": site.get("logging_gateway_enabled")
            },
            "safe_mode": {
                "enabled": site.get("safe_mode_enabled"),
                "type": site.get("safe_mode_type"),
                "timeout_s": site.get("safe_mode_timeout_s"),
                "rolling_window_min": site.get("safe_mode_rolling_window_min"),
                "threshold_pct": site.get("safe_mode_threshold_pct"),
                "power_limit_kw": site.get("safe_mode_power_limit_kw")
            },
            "devices": {
                "load_meters": load_meters,
                "inverters": inverters,
                "generators": generators
            }
        }

        return ControllerConfigResponse(
            status="assigned",
            message="Configuration loaded successfully",
            controller={
                "id": str(controller["id"]),
                "serial_number": controller.get("serial_number"),
                "hardware_type": controller.get("approved_hardware", {}).get("hardware_type"),
                "status": controller.get("status")
            },
            site=site_config
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch controller config: {str(e)}"
        )


# ============================================
# ENDPOINTS - REBOOT CONTROLLER
# ============================================

class RebootResponse(BaseModel):
    """Response for reboot command."""
    success: bool
    command_id: Optional[str] = None
    message: str


def execute_ssh_reboot(host: str, port: int, username: str, password: str) -> tuple[bool, str]:
    """
    Execute GRACEFUL reboot command via SSH.
    Stops services and syncs filesystem before rebooting to prevent corruption.
    Returns (success, message).
    """
    import paramiko

    try:
        # Create SSH client
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        # Connect via reverse tunnel
        client.connect(
            hostname=host,
            port=port,
            username=username,
            password=password,
            timeout=10,
            banner_timeout=10,
            auth_timeout=10
        )

        # GRACEFUL SHUTDOWN SEQUENCE:
        # 1. Stop all Volteria services (gives them time to cleanup SQLite, logs, etc.)
        # 2. Sync filesystem to ensure all writes are flushed to disk
        # 3. Small delay for final cleanup
        # 4. Reboot
        # This prevents kernel panic and filesystem corruption from abrupt shutdown
        graceful_reboot_cmd = (
            "sudo systemctl stop volteria-supervisor volteria-logging volteria-control "
            "volteria-device volteria-config volteria-system 2>/dev/null; "
            "sleep 2; "
            "sync; "
            "sleep 1; "
            "sudo reboot"
        )

        stdin, stdout, stderr = client.exec_command(graceful_reboot_cmd, timeout=30)

        # Don't wait for output - reboot will kill the connection
        client.close()

        return True, "Graceful reboot command executed successfully"

    except paramiko.AuthenticationException:
        return False, "SSH authentication failed"
    except paramiko.SSHException as e:
        return False, f"SSH error: {str(e)}"
    except Exception as e:
        # Connection reset is expected during reboot
        if "reset" in str(e).lower() or "closed" in str(e).lower():
            return True, "Reboot command executed (connection closed as expected)"
        return False, f"Failed to connect: {str(e)}"


@router.post("/{controller_id}/reboot", response_model=RebootResponse)
async def reboot_controller(
    controller_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """
    Reboot a controller via SSH through the reverse tunnel.

    The reboot is executed immediately by connecting to the controller
    via its SSH reverse tunnel and running 'sudo reboot'.

    Requires:
    - User to be authenticated
    - Controller must have SSH credentials configured
    - One of the following permissions:
      - User is super_admin, backend_admin, or admin
      - User's enterprise owns the controller (via enterprise_id)
      - User has can_control access to the site where controller is assigned
    """
    try:
        # 1. Get controller with SSH credentials and enterprise_id
        controller_result = db.table("controllers").select(
            "id, serial_number, ssh_port, ssh_username, ssh_password, enterprise_id"
        ).eq("id", str(controller_id)).execute()

        if not controller_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Controller {controller_id} not found"
            )

        controller = controller_result.data[0]

        # Check SSH credentials are available
        if not controller.get("ssh_port") or not controller.get("ssh_username"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Controller SSH credentials not configured. Complete the setup wizard first."
            )

        # 2. Check permissions - multiple ways to authorize
        is_admin = current_user.role in ["super_admin", "backend_admin", "admin"]
        can_reboot = is_admin

        # 3. If not admin, check if user's enterprise owns this controller
        if not can_reboot and controller.get("enterprise_id"):
            user_result = db.table("users").select("enterprise_id").eq("id", current_user.id).execute()
            if user_result.data:
                user_enterprise = user_result.data[0].get("enterprise_id")
                if user_enterprise and user_enterprise == controller.get("enterprise_id"):
                    can_reboot = True

        # 4. If still not allowed, check site assignment for project-level access
        site_id = None
        project_id = None
        if not can_reboot:
            site_assignment = db.table("site_master_devices").select(
                "site_id, sites:site_id (id, project_id)"
            ).eq("controller_id", str(controller_id)).execute()

            if site_assignment.data:
                site_data = site_assignment.data[0]
                site_id = site_data["site_id"]
                project_id = site_data.get("sites", {}).get("project_id")

                # Check project access
                access_result = db.table("user_projects").select(
                    "can_control"
                ).eq("user_id", current_user.id).eq("project_id", str(project_id)).execute()

                if access_result.data and access_result.data[0].get("can_control"):
                    can_reboot = True

        # 5. If still not allowed, deny access
        if not can_reboot:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to reboot this controller"
            )

        # 6. Get site_id for audit log if we haven't already looked it up
        if site_id is None and (is_admin or can_reboot):
            site_assignment = db.table("site_master_devices").select(
                "site_id"
            ).eq("controller_id", str(controller_id)).execute()
            if site_assignment.data:
                site_id = site_assignment.data[0]["site_id"]

        # 7. Execute SSH reboot
        # Use host.docker.internal to reach SSH tunnels on the host machine
        # The reverse SSH tunnels listen on localhost of the host, accessible via Docker's host-gateway
        SSH_HOST = "host.docker.internal"

        success, message = execute_ssh_reboot(
            host=SSH_HOST,
            port=controller["ssh_port"],
            username=controller["ssh_username"],
            password=controller.get("ssh_password", "")
        )

        # 8. Log the action to audit_logs
        db.table("audit_logs").insert({
            "user_id": current_user.id,
            "action": "reboot",
            "action_category": "control",
            "resource_type": "controller",
            "resource_id": str(controller_id),
            "resource_name": controller['serial_number'],
            "metadata": {
                "site_id": str(site_id) if site_id else None,
                "ssh_port": controller["ssh_port"],
                "success": success,
                "message": message
            },
            "status": "success" if success else "failed"
        }).execute()

        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=message
            )

        return RebootResponse(
            success=True,
            message=f"Reboot command sent to {controller['serial_number']}. Controller will restart shortly."
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to reboot controller: {str(e)}"
        )
