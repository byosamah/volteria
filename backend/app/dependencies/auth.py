"""
Authentication Dependencies

Provides FastAPI dependencies for:
- JWT token validation
- Role-based access control
- Project-level permissions

Usage:
    from app.dependencies.auth import get_current_user, require_role

    @router.get("/")
    async def protected_route(user = Depends(get_current_user)):
        # User is authenticated
        pass

    @router.delete("/{id}")
    async def admin_only(user = Depends(require_role(["admin", "super_admin"]))):
        # Only admin or super_admin can access
        pass
"""

from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from app.services.supabase import get_supabase

# Security scheme for JWT tokens
# This tells FastAPI to look for "Authorization: Bearer <token>" header
security = HTTPBearer(auto_error=False)


# ============================================
# USER MODEL
# ============================================

class CurrentUser(BaseModel):
    """
    Represents the authenticated user.

    This is attached to the request and available in all protected routes.
    """
    id: str
    email: str
    role: str  # super_admin, admin, configurator, viewer
    full_name: Optional[str] = None
    is_active: bool = True


# ============================================
# ROLE HIERARCHY
# ============================================

# Define which roles have which permissions
# Higher roles inherit permissions from lower roles
ROLE_HIERARCHY = {
    "viewer": 1,
    "configurator": 2,
    "admin": 3,
    "super_admin": 4
}


# ============================================
# CORE AUTH DEPENDENCY
# ============================================

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    supabase = Depends(get_supabase)
) -> CurrentUser:
    """
    Validate JWT token and return the current user.

    This is the main authentication dependency.
    Use this to protect any route that requires authentication.

    How it works:
    1. Extract JWT token from Authorization header
    2. Verify token with Supabase Auth
    3. Get user data from the users table
    4. Return CurrentUser object

    Raises:
        HTTPException 401: If no token or invalid token
        HTTPException 403: If user is not active
    """
    # Check if token is provided
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Please provide a valid access token.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    token = credentials.credentials

    try:
        # Verify the token with Supabase Auth
        # This also refreshes the session if needed
        auth_response = supabase.auth.get_user(token)

        if not auth_response or not auth_response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
                headers={"WWW-Authenticate": "Bearer"}
            )

        # Get the Supabase Auth user ID
        auth_user_id = auth_response.user.id

        # Get additional user data from our users table
        # This includes role, full_name, is_active, etc.
        user_result = supabase.table("users").select(
            "id, email, role, full_name, is_active"
        ).eq("id", str(auth_user_id)).execute()

        if not user_result.data:
            # User exists in Supabase Auth but not in our users table
            # This might happen if the user was created directly in Supabase Auth
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User profile not found. Please contact administrator."
            )

        user_data = user_result.data[0]

        # Check if user is active
        if not user_data.get("is_active", True):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your account has been deactivated. Please contact administrator."
            )

        # Return the current user
        return CurrentUser(
            id=user_data["id"],
            email=user_data["email"],
            role=user_data["role"],
            full_name=user_data.get("full_name"),
            is_active=user_data.get("is_active", True)
        )

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        # Log the error for debugging
        print(f"Auth error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"}
        )


# ============================================
# OPTIONAL AUTH DEPENDENCY
# ============================================

async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    supabase = Depends(get_supabase)
) -> Optional[CurrentUser]:
    """
    Get current user if authenticated, None otherwise.

    Use this for routes that work for both authenticated and anonymous users,
    but might show different content based on auth status.
    """
    if credentials is None:
        return None

    try:
        return await get_current_user(credentials, supabase)
    except HTTPException:
        return None


# ============================================
# ROLE-BASED ACCESS CONTROL
# ============================================

def require_role(allowed_roles: list[str]):
    """
    Factory function that creates a dependency requiring specific roles.

    Usage:
        @router.post("/")
        async def create_project(
            user = Depends(require_role(["admin", "super_admin"]))
        ):
            # Only admin or super_admin can access
            pass

    Args:
        allowed_roles: List of role names that can access the route

    Returns:
        Dependency function that validates the user's role
    """
    async def role_checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {', '.join(allowed_roles)}. Your role: {user.role}"
            )
        return user

    return role_checker


def require_min_role(min_role: str):
    """
    Factory function that creates a dependency requiring a minimum role level.

    Uses the role hierarchy to check if user has at least the minimum role.

    Usage:
        @router.put("/{id}")
        async def update_project(
            user = Depends(require_min_role("configurator"))
        ):
            # Configurator, admin, and super_admin can access
            pass

    Args:
        min_role: Minimum role required (viewer < configurator < admin < super_admin)

    Returns:
        Dependency function that validates the user's role level
    """
    min_level = ROLE_HIERARCHY.get(min_role, 0)

    async def role_checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        user_level = ROLE_HIERARCHY.get(user.role, 0)

        if user_level < min_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Minimum required role: {min_role}. Your role: {user.role}"
            )
        return user

    return role_checker


# ============================================
# PROJECT ACCESS CONTROL
# ============================================

async def check_project_access(
    project_id: UUID,
    user: CurrentUser,
    supabase,
    require_edit: bool = False,
    require_control: bool = False
) -> bool:
    """
    Check if user has access to a specific project.

    Rules:
    - super_admin and admin: Full access to all projects
    - configurator/viewer: Only assigned projects

    Args:
        project_id: The project to check access for
        user: The current authenticated user
        supabase: Supabase client
        require_edit: If True, check if user can edit the project
        require_control: If True, check if user can control the project

    Returns:
        True if user has access, False otherwise
    """
    # Super admin and admin have access to all projects
    if user.role in ["super_admin", "admin"]:
        return True

    # For other roles, check user_projects assignment
    query = supabase.table("user_projects").select(
        "can_edit, can_control"
    ).eq(
        "user_id", user.id
    ).eq(
        "project_id", str(project_id)
    )

    result = query.execute()

    if not result.data:
        # User is not assigned to this project
        return False

    assignment = result.data[0]

    # Check specific permissions if required
    if require_edit and not assignment.get("can_edit", False):
        return False

    if require_control and not assignment.get("can_control", False):
        return False

    return True


def require_project_access(require_edit: bool = False, require_control: bool = False):
    """
    Factory function for project-level access control.

    Usage:
        @router.get("/{project_id}")
        async def get_project(
            project_id: UUID,
            user = Depends(require_project_access())
        ):
            # User has at least view access to this project
            pass

        @router.put("/{project_id}")
        async def update_project(
            project_id: UUID,
            user = Depends(require_project_access(require_edit=True))
        ):
            # User has edit access to this project
            pass

    Args:
        require_edit: If True, user must have edit permission
        require_control: If True, user must have control permission

    Returns:
        Dependency function that validates project access
    """
    async def access_checker(
        project_id: UUID,
        user: CurrentUser = Depends(get_current_user),
        supabase = Depends(get_supabase)
    ) -> CurrentUser:
        has_access = await check_project_access(
            project_id, user, supabase, require_edit, require_control
        )

        if not has_access:
            if require_control:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You don't have control access to this project"
                )
            elif require_edit:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You don't have edit access to this project"
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You don't have access to this project"
                )

        return user

    return access_checker
