"""
Authentication Router

Handles user authentication and authorization.
Uses Supabase Auth for user management.

Roles:
- super_admin: Full access, can create any user
- admin: Can create users (except admin/super), manage all projects
- configurator: Can edit assigned projects, remote control
- viewer: Can view logs, download data
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from app.services.supabase import get_supabase
from app.dependencies.auth import (
    CurrentUser,
    get_current_user,
    require_role,
    ROLE_HIERARCHY
)

router = APIRouter()


# ============================================
# SCHEMAS
# ============================================

class LoginRequest(BaseModel):
    """Login request body."""
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    """Login response with token."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict


class LogoutResponse(BaseModel):
    """Logout response."""
    message: str


class UserCreate(BaseModel):
    """Create user request."""
    email: EmailStr
    password: str
    role: str
    full_name: Optional[str] = None
    enterprise_id: Optional[str] = None  # Which enterprise this user belongs to


class UserResponse(BaseModel):
    """User response (no password)."""
    id: str
    email: str
    role: str
    full_name: Optional[str]
    is_active: bool
    enterprise_id: Optional[str] = None
    avatar_url: Optional[str] = None
    created_at: Optional[str] = None


class UserUpdate(BaseModel):
    """Update user request."""
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    enterprise_id: Optional[str] = None  # Super admin can change enterprise


class ProjectAssignment(BaseModel):
    """Assign user to project request."""
    project_id: str
    can_edit: bool = False
    can_control: bool = False


# ============================================
# ENDPOINTS
# ============================================

@router.post("/login", response_model=LoginResponse)
async def login(
    request: LoginRequest,
    supabase = Depends(get_supabase)
):
    """
    Authenticate user and return access token.

    Uses Supabase Auth for authentication.
    Returns JWT tokens that can be used for subsequent API calls.

    How it works:
    1. Validate email/password with Supabase Auth
    2. Get user profile from our users table
    3. Return tokens and user info
    """
    try:
        # Authenticate with Supabase Auth
        # This validates the email/password and creates a session
        auth_response = supabase.auth.sign_in_with_password({
            "email": request.email,
            "password": request.password
        })

        if not auth_response.session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password"
            )

        # Get user data from our users table (includes role)
        user_result = supabase.table("users").select(
            "id, email, role, full_name, is_active"
        ).eq("id", str(auth_response.user.id)).execute()

        if not user_result.data:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User profile not found. Please contact administrator."
            )

        user_data = user_result.data[0]

        # Check if user is active
        if not user_data.get("is_active", True):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your account has been deactivated."
            )

        # Return tokens and user info
        return LoginResponse(
            access_token=auth_response.session.access_token,
            refresh_token=auth_response.session.refresh_token,
            token_type="bearer",
            user={
                "id": user_data["id"],
                "email": user_data["email"],
                "role": user_data["role"],
                "full_name": user_data.get("full_name")
            }
        )

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        print(f"Login error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    current_user: CurrentUser = Depends(get_current_user),
    supabase = Depends(get_supabase)
):
    """
    Logout current user.

    Signs out the current session with Supabase Auth.
    The client should discard its stored tokens after this call.
    """
    try:
        # Sign out from Supabase Auth
        # This invalidates the current session on the server
        supabase.auth.sign_out()
        return LogoutResponse(message="Logged out successfully")
    except Exception as e:
        print(f"Logout error: {e}")
        # Still return success - the client should discard tokens
        return LogoutResponse(message="Logged out successfully")


