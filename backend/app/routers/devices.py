"""
Devices Router

Handles device management:
- Device templates (reusable across all projects)
- Project devices (specific to a project with connection details)
- Device status monitoring
"""

import re
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from supabase import Client


def generate_alias(name: str) -> str:
    """
    Convert display name to code-friendly alias (snake_case).

    Examples:
        "Active Power" -> "active_power"
        "Voltage Phase-A" -> "voltage_phase_a"
        "Power Limit %" -> "power_limit_pct"
        "DC/AC Ratio" -> "dc_ac_ratio"
        "3-Phase Voltage" -> "reg_3_phase_voltage"
    """
    # Start with lowercase
    alias = name.lower()

    # Replace common special characters with meaningful text
    alias = alias.replace('%', 'pct')
    alias = alias.replace('/', '_')
    alias = alias.replace('-', '_')

    # Replace any remaining non-alphanumeric characters with underscore
    alias = re.sub(r'[^a-z0-9_]', '_', alias)

    # Collapse multiple underscores into one
    alias = re.sub(r'_+', '_', alias)

    # Remove leading/trailing underscores
    alias = alias.strip('_')

    # Ensure starts with letter (prefix with 'reg_' if starts with number)
    if alias and alias[0].isdigit():
        alias = 'reg_' + alias

    return alias or 'register'

from app.services.supabase import get_supabase
from app.dependencies.auth import (
    CurrentUser,
    get_current_user,
    require_role,
    require_project_access
)

router = APIRouter()


# ============================================
# SCHEMAS - TEMPLATES
# ============================================

class ModbusRegister(BaseModel):
    """Modbus register definition."""
    address: int
    name: str  # Display name (can be any format, e.g., "Active Power")
    alias: Optional[str] = None  # Code-friendly name (auto-generated if not provided)
    description: Optional[str] = None
    type: str = "input"  # 'input' or 'holding'
    access: str = "read"  # 'read', 'write', or 'readwrite'
    datatype: str = "uint16"  # 'uint16', 'int16', 'uint32', 'int32', 'float32'
    scale: Optional[float] = 1.0  # Multiplication factor
    offset: Optional[float] = 0.0  # Addition factor (can be negative)
    scale_order: Optional[str] = "multiply_first"  # 'multiply_first' or 'add_first'
    logging_frequency: Optional[float] = 60  # Logging frequency in seconds (default: 1 minute)
    unit: Optional[str] = None
    values: Optional[dict] = None  # For enum-type registers
    register_role: Optional[str] = "none"  # Control logic role (e.g., "solar_active_power")


class DeviceTemplateCreate(BaseModel):
    """Create device template request."""
    template_id: str  # e.g., "sungrow_150kw"
    name: str  # e.g., "Sungrow SG150KTL-M"
    device_type: str  # 'inverter', 'dg', 'load_meter'
    operation: str  # 'solar', 'dg', 'meter'
    brand: str
    model: str
    rated_power_kw: Optional[float] = None
    rated_power_kva: Optional[float] = None
    registers: list[ModbusRegister] = []
    specifications: dict = {}
    # Template type and enterprise assignment (for custom templates)
    template_type: Optional[str] = None  # 'public' or 'custom' (defaults based on role)
    enterprise_id: Optional[str] = None  # Required for custom templates


class DeviceTemplateResponse(BaseModel):
    """Device template response."""
    id: str
    template_id: str
    name: str
    device_type: str
    operation: str
    brand: str
    model: str
    rated_power_kw: Optional[float]
    rated_power_kva: Optional[float]
    registers: list[dict]  # Changed from list[ModbusRegister] for flexibility
    specifications: dict
    is_active: bool


class DeviceTemplateUpdate(BaseModel):
    """Update device template request (all fields optional)."""
    name: Optional[str] = None
    device_type: Optional[str] = None
    operation: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    rated_power_kw: Optional[float] = None
    rated_power_kva: Optional[float] = None
    template_type: Optional[str] = None
    registers: Optional[list[ModbusRegister]] = None
    specifications: Optional[dict] = None


class DeviceTemplateDuplicate(BaseModel):
    """Duplicate device template request."""
    new_template_id: str = Field(..., description="Unique ID for the new template")
    new_name: str = Field(..., description="Name for the new template (must differ from original)")
    template_type: Optional[str] = Field(None, description="Template type: 'public' or 'custom' (super_admin/backend_admin only)")
    enterprise_id: Optional[str] = Field(None, description="Enterprise to assign (required for custom templates)")


# ============================================
# SCHEMAS - PROJECT DEVICES
# ============================================

class ProjectDeviceCreate(BaseModel):
    """Create project device request."""
    template_id: str  # Reference to device template
    name: str  # Device name in this project, e.g., "DG-1"

    # Protocol determines which connection fields are required
    protocol: str  # 'tcp', 'rtu_gateway', 'rtu_direct'

    # For TCP protocol
    ip_address: Optional[str] = None
    port: int = 502

    # For RTU via Gateway
    gateway_ip: Optional[str] = None
    gateway_port: int = 502

    # For Direct RTU
    serial_port: Optional[str] = None
    baudrate: int = 9600

    # Modbus slave ID (required for all)
    slave_id: int

    # Optional overrides
    rated_power_kw: Optional[float] = None
    rated_power_kva: Optional[float] = None


