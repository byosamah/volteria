"""
Audit Logging Middleware

Logs all modifying requests (POST, PATCH, PUT, DELETE) to the audit_logs table.
Captures user info, action, resource type/ID, and status.
"""

import re
import json
from uuid import uuid4
from typing import Optional, Tuple

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from ..services.supabase import supabase_service


# Paths to exclude from audit logging
EXCLUDED_PATHS = [
    "/",
    "/health",
    "/docs",
    "/redoc",
    "/openapi.json",
]

# Path prefixes to exclude
EXCLUDED_PREFIXES = [
    "/api/auth",  # Auth operations - separate logging if needed
]

# HTTP methods to log (only modifying operations)
LOGGED_METHODS = ["POST", "PATCH", "PUT", "DELETE"]


def parse_resource_from_path(path: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Parse resource type and ID from URL path.

    Examples:
    - /api/projects/abc-123 → ("project", "abc-123")
    - /api/alarms/abc-123 → ("alarm", "abc-123")
    - /api/devices/abc-123/registers → ("device", "abc-123")
    - /api/projects → ("project", None)

    Returns:
        Tuple of (resource_type, resource_id) - ID may be None
    """
    if not path.startswith("/api/"):
        return (None, None)

    # Remove /api/ prefix and split
    parts = path[5:].split("/")
    if not parts:
        return (None, None)

    # First part is the resource type (plural → singular)
    resource_type = parts[0].rstrip("s")  # "projects" → "project"

    # Second part might be the resource ID (if it looks like a UUID)
    resource_id = None
    if len(parts) > 1:
        potential_id = parts[1]
        # Check if it looks like a UUID (36 chars with dashes)
        if len(potential_id) == 36 and potential_id.count("-") == 4:
            resource_id = potential_id

    return (resource_type, resource_id)


def method_to_action(method: str) -> str:
    """Convert HTTP method to action name."""
    mapping = {
        "POST": "create",
        "PATCH": "update",
        "PUT": "update",
        "DELETE": "delete",
    }
    return mapping.get(method, method.lower())


def extract_user_id_from_token(auth_header: Optional[str]) -> Optional[str]:
    """
    Extract user ID from JWT token in Authorization header.

    The token payload contains the user's Supabase auth ID in the 'sub' field.
    We decode without verification since the actual auth is handled by routes.

    Returns:
        User ID string or None if no valid token
    """
    if not auth_header or not auth_header.startswith("Bearer "):
        return None

    token = auth_header[7:]  # Remove "Bearer " prefix

    try:
        # JWT has 3 parts: header.payload.signature
        parts = token.split(".")
        if len(parts) != 3:
            return None

        # Decode payload (middle part) - add padding if needed
        payload_b64 = parts[1]
        padding = 4 - (len(payload_b64) % 4)
        if padding != 4:
            payload_b64 += "=" * padding

        import base64
        payload_bytes = base64.urlsafe_b64decode(payload_b64)
        payload = json.loads(payload_bytes.decode("utf-8"))

        # 'sub' contains the user ID
        return payload.get("sub")

    except Exception:
        return None


def extract_user_email_from_token(auth_header: Optional[str]) -> Optional[str]:
    """Extract user email from JWT token."""
    if not auth_header or not auth_header.startswith("Bearer "):
        return None

    token = auth_header[7:]

    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None

        payload_b64 = parts[1]
        padding = 4 - (len(payload_b64) % 4)
        if padding != 4:
            payload_b64 += "=" * padding

        import base64
        payload_bytes = base64.urlsafe_b64decode(payload_b64)
        payload = json.loads(payload_bytes.decode("utf-8"))

        return payload.get("email")

    except Exception:
        return None


class AuditLoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware that logs modifying HTTP requests to audit_logs table.

    Only logs POST, PATCH, PUT, DELETE requests.
    Excludes health checks and auth endpoints.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        """Process request and log if it's a modifying operation."""

        # Skip non-modifying methods
        if request.method not in LOGGED_METHODS:
            return await call_next(request)

        # Skip excluded paths
        path = request.url.path
        if path in EXCLUDED_PATHS:
            return await call_next(request)

        # Skip excluded prefixes
        for prefix in EXCLUDED_PREFIXES:
            if path.startswith(prefix):
                return await call_next(request)

        # Execute the request first
        response = await call_next(request)

        # Now log the action (after we know the status code)
        try:
            await self._log_action(request, response)
        except Exception as e:
            # Don't fail the request if logging fails
            print(f"[Audit Middleware] Error logging action: {e}")

        return response

    async def _log_action(self, request: Request, response: Response):
        """Log the action to audit_logs table."""

        path = request.url.path
        method = request.method

        # Parse resource info from path
        resource_type, resource_id = parse_resource_from_path(path)
        if not resource_type:
            return  # Not an API endpoint we care about

        # Get action name
        action = method_to_action(method)

        # Determine action category from resource type
        category_map = {
            "project": "project",
            "site": "site",
            "device": "device",
            "alarm": "alarm",
            "controller": "controller",
            "enterprise": "enterprise",
            "user": "user",
            "hardware": "hardware",
        }
        action_category = category_map.get(resource_type, "system")

        # Extract user info from token
        auth_header = request.headers.get("authorization")
        user_id = extract_user_id_from_token(auth_header)
        user_email = extract_user_email_from_token(auth_header)

        # Get IP address
        ip_address = request.client.host if request.client else None

        # Get user agent
        user_agent = request.headers.get("user-agent", "")

        # Determine status
        status = "success" if 200 <= response.status_code < 400 else "failed"

        # Build audit log entry
        audit_entry = {
            "id": str(uuid4()),
            "user_id": user_id,
            "user_email": user_email,
            "action": action,
            "action_category": action_category,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "resource_name": None,  # Could be extracted from request body
            "status": status,
            "ip_address": ip_address,
            "user_agent": user_agent[:500] if user_agent else None,  # Truncate if too long
            "details": {
                "method": method,
                "path": path,
                "status_code": response.status_code,
            }
        }

        # Insert into audit_logs table
        supabase = supabase_service.client
        supabase.table("audit_logs").insert(audit_entry).execute()