@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Get current authenticated user.

    Returns the user info from the validated JWT token.
    Use this to get the current user's role and profile.
    """
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        role=current_user.role,
        full_name=current_user.full_name,
        is_active=current_user.is_active
    )


@router.post("/users", response_model=UserResponse)
async def create_user(
    user: UserCreate,
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin", "admin", "enterprise_admin"])),
    supabase = Depends(get_supabase)
):
    """
    Create a new user.

    Role restrictions:
    - super_admin/backend_admin: Can create any user (including admin, super_admin)
    - admin: Can only create configurator and viewer users
    - enterprise_admin: Can only create configurator/viewer in their own enterprise

    How it works:
    1. Check if creator has permission to create the requested role
    2. Create user in Supabase Auth
    3. Create user profile in our users table
    """
    # Validate the requested role
    if user.role not in ROLE_HIERARCHY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role: {user.role}. Valid roles: {', '.join(ROLE_HIERARCHY.keys())}"
        )

    # Enterprise admin restrictions
    if current_user.role == "enterprise_admin":
        # Can only create configurator and viewer
        if user.role not in ["configurator", "viewer"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Enterprise admins can only create configurator and viewer users"
            )
        # Must create in their own enterprise
        if user.enterprise_id and user.enterprise_id != current_user.enterprise_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot create users in other enterprises"
            )
        # Force the user to be in the enterprise admin's enterprise
        user.enterprise_id = current_user.enterprise_id

    # Admin can only create configurator and viewer
    if current_user.role == "admin" and user.role in ["admin", "super_admin", "backend_admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin users cannot create admin or super_admin accounts"
        )

    try:
        # Create user in Supabase Auth
        # This handles password hashing and email validation
        auth_response = supabase.auth.admin.create_user({
            "email": user.email,
            "password": user.password,
            "email_confirm": True  # Auto-confirm email
        })

        if not auth_response.user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to create user in authentication system"
            )

        new_user_id = str(auth_response.user.id)

        # Create user profile in our users table
        user_data = {
            "id": new_user_id,
            "email": user.email,
            "role": user.role,
            "full_name": user.full_name,
            "enterprise_id": user.enterprise_id,  # Include enterprise assignment
            "is_active": True,
            "created_by": current_user.id
        }

        result = supabase.table("users").insert(user_data).execute()

        if not result.data:
            # Rollback: delete the auth user if profile creation fails
            try:
                supabase.auth.admin.delete_user(new_user_id)
            except:
                pass
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create user profile"
            )

        created_user = result.data[0]

        return UserResponse(
            id=created_user["id"],
            email=created_user["email"],
            role=created_user["role"],
            full_name=created_user.get("full_name"),
            is_active=created_user.get("is_active", True),
            enterprise_id=created_user.get("enterprise_id"),
            avatar_url=created_user.get("avatar_url"),
            created_at=created_user.get("created_at")
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"Create user error: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create user: {str(e)}"
        )


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    enterprise_id: Optional[str] = None,  # Filter by enterprise (super admin only)
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin", "admin", "enterprise_admin"])),
    supabase = Depends(get_supabase)
):
    """
    List users.

    Access:
    - super_admin/backend_admin: Can see all users, optionally filter by enterprise
    - admin: Can see all users
    - enterprise_admin: Can only see users in their enterprise

    Returns all users with their roles, status, and enterprise info.
    """
    try:
        # Build query with more fields
        query = supabase.table("users").select(
            "id, email, role, full_name, is_active, enterprise_id, avatar_url, created_at"
        )

        # Enterprise admin can only see their own enterprise users
        if current_user.role == "enterprise_admin":
            if not current_user.enterprise_id:
                # Enterprise admin without enterprise - return empty list
                return []
            query = query.eq("enterprise_id", current_user.enterprise_id)
        elif enterprise_id:
            # Super admin can filter by enterprise
            query = query.eq("enterprise_id", enterprise_id)

        result = query.order("created_at", desc=True).execute()

        return [
            UserResponse(
                id=user["id"],
                email=user["email"],
                role=user["role"],
                full_name=user.get("full_name"),
                is_active=user.get("is_active", True),
                enterprise_id=user.get("enterprise_id"),
                avatar_url=user.get("avatar_url"),
                created_at=user.get("created_at")
            )
            for user in result.data
        ]

    except Exception as e:
        print(f"List users error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve users"
        )


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: str,
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin", "admin", "enterprise_admin"])),
    supabase = Depends(get_supabase)
):
    """
    Get a specific user by ID.

    Access:
    - super_admin/backend_admin/admin: Can see any user
    - enterprise_admin: Can only see users in their enterprise
    """
    try:
        result = supabase.table("users").select(
            "id, email, role, full_name, is_active, enterprise_id, avatar_url, created_at"
        ).eq("id", user_id).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        user = result.data[0]

        # Enterprise admin can only see users in their enterprise
        if current_user.role == "enterprise_admin":
            if user.get("enterprise_id") != current_user.enterprise_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot access users outside your enterprise"
                )

        return UserResponse(
            id=user["id"],
            email=user["email"],
            role=user["role"],
            full_name=user.get("full_name"),
            is_active=user.get("is_active", True),
            enterprise_id=user.get("enterprise_id"),
            avatar_url=user.get("avatar_url"),
            created_at=user.get("created_at")
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"Get user error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve user"
        )


@router.patch("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    user_update: UserUpdate,
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin", "admin", "enterprise_admin"])),
    supabase = Depends(get_supabase)
):
    """
    Update a user's profile.

    Access:
    - super_admin/backend_admin: Can update any user, including enterprise assignment
    - admin: Can update users, cannot promote to admin/super_admin
    - enterprise_admin: Can only update users in their enterprise, cannot change enterprise
    """
    # First, get the target user to check permissions
    try:
        target_user_result = supabase.table("users").select(
            "id, enterprise_id, role"
        ).eq("id", user_id).execute()

        if not target_user_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        target_user = target_user_result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve user"
        )

    # Enterprise admin restrictions
    if current_user.role == "enterprise_admin":
        # Can only edit users in their enterprise
        if target_user.get("enterprise_id") != current_user.enterprise_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot edit users outside your enterprise"
            )
        # Cannot change enterprise_id
        if user_update.enterprise_id is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Enterprise admins cannot change user enterprise assignment"
            )
        # Cannot change role to anything higher than configurator
        if user_update.role is not None and user_update.role not in ["configurator", "viewer"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Enterprise admins can only assign configurator or viewer roles"
            )

    # Build update data - only include fields that were provided
    update_data = {}

    if user_update.full_name is not None:
        update_data["full_name"] = user_update.full_name

    if user_update.is_active is not None:
        update_data["is_active"] = user_update.is_active

    if user_update.role is not None:
        # Validate the role
        if user_update.role not in ROLE_HIERARCHY:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid role: {user_update.role}"
            )
        # Admin cannot promote to admin/super_admin/backend_admin
        if current_user.role == "admin" and user_update.role in ["admin", "super_admin", "backend_admin"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin users cannot promote users to admin or super_admin"
            )
        update_data["role"] = user_update.role

    if user_update.enterprise_id is not None:
        # Only super_admin and backend_admin can change enterprise
        if current_user.role not in ["super_admin", "backend_admin"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only super admins can change user enterprise assignment"
            )
        update_data["enterprise_id"] = user_update.enterprise_id

    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update"
        )

    try:
        result = supabase.table("users").update(
            update_data
        ).eq("id", user_id).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        user = result.data[0]
        return UserResponse(
            id=user["id"],
            email=user["email"],
            role=user["role"],
            full_name=user.get("full_name"),
            is_active=user.get("is_active", True),
            enterprise_id=user.get("enterprise_id"),
            avatar_url=user.get("avatar_url"),
            created_at=user.get("created_at")
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"Update user error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update user"
        )


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    current_user: CurrentUser = Depends(require_role(["super_admin"])),
    supabase = Depends(get_supabase)
):
    """
    Delete a user.

    Only super_admin can delete users.
    This deletes both the auth account and user profile.

    Note: Consider using deactivation (is_active=False) instead
    to preserve audit trails and data integrity.
    """
    # Prevent self-deletion
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account"
        )

    try:
        # First check if user exists
        check = supabase.table("users").select("id").eq("id", user_id).execute()
        if not check.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        # Delete from our users table first
        supabase.table("users").delete().eq("id", user_id).execute()

        # Then delete from Supabase Auth
        try:
            supabase.auth.admin.delete_user(user_id)
        except Exception as e:
            print(f"Warning: Failed to delete auth user: {e}")
            # Continue - the profile is deleted, auth cleanup can be manual

        return {"message": "User deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Delete user error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete user"
        )


# ============================================
# USER-PROJECT ASSIGNMENT ENDPOINTS
# ============================================

@router.get("/users/{user_id}/projects")
async def get_user_projects(
    user_id: str,
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin", "admin", "enterprise_admin"])),
    supabase = Depends(get_supabase)
):
    """
    Get projects assigned to a user.

    Returns list of project assignments with permissions (can_edit, can_control).
    Enterprise admin can only see assignments for users in their enterprise.
    """
    try:
        # First verify user exists and check enterprise access
        user_result = supabase.table("users").select(
            "id, enterprise_id"
        ).eq("id", user_id).execute()

        if not user_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        target_user = user_result.data[0]

        # Enterprise admin can only see users in their enterprise
        if current_user.role == "enterprise_admin":
            if target_user.get("enterprise_id") != current_user.enterprise_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot access users outside your enterprise"
                )

        # Get user's project assignments with project details
        result = supabase.table("user_projects").select(
            "project_id, can_edit, can_control, assigned_at, projects:project_id (id, name, enterprise_id)"
        ).eq("user_id", user_id).execute()

        # Format response
        assignments = []
        for row in result.data:
            project = row.get("projects") or {}
            if isinstance(project, list):
                project = project[0] if project else {}

            assignments.append({
                "project_id": row["project_id"],
                "project_name": project.get("name"),
                "enterprise_id": project.get("enterprise_id"),
                "can_edit": row.get("can_edit", False),
                "can_control": row.get("can_control", False),
                "assigned_at": row.get("assigned_at")
            })

        return {"assignments": assignments}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Get user projects error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve user projects"
        )


@router.post("/users/{user_id}/projects")
async def assign_user_to_project(
    user_id: str,
    assignment: ProjectAssignment,
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin", "admin", "enterprise_admin"])),
    supabase = Depends(get_supabase)
):
    """
    Assign a user to a project with specific permissions.

    Enterprise admin can only assign:
    - Users in their enterprise
    - To projects in their enterprise
    """
    try:
        # Verify user exists and check enterprise access
        user_result = supabase.table("users").select(
            "id, enterprise_id"
        ).eq("id", user_id).execute()

        if not user_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        target_user = user_result.data[0]

        # Verify project exists
        project_result = supabase.table("projects").select(
            "id, enterprise_id"
        ).eq("id", assignment.project_id).execute()

        if not project_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found"
            )

        project = project_result.data[0]

        # Enterprise admin restrictions
        if current_user.role == "enterprise_admin":
            # User must be in their enterprise
            if target_user.get("enterprise_id") != current_user.enterprise_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot assign users outside your enterprise"
                )
            # Project must be in their enterprise
            if project.get("enterprise_id") != current_user.enterprise_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot assign to projects outside your enterprise"
                )

        # Check if assignment already exists
        existing = supabase.table("user_projects").select("user_id").eq(
            "user_id", user_id
        ).eq("project_id", assignment.project_id).execute()

        if existing.data:
            # Update existing assignment
            result = supabase.table("user_projects").update({
                "can_edit": assignment.can_edit,
                "can_control": assignment.can_control
            }).eq("user_id", user_id).eq("project_id", assignment.project_id).execute()
        else:
            # Create new assignment
            result = supabase.table("user_projects").insert({
                "user_id": user_id,
                "project_id": assignment.project_id,
                "can_edit": assignment.can_edit,
                "can_control": assignment.can_control,
                "assigned_by": current_user.id
            }).execute()

        return {"message": "User assigned to project successfully"}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Assign user to project error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to assign user to project"
        )


@router.delete("/users/{user_id}/projects/{project_id}")
async def remove_user_from_project(
    user_id: str,
    project_id: str,
    current_user: CurrentUser = Depends(require_role(["super_admin", "backend_admin", "admin", "enterprise_admin"])),
    supabase = Depends(get_supabase)
):
    """
    Remove a user from a project.

    Enterprise admin can only remove:
    - Users in their enterprise
    - From projects in their enterprise
    """
    try:
        # Verify user exists and check enterprise access
        user_result = supabase.table("users").select(
            "id, enterprise_id"
        ).eq("id", user_id).execute()

        if not user_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        target_user = user_result.data[0]

        # Enterprise admin restrictions
        if current_user.role == "enterprise_admin":
            if target_user.get("enterprise_id") != current_user.enterprise_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot manage users outside your enterprise"
                )

        # Delete the assignment
        result = supabase.table("user_projects").delete().eq(
            "user_id", user_id
        ).eq("project_id", project_id).execute()

        return {"message": "User removed from project successfully"}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Remove user from project error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to remove user from project"
        )