class ProjectDeviceUpdate(BaseModel):
    """Update project device request."""
    name: Optional[str] = None
    ip_address: Optional[str] = None
    port: Optional[int] = None
    gateway_ip: Optional[str] = None
    gateway_port: Optional[int] = None
    slave_id: Optional[int] = None
    rated_power_kw: Optional[float] = None
    rated_power_kva: Optional[float] = None
    enabled: Optional[bool] = None


class ProjectDeviceResponse(BaseModel):
    """Project device response."""
    id: str
    project_id: str
    site_id: Optional[str] = None  # Added for sites architecture
    template: Optional[DeviceTemplateResponse]
    name: str
    protocol: str
    ip_address: Optional[str]
    port: Optional[int]
    gateway_ip: Optional[str]
    gateway_port: Optional[int]
    slave_id: int
    rated_power_kw: Optional[float]
    rated_power_kva: Optional[float]
    is_online: bool
    last_seen: Optional[str]
    last_error: Optional[str]
    enabled: bool


# ============================================
# HELPER FUNCTIONS
# ============================================

def db_row_to_template_response(row: dict) -> DeviceTemplateResponse:
    """Convert database row to DeviceTemplateResponse."""
    return DeviceTemplateResponse(
        id=str(row["id"]),
        template_id=row.get("template_id", ""),
        name=row.get("name", ""),
        device_type=row.get("device_type", "unknown"),
        operation=row.get("operation", "unknown"),
        brand=row.get("brand", ""),
        model=row.get("model", ""),
        rated_power_kw=float(row["rated_power_kw"]) if row.get("rated_power_kw") else None,
        rated_power_kva=float(row["rated_power_kva"]) if row.get("rated_power_kva") else None,
        # Support both new column name (logging_registers) and legacy (registers) for backward compatibility
        registers=row.get("logging_registers") or row.get("registers", []) or [],
        specifications=row.get("specifications", {}) or {},
        is_active=row.get("is_active", True)
    )


def db_row_to_device_response(row: dict, template: Optional[dict] = None) -> ProjectDeviceResponse:
    """Convert database row to ProjectDeviceResponse."""
    template_response = None
    if template:
        template_response = db_row_to_template_response(template)
    elif row.get("device_templates"):
        template_response = db_row_to_template_response(row["device_templates"])

    return ProjectDeviceResponse(
        id=str(row["id"]),
        project_id=str(row["project_id"]),
        site_id=str(row["site_id"]) if row.get("site_id") else None,  # Added for sites architecture
        template=template_response,
        name=row["name"],
        protocol=row.get("protocol", "tcp"),
        ip_address=row.get("ip_address"),
        port=row.get("port"),
        gateway_ip=row.get("gateway_ip"),
        gateway_port=row.get("gateway_port"),
        slave_id=row.get("slave_id", 1),
        rated_power_kw=float(row["rated_power_kw"]) if row.get("rated_power_kw") else None,
        rated_power_kva=float(row["rated_power_kva"]) if row.get("rated_power_kva") else None,
        is_online=row.get("is_online", False),
        last_seen=row.get("last_seen"),
        last_error=row.get("last_error"),
        enabled=row.get("enabled", True)
    )


# ============================================
# TEMPLATE ENDPOINTS
# ============================================

@router.get("/templates", response_model=list[DeviceTemplateResponse])
async def list_templates(
    device_type: Optional[str] = Query(None, description="Filter by device type"),
    brand: Optional[str] = Query(None, description="Filter by brand"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """
    List all available device templates.

    Templates are reusable definitions shared across all projects.
    Filter by device_type or brand as needed.
    Any authenticated user can view templates.
    """
    try:
        query = db.table("device_templates").select("*").eq("is_active", True)

        if device_type:
            query = query.eq("device_type", device_type)
        if brand:
            query = query.ilike("brand", f"%{brand}%")

        result = query.order("name").execute()

        return [db_row_to_template_response(row) for row in result.data]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch templates: {str(e)}"
        )


@router.get("/templates/{template_id}", response_model=DeviceTemplateResponse)
async def get_template(
    template_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """
    Get device template by template_id.

    Returns full template including all Modbus registers.
    Any authenticated user can view templates.
    """
    try:
        result = db.table("device_templates").select("*").eq("template_id", template_id).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Template {template_id} not found"
            )

        return db_row_to_template_response(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch template: {str(e)}"
        )


@router.post("/templates", response_model=DeviceTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_template(
    template: DeviceTemplateCreate,
    current_user: CurrentUser = Depends(require_role([
        "super_admin", "backend_admin", "admin", "enterprise_admin", "configurator"
    ])),
    db: Client = Depends(get_supabase)
):
    """
    Create a new device template.

    Permissions:
    - super_admin/backend_admin/admin: Can create public or custom templates
    - enterprise_admin/configurator: Can only create custom templates for their enterprise
    """
    try:
        # Check if template_id already exists
        existing = db.table("device_templates").select("id").eq("template_id", template.template_id).execute()
        if existing.data:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Template with ID '{template.template_id}' already exists"
            )

        # Determine template_type and enterprise_id based on user role
        is_high_role = current_user.role in ["super_admin", "backend_admin", "admin"]

        # High roles can choose template_type; lower roles are forced to "custom"
        resolved_template_type = template.template_type if is_high_role else "custom"
        if not resolved_template_type:
            resolved_template_type = "public" if is_high_role else "custom"

        # Determine enterprise_id
        resolved_enterprise_id = None
        if resolved_template_type == "custom":
            if is_high_role:
                # Admin selects enterprise from request
                resolved_enterprise_id = template.enterprise_id
            else:
                # Enterprise admin/configurator uses their own enterprise
                resolved_enterprise_id = current_user.enterprise_id

            if not resolved_enterprise_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Enterprise ID is required for custom templates"
                )
        elif not is_high_role:
            # Lower roles cannot create public templates
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only admins can create public templates"
            )

        # Process registers: auto-generate alias if not provided
        processed_registers = []
        for reg in template.registers:
            reg_dict = reg.model_dump()
            # Auto-generate alias from name if not provided
            if not reg_dict.get("alias"):
                reg_dict["alias"] = generate_alias(reg.name)
            processed_registers.append(reg_dict)

        insert_data = {
            "template_id": template.template_id,
            "name": template.name,
            "device_type": template.device_type,
            "operation": template.operation,
            "brand": template.brand,
            "model": template.model,
            "rated_power_kw": template.rated_power_kw,
            "rated_power_kva": template.rated_power_kva,
            "logging_registers": processed_registers,  # New column name (migration 045)
            "specifications": template.specifications,
            "is_active": True,
            "template_type": resolved_template_type,
            "enterprise_id": resolved_enterprise_id,
            "created_by": str(current_user.id)
        }

        result = db.table("device_templates").insert(insert_data).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create template"
            )

        return db_row_to_template_response(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create template: {str(e)}"
        )


@router.patch("/templates/{template_id}", response_model=DeviceTemplateResponse)
async def update_template(
    template_id: str,
    template_update: DeviceTemplateUpdate,
    current_user: CurrentUser = Depends(require_role([
        "super_admin", "backend_admin", "admin", "enterprise_admin", "configurator"
    ])),
    db: Client = Depends(get_supabase)
):
    """
    Update an existing device template.

    Permissions:
    - super_admin/backend_admin/admin: Can edit any template
    - enterprise_admin/configurator: Can only edit custom templates from their enterprise
    """
    try:
        # Find existing template by template_id
        existing = db.table("device_templates").select("*").eq("template_id", template_id).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Template '{template_id}' not found"
            )

        existing_template = existing.data[0]
        is_high_role = current_user.role in ["super_admin", "backend_admin", "admin"]

        # Enterprise admin/configurator can only edit their enterprise's custom templates
        if not is_high_role:
            if existing_template.get("template_type") != "custom":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You can only edit custom templates"
                )
            if existing_template.get("enterprise_id") != current_user.enterprise_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You can only edit templates from your enterprise"
                )

        # Build update data - only include fields that were provided
        update_data = {}
        update_dict = template_update.model_dump(exclude_unset=True)

        for field, value in update_dict.items():
            if field == "registers" and value is not None:
                # Process registers: auto-generate alias if not provided
                processed_registers = []
                for reg in value:
                    # Handle both ModbusRegister objects and dicts
                    reg_dict = reg.model_dump() if hasattr(reg, 'model_dump') else reg
                    # Auto-generate alias from name if not provided
                    if not reg_dict.get("alias"):
                        reg_dict["alias"] = generate_alias(reg_dict["name"])
                    processed_registers.append(reg_dict)
                update_data["logging_registers"] = processed_registers  # New column name (migration 045)
            elif value is not None:
                update_data[field] = value

        # If no fields to update, return existing template
        if not update_data:
            return db_row_to_template_response(existing.data[0])

        # Perform the update
        result = db.table("device_templates").update(update_data).eq("template_id", template_id).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update template"
            )

        return db_row_to_template_response(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update template: {str(e)}"
        )


@router.post("/templates/{template_id}/duplicate", response_model=DeviceTemplateResponse, status_code=status.HTTP_201_CREATED)
async def duplicate_template(
    template_id: str,
    duplicate_request: DeviceTemplateDuplicate,
    current_user: CurrentUser = Depends(require_role([
        "super_admin", "backend_admin", "admin", "enterprise_admin", "configurator"
    ])),
    db: Client = Depends(get_supabase)
):
    """
    Duplicate an existing device template.

    Creates a custom template based on an existing template.
    The duplicated template is always a "custom" template assigned to an enterprise.

    Permissions:
    - super_admin/backend_admin/admin: Can duplicate any template, can assign to any enterprise
    - enterprise_admin/configurator: Can only duplicate visible templates, assigned to their enterprise
    """
    try:
        # 1. Fetch the source template
        source_result = db.table("device_templates").select("*").eq("template_id", template_id).execute()

        if not source_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Template '{template_id}' not found"
            )

        source = source_result.data[0]

        # 2. Validate new_name is different from source
        if duplicate_request.new_name.strip().lower() == source["name"].strip().lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New template name must be different from the original"
            )

        # 3. Check if new_template_id already exists
        existing = db.table("device_templates").select("id").eq("template_id", duplicate_request.new_template_id).execute()
        if existing.data:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Template with ID '{duplicate_request.new_template_id}' already exists"
            )

        # 4. Determine template_type and enterprise_id
        user_role = current_user.role
        user_enterprise_id = current_user.enterprise_id
        is_high_role = user_role in ["super_admin", "backend_admin"]

        # Determine template_type (only super_admin/backend_admin can create public)
        if duplicate_request.template_type == "public":
            if not is_high_role:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only super_admin and backend_admin can create public templates"
                )
            resolved_template_type = "public"
            target_enterprise_id = None  # Public templates have no enterprise
        else:
            # Custom template (default for all users)
            resolved_template_type = "custom"

            if duplicate_request.enterprise_id:
                # Only admins can specify a different enterprise
                if user_role not in ["super_admin", "backend_admin", "admin"]:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Only admins can assign templates to a different enterprise"
                    )
                target_enterprise_id = duplicate_request.enterprise_id
            else:
                # Use user's enterprise
                if not user_enterprise_id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Enterprise ID is required for custom templates"
                    )
                target_enterprise_id = user_enterprise_id

        # 5. Build the new template data (copy all fields from source)
        insert_data = {
            "template_id": duplicate_request.new_template_id,
            "name": duplicate_request.new_name,
            "device_type": source.get("device_type"),
            "operation": source.get("operation"),
            "brand": source.get("brand"),
            "model": source.get("model"),
            "rated_power_kw": source.get("rated_power_kw"),
            "rated_power_kva": source.get("rated_power_kva"),
            # Copy all register types
            "logging_registers": source.get("logging_registers") or source.get("registers") or [],
            "visualization_registers": source.get("visualization_registers") or [],
            "alarm_registers": source.get("alarm_registers") or [],
            "specifications": source.get("specifications") or {},
            # Set template type and enterprise
            "template_type": resolved_template_type,
            "enterprise_id": target_enterprise_id,
            "created_by": str(current_user.id),
            "is_active": True
        }

        # 6. Insert the new template
        result = db.table("device_templates").insert(insert_data).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create duplicate template"
            )

        return db_row_to_template_response(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to duplicate template: {str(e)}"
        )


# ============================================
# PROJECT DEVICE ENDPOINTS
# ============================================

@router.get("/project/{project_id}", response_model=list[ProjectDeviceResponse])
async def list_site_devices(
    project_id: UUID,
    device_type: Optional[str] = Query(None, description="Filter by device type"),
    current_user: CurrentUser = Depends(require_project_access()),
    db: Client = Depends(get_supabase)
):
    """
    List all devices configured for a project.

    Includes connection details and current status.
    Filter by device_type if needed.
    User must have access to the project.
    """
    try:
        query = db.table("site_devices").select(
            "*, device_templates(*)"
        ).eq("project_id", str(project_id)).eq("enabled", True)

        result = query.order("name").execute()

        devices = []
        for row in result.data:
            # Filter by device_type if specified
            if device_type:
                template = row.get("device_templates", {})
                if template.get("device_type") != device_type:
                    continue
            devices.append(db_row_to_device_response(row))

        return devices
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch devices: {str(e)}"
        )


@router.post("/project/{project_id}", response_model=ProjectDeviceResponse, status_code=status.HTTP_201_CREATED)
async def add_project_device(
    project_id: UUID,
    device: ProjectDeviceCreate,
    current_user: CurrentUser = Depends(require_project_access(require_edit=True)),
    db: Client = Depends(get_supabase)
):
    """
    Add a device to a project.

    User must have edit permission for this project.
    Validates that connection fields match the selected protocol.
    """
    # Validate protocol-specific fields
    if device.protocol == "tcp":
        if not device.ip_address:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="ip_address is required for TCP protocol"
            )
    elif device.protocol == "rtu_gateway":
        if not device.gateway_ip:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="gateway_ip is required for RTU gateway protocol"
            )
    elif device.protocol == "rtu_direct":
        if not device.serial_port:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="serial_port is required for direct RTU protocol"
            )

    try:
        # ============================================
        # MODBUS CONFLICT VALIDATION
        # Prevent duplicate Slave ID + connection combinations
        # ============================================

        # Build query to check for existing devices with same connection
        conflict_query = db.table("site_devices").select("id, name").eq(
            "project_id", str(project_id)
        ).eq("enabled", True).eq("slave_id", device.slave_id)

        # Add protocol-specific conflict check
        if device.protocol == "tcp":
            conflict_query = conflict_query.eq("ip_address", device.ip_address).eq("port", device.port)
        elif device.protocol == "rtu_gateway":
            conflict_query = conflict_query.eq("gateway_ip", device.gateway_ip).eq("gateway_port", device.gateway_port)
        elif device.protocol == "rtu_direct":
            conflict_query = conflict_query.eq("serial_port", device.serial_port)

        conflict_result = conflict_query.execute()

        if conflict_result.data:
            existing_device = conflict_result.data[0]
            if device.protocol == "tcp":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Modbus conflict: Device '{existing_device['name']}' already uses Slave ID {device.slave_id} at {device.ip_address}:{device.port}"
                )
            elif device.protocol == "rtu_gateway":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Modbus conflict: Device '{existing_device['name']}' already uses Slave ID {device.slave_id} at gateway {device.gateway_ip}:{device.gateway_port}"
                )
            else:  # rtu_direct
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Modbus conflict: Device '{existing_device['name']}' already uses Slave ID {device.slave_id} on {device.serial_port}"
                )
        # Verify project exists
        project = db.table("projects").select("id").eq("id", str(project_id)).execute()
        if not project.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project {project_id} not found"
            )

        # Get template ID from template_id string
        template = db.table("device_templates").select("id").eq("template_id", device.template_id).execute()
        if not template.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Template {device.template_id} not found"
            )

        insert_data = {
            "project_id": str(project_id),
            "template_id": template.data[0]["id"],
            "name": device.name,
            "protocol": device.protocol,
            "ip_address": device.ip_address,
            "port": device.port,
            "gateway_ip": device.gateway_ip,
            "gateway_port": device.gateway_port,
            "slave_id": device.slave_id,
            "rated_power_kw": device.rated_power_kw,
            "rated_power_kva": device.rated_power_kva,
            "is_online": False,
            "enabled": True
        }

        result = db.table("site_devices").insert(insert_data).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to add device"
            )

        # Fetch with template info
        device_result = db.table("site_devices").select(
            "*, device_templates(*)"
        ).eq("id", result.data[0]["id"]).execute()

        return db_row_to_device_response(device_result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to add device: {str(e)}"
        )


@router.get("/project/{project_id}/{device_id}", response_model=ProjectDeviceResponse)
async def get_project_device(
    project_id: UUID,
    device_id: UUID,
    current_user: CurrentUser = Depends(require_project_access()),
    db: Client = Depends(get_supabase)
):
    """
    Get device details by ID.

    Includes template info, connection details, and status.
    User must have access to the project.
    """
    try:
        result = db.table("site_devices").select(
            "*, device_templates(*)"
        ).eq("id", str(device_id)).eq("project_id", str(project_id)).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device {device_id} not found"
            )

        return db_row_to_device_response(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch device: {str(e)}"
        )


@router.patch("/project/{project_id}/{device_id}", response_model=ProjectDeviceResponse)
async def update_project_device(
    project_id: UUID,
    device_id: UUID,
    update: ProjectDeviceUpdate,
    current_user: CurrentUser = Depends(require_project_access(require_edit=True)),
    db: Client = Depends(get_supabase)
):
    """
    Update device configuration.

    User must have edit permission for this project.
    Cannot change the device template after creation.
    """
    try:
        # Check if device exists
        existing = db.table("site_devices").select("id").eq("id", str(device_id)).eq("project_id", str(project_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device {device_id} not found"
            )

        # Build update data (only include non-None fields)
        update_data = {}
        if update.name is not None:
            update_data["name"] = update.name
        if update.ip_address is not None:
            update_data["ip_address"] = update.ip_address
        if update.port is not None:
            update_data["port"] = update.port
        if update.gateway_ip is not None:
            update_data["gateway_ip"] = update.gateway_ip
        if update.gateway_port is not None:
            update_data["gateway_port"] = update.gateway_port
        if update.slave_id is not None:
            update_data["slave_id"] = update.slave_id
        if update.rated_power_kw is not None:
            update_data["rated_power_kw"] = update.rated_power_kw
        if update.rated_power_kva is not None:
            update_data["rated_power_kva"] = update.rated_power_kva
        if update.enabled is not None:
            update_data["enabled"] = update.enabled

        if not update_data:
            # Nothing to update, return current
            result = db.table("site_devices").select(
                "*, device_templates(*)"
            ).eq("id", str(device_id)).execute()
            return db_row_to_device_response(result.data[0])

        # ============================================
        # MODBUS CONFLICT VALIDATION FOR UPDATES
        # Check if updated connection settings conflict with other devices
        # ============================================

        # Only check if connection-related fields are being updated
        connection_fields_updated = any([
            update.slave_id is not None,
            update.ip_address is not None,
            update.port is not None,
            update.gateway_ip is not None,
            update.gateway_port is not None,
        ])

        if connection_fields_updated:
            # Get current device data to merge with updates
            current_device = db.table("site_devices").select(
                "protocol, ip_address, port, gateway_ip, gateway_port, slave_id"
            ).eq("id", str(device_id)).execute()

            if current_device.data:
                current = current_device.data[0]
                # Merge current values with updates
                final_slave_id = update.slave_id if update.slave_id is not None else current["slave_id"]
                final_ip = update.ip_address if update.ip_address is not None else current.get("ip_address")
                final_port = update.port if update.port is not None else current.get("port")
                final_gateway_ip = update.gateway_ip if update.gateway_ip is not None else current.get("gateway_ip")
                final_gateway_port = update.gateway_port if update.gateway_port is not None else current.get("gateway_port")
                protocol = current["protocol"]

                # Build conflict query excluding current device
                conflict_query = db.table("site_devices").select("id, name").eq(
                    "project_id", str(project_id)
                ).eq("enabled", True).eq("slave_id", final_slave_id).neq("id", str(device_id))

                # Add protocol-specific conflict check
                if protocol == "tcp" and final_ip:
                    conflict_query = conflict_query.eq("ip_address", final_ip).eq("port", final_port)
                elif protocol == "rtu_gateway" and final_gateway_ip:
                    conflict_query = conflict_query.eq("gateway_ip", final_gateway_ip).eq("gateway_port", final_gateway_port)

                conflict_result = conflict_query.execute()

                if conflict_result.data:
                    existing_device = conflict_result.data[0]
                    if protocol == "tcp":
                        raise HTTPException(
                            status_code=status.HTTP_409_CONFLICT,
                            detail=f"Modbus conflict: Device '{existing_device['name']}' already uses Slave ID {final_slave_id} at {final_ip}:{final_port}"
                        )
                    elif protocol == "rtu_gateway":
                        raise HTTPException(
                            status_code=status.HTTP_409_CONFLICT,
                            detail=f"Modbus conflict: Device '{existing_device['name']}' already uses Slave ID {final_slave_id} at gateway {final_gateway_ip}:{final_gateway_port}"
                        )

        db.table("site_devices").update(update_data).eq("id", str(device_id)).execute()

        # Fetch updated device with template
        result = db.table("site_devices").select(
            "*, device_templates(*)"
        ).eq("id", str(device_id)).execute()

        return db_row_to_device_response(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update device: {str(e)}"
        )


@router.delete("/project/{project_id}/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_project_device(
    project_id: UUID,
    device_id: UUID,
    current_user: CurrentUser = Depends(require_project_access(require_edit=True)),
    db: Client = Depends(get_supabase)
):
    """
    Remove device from project (soft delete).

    User must have edit permission for this project.
    """
    try:
        # Check if device exists
        existing = db.table("site_devices").select("id").eq("id", str(device_id)).eq("project_id", str(project_id)).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device {device_id} not found"
            )

        # Soft delete - set enabled to false
        db.table("site_devices").update({"enabled": False}).eq("id", str(device_id)).execute()

        return None
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to remove device: {str(e)}"
        )


# ============================================
# DEVICE STATUS ENDPOINTS
# ============================================

@router.post("/project/{project_id}/{device_id}/status")
async def update_device_status(
    project_id: UUID,
    device_id: UUID,
    is_online: bool,
    last_error: Optional[str] = None,
    db: Client = Depends(get_supabase)
):
    """
    Update device online status.

    Called by the on-site controller to report device status.
    """
    try:
        update_data = {
            "is_online": is_online,
            "last_seen": datetime.utcnow().isoformat() if is_online else None
        }

        if last_error is not None:
            update_data["last_error"] = last_error

        db.table("site_devices").update(update_data).eq("id", str(device_id)).eq("project_id", str(project_id)).execute()

        return {
            "status": "updated",
            "device_id": str(device_id),
            "is_online": is_online
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update device status: {str(e)}"
        )


# ============================================
# SITE DEVICE ENDPOINTS (New Sites Architecture)
# ============================================

@router.get("/site/{site_id}", response_model=list[ProjectDeviceResponse])
async def list_site_devices(
    site_id: UUID,
    device_type: Optional[str] = Query(None, description="Filter by device type"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """
    List all devices configured for a site.

    Includes connection details and current status.
    Filter by device_type if needed.
    """
    try:
        query = db.table("site_devices").select(
            "*, device_templates(*)"
        ).eq("site_id", str(site_id)).eq("enabled", True)

        result = query.order("name").execute()

        devices = []
        for row in result.data:
            # Filter by device_type if specified
            if device_type:
                template = row.get("device_templates", {})
                if template.get("device_type") != device_type:
                    continue
            devices.append(db_row_to_device_response(row))

        return devices
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch devices: {str(e)}"
        )


@router.post("/site/{site_id}", response_model=ProjectDeviceResponse, status_code=status.HTTP_201_CREATED)
async def add_site_device(
    site_id: UUID,
    device: ProjectDeviceCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """
    Add a device to a site.

    Validates that connection fields match the selected protocol.
    Checks for Modbus address conflicts.
    """
    # Validate protocol-specific fields
    if device.protocol == "tcp":
        if not device.ip_address:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="ip_address is required for TCP protocol"
            )
    elif device.protocol == "rtu_gateway":
        if not device.gateway_ip:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="gateway_ip is required for RTU gateway protocol"
            )
    elif device.protocol == "rtu_direct":
        if not device.serial_port:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="serial_port is required for direct RTU protocol"
            )

    try:
        # Verify site exists and get project_id
        site = db.table("sites").select("id, project_id").eq("id", str(site_id)).execute()
        if not site.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Site {site_id} not found"
            )
        project_id = site.data[0]["project_id"]

        # ============================================
        # MODBUS CONFLICT VALIDATION
        # ============================================

        conflict_query = db.table("site_devices").select("id, name").eq(
            "site_id", str(site_id)
        ).eq("enabled", True).eq("slave_id", device.slave_id)

        if device.protocol == "tcp":
            conflict_query = conflict_query.eq("ip_address", device.ip_address).eq("port", device.port)
        elif device.protocol == "rtu_gateway":
            conflict_query = conflict_query.eq("gateway_ip", device.gateway_ip).eq("gateway_port", device.gateway_port)
        elif device.protocol == "rtu_direct":
            conflict_query = conflict_query.eq("serial_port", device.serial_port)

        conflict_result = conflict_query.execute()

        if conflict_result.data:
            existing_device = conflict_result.data[0]
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Modbus conflict: Device '{existing_device['name']}' already uses Slave ID {device.slave_id}"
            )

        # Get template ID from template_id string
        template = db.table("device_templates").select("id").eq("template_id", device.template_id).execute()
        if not template.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Template {device.template_id} not found"
            )

        insert_data = {
            "project_id": project_id,
            "site_id": str(site_id),
            "template_id": template.data[0]["id"],
            "name": device.name,
            "protocol": device.protocol,
            "ip_address": device.ip_address,
            "port": device.port,
            "gateway_ip": device.gateway_ip,
            "gateway_port": device.gateway_port,
            "slave_id": device.slave_id,
            "rated_power_kw": device.rated_power_kw,
            "rated_power_kva": device.rated_power_kva,
            "is_online": False,
            "enabled": True
        }

        result = db.table("site_devices").insert(insert_data).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to add device"
            )

        # Fetch with template info
        device_result = db.table("site_devices").select(
            "*, device_templates(*)"
        ).eq("id", result.data[0]["id"]).execute()

        return db_row_to_device_response(device_result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to add device: {str(e)}"
        )


@router.post("/site/{site_id}/{device_id}/status")
async def update_site_device_status(
    site_id: UUID,
    device_id: UUID,
    is_online: bool,
    last_error: Optional[str] = None,
    db: Client = Depends(get_supabase)
):
    """
    Update device online status (site-based).

    Called by the on-site controller to report device status.
    """
    try:
        update_data = {
            "is_online": is_online,
            "last_seen": datetime.utcnow().isoformat() if is_online else None
        }

        if last_error is not None:
            update_data["last_error"] = last_error

        db.table("site_devices").update(update_data).eq("id", str(device_id)).eq("site_id", str(site_id)).execute()

        return {
            "status": "updated",
            "device_id": str(device_id),
            "is_online": is_online
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update device status: {str(e)}"
        )


# ============================================
# TEMPLATE LINKAGE ENDPOINTS
# ============================================

@router.get("/templates/{template_id}/usage")
async def get_template_usage(
    template_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """
    Get usage statistics for a template.

    Returns count of devices and sites using this template.
    Used for showing warning when editing templates with connected devices.
    """
    try:
        # Find template by template_id string
        print(f"[USAGE] Looking up template by template_id: {template_id}")
        template_result = db.table("device_templates").select("id").eq("template_id", template_id).execute()
        if not template_result.data:
            print(f"[USAGE] Template '{template_id}' not found")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Template '{template_id}' not found"
            )

        template_uuid = template_result.data[0]["id"]
        print(f"[USAGE] Found template UUID: {template_uuid}")

        # Get all devices using this template
        devices_result = db.table("site_devices").select(
            "id, site_id"
        ).eq("template_id", template_uuid).eq("enabled", True).execute()
        print(f"[USAGE] Found {len(devices_result.data) if devices_result.data else 0} devices using this template")

        device_count = len(devices_result.data) if devices_result.data else 0

        # Get unique sites
        site_ids = list(set(d["site_id"] for d in devices_result.data if d.get("site_id"))) if devices_result.data else []
        site_count = len(site_ids)

        # Get site names
        site_names = []
        if site_ids:
            sites_result = db.table("sites").select("name").in_("id", site_ids).eq("is_active", True).execute()
            site_names = [s["name"] for s in sites_result.data] if sites_result.data else []

        return {
            "template_id": template_id,
            "device_count": device_count,
            "site_count": site_count,
            "site_names": site_names
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get template usage: {str(e)}"
        )


class UnlinkTemplateResponse(BaseModel):
    """Response for unlink template operation."""
    device_id: str
    template_registers_removed: int
    manual_registers_kept: int


@router.post("/site/{site_id}/{device_id}/unlink-template", response_model=UnlinkTemplateResponse)
async def unlink_device_template(
    site_id: UUID,
    device_id: UUID,
    current_user: CurrentUser = Depends(require_role([
        "super_admin", "backend_admin", "admin", "enterprise_admin", "configurator"
    ])),
    db: Client = Depends(get_supabase)
):
    """
    Unlink a device from its template.

    - Removes all registers with source:"template"
    - Keeps all registers with source:"manual"
    - Sets template_id to NULL

    This makes the device fully independent of the template.
    """
    try:
        # Get current device data
        device_result = db.table("site_devices").select(
            "id, template_id, registers, visualization_registers, alarm_registers"
        ).eq("id", str(device_id)).eq("site_id", str(site_id)).eq("enabled", True).execute()

        if not device_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device {device_id} not found in site {site_id}"
            )

        device = device_result.data[0]

        if not device.get("template_id"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Device is not linked to a template"
            )

        # Filter out template registers, keep manual ones
        def filter_manual_registers(registers):
            if not registers:
                return [], 0, 0
            manual = [r for r in registers if r.get("source") == "manual"]
            template_count = len([r for r in registers if r.get("source") == "template"])
            return manual, template_count, len(manual)

        logging_manual, logging_template_count, logging_manual_count = filter_manual_registers(device.get("registers"))
        viz_manual, viz_template_count, viz_manual_count = filter_manual_registers(device.get("visualization_registers"))
        alarm_manual, alarm_template_count, alarm_manual_count = filter_manual_registers(device.get("alarm_registers"))

        total_template_removed = logging_template_count + viz_template_count + alarm_template_count
        total_manual_kept = logging_manual_count + viz_manual_count + alarm_manual_count

        # Update device: remove template link and template registers
        update_data = {
            "template_id": None,
            "template_synced_at": None,
            "registers": logging_manual if logging_manual else None,
            "visualization_registers": viz_manual if viz_manual else None,
            "alarm_registers": alarm_manual if alarm_manual else None
        }

        db.table("site_devices").update(update_data).eq("id", str(device_id)).execute()

        # Update site config_changed_at to trigger sync
        db.table("sites").update({"config_changed_at": datetime.utcnow().isoformat()}).eq("id", str(site_id)).execute()

        return UnlinkTemplateResponse(
            device_id=str(device_id),
            template_registers_removed=total_template_removed,
            manual_registers_kept=total_manual_kept
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to unlink template: {str(e)}"
        )


class ChangeTemplateRequest(BaseModel):
    """Request to change device template."""
    new_template_id: str = Field(..., description="Template ID string (e.g., 'sungrow_150kw')")


class ChangeTemplateResponse(BaseModel):
    """Response for change template operation."""
    device_id: str
    old_template_id: Optional[str]
    new_template_id: str
    template_registers_replaced: int
    manual_registers_kept: int


@router.post("/site/{site_id}/{device_id}/change-template", response_model=ChangeTemplateResponse)
async def change_device_template(
    site_id: UUID,
    device_id: UUID,
    request: ChangeTemplateRequest,
    current_user: CurrentUser = Depends(require_role([
        "super_admin", "backend_admin", "admin", "enterprise_admin", "configurator"
    ])),
    db: Client = Depends(get_supabase)
):
    """
    Change the template linked to a device.

    - Removes all registers with source:"template"
    - Adds new template registers with source:"template"
    - Keeps all registers with source:"manual"
    - Updates template_id to new template

    This allows swapping to a different template while preserving manual customizations.
    """
    try:
        # Get current device data
        device_result = db.table("site_devices").select(
            "id, template_id, registers, visualization_registers, alarm_registers"
        ).eq("id", str(device_id)).eq("site_id", str(site_id)).eq("enabled", True).execute()

        if not device_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device {device_id} not found in site {site_id}"
            )

        device = device_result.data[0]

        # Get old template ID for response
        old_template_uuid = device.get("template_id")
        old_template_id = None
        if old_template_uuid:
            old_result = db.table("device_templates").select("template_id").eq("id", old_template_uuid).execute()
            if old_result.data:
                old_template_id = old_result.data[0]["template_id"]

        # Get new template data
        new_template_result = db.table("device_templates").select(
            "id, template_id, logging_registers, registers, visualization_registers, alarm_registers"
        ).eq("template_id", request.new_template_id).execute()

        if not new_template_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Template '{request.new_template_id}' not found"
            )

        new_template = new_template_result.data[0]
        new_template_uuid = new_template["id"]

        # Helper: add source:"template" to all registers and ensure logging_frequency
        def add_template_source(registers):
            if not registers:
                return []
            result = []
            for r in registers:
                reg = {**r, "source": "template"}
                # Ensure logging_frequency is always set (default: 60 seconds = 1 minute)
                if "logging_frequency" not in reg or reg.get("logging_frequency") is None:
                    reg["logging_frequency"] = 60
                result.append(reg)
            return result

        # Helper: filter manual registers from device
        def get_manual_registers(registers):
            if not registers:
                return []
            return [r for r in registers if r.get("source") == "manual"]

        # Get manual registers to keep
        manual_logging = get_manual_registers(device.get("registers"))
        manual_viz = get_manual_registers(device.get("visualization_registers"))
        manual_alarm = get_manual_registers(device.get("alarm_registers"))

        # Get new template registers with source:"template"
        new_logging = add_template_source(new_template.get("logging_registers") or new_template.get("registers") or [])
        new_viz = add_template_source(new_template.get("visualization_registers") or [])
        new_alarm = add_template_source(new_template.get("alarm_registers") or [])

        # Count for response
        template_count = len(new_logging) + len(new_viz) + len(new_alarm)
        manual_count = len(manual_logging) + len(manual_viz) + len(manual_alarm)

        # Merge: new template registers + manual registers
        merged_logging = new_logging + manual_logging
        merged_viz = new_viz + manual_viz
        merged_alarm = new_alarm + manual_alarm

        # Update device
        update_data = {
            "template_id": new_template_uuid,
            "template_synced_at": datetime.utcnow().isoformat(),
            "registers": merged_logging if merged_logging else None,
            "visualization_registers": merged_viz if merged_viz else None,
            "alarm_registers": merged_alarm if merged_alarm else None
        }

        db.table("site_devices").update(update_data).eq("id", str(device_id)).execute()

        # Update site config_changed_at to trigger sync
        db.table("sites").update({"config_changed_at": datetime.utcnow().isoformat()}).eq("id", str(site_id)).execute()

        return ChangeTemplateResponse(
            device_id=str(device_id),
            old_template_id=old_template_id,
            new_template_id=request.new_template_id,
            template_registers_replaced=template_count,
            manual_registers_kept=manual_count
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to change template: {str(e)}"
        )
