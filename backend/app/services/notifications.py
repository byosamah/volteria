"""
Notification Service

Auto-creates in-app notifications when alarms are raised.
Checks user preferences before creating notifications.
"""

from uuid import uuid4
from supabase import Client


# Map alarm severity to notification type
SEVERITY_TO_TYPE = {
    "critical": "critical",
    "warning": "warning",
    "info": "info"
}


def create_alarm_notifications(
    supabase: Client,
    alarm_data: dict,
    project_id: str
):
    """
    Create in-app notifications for users who should be notified about this alarm.

    This is called as a background task after alarm creation.

    Steps:
    1. Get all users with access to this project (from user_projects)
    2. Get admin users who have access to all projects
    3. For each user, check notification_preferences
    4. Create notification if user wants in-app notifications for this severity

    Args:
        supabase: Supabase client instance
        alarm_data: The alarm that was just created (dict with id, severity, message, etc.)
        project_id: The project ID this alarm belongs to
    """
    try:
        alarm_severity = alarm_data.get("severity", "warning")
        alarm_id = alarm_data.get("id")
        alarm_message = alarm_data.get("message", "")
        alarm_type = alarm_data.get("alarm_type", "")

        # Step 1: Get users assigned to this project
        user_projects_result = supabase.table("user_projects").select(
            "user_id"
        ).eq("project_id", project_id).execute()

        assigned_user_ids = [
            row["user_id"] for row in (user_projects_result.data or [])
        ]

        # Step 2: Get admin users (super_admin, backend_admin, admin have access to all projects)
        admin_roles = ["super_admin", "backend_admin", "admin"]
        admin_result = supabase.table("users").select(
            "id"
        ).in_("role", admin_roles).execute()

        admin_user_ids = [
            row["id"] for row in (admin_result.data or [])
        ]

        # Combine and deduplicate user IDs
        all_user_ids = list(set(assigned_user_ids + admin_user_ids))

        if not all_user_ids:
            # No users to notify
            return

        # Step 3: Get notification preferences for these users
        # Use get_or_create pattern - if no preferences, defaults apply
        prefs_result = supabase.table("notification_preferences").select(
            "user_id, in_app_enabled, in_app_critical, in_app_warning, in_app_info"
        ).in_("user_id", all_user_ids).execute()

        # Build a map of user_id -> preferences
        prefs_map = {}
        for pref in (prefs_result.data or []):
            prefs_map[pref["user_id"]] = pref

        # Step 4: Create notifications for users who want them
        notifications_to_create = []

        for user_id in all_user_ids:
            # Get user's preferences (or use defaults)
            prefs = prefs_map.get(user_id, {})

            # Check if in-app notifications are enabled (default: true)
            in_app_enabled = prefs.get("in_app_enabled", True)
            if not in_app_enabled:
                continue

            # Check if this severity is enabled for in-app (defaults: all true)
            severity_field = f"in_app_{alarm_severity}"
            severity_enabled = prefs.get(severity_field, True)
            if not severity_enabled:
                continue

            # User wants this notification - create it
            notification = {
                "id": str(uuid4()),
                "user_id": user_id,
                "title": f"New {alarm_severity.capitalize()} Alarm",
                "message": alarm_message,
                "type": SEVERITY_TO_TYPE.get(alarm_severity, "info"),
                "resource_type": "alarm",
                "resource_id": alarm_id,
                "action_url": f"/projects/{project_id}",
                "read": False
            }
            notifications_to_create.append(notification)

        # Step 5: Bulk insert all notifications
        if notifications_to_create:
            supabase.table("notifications").insert(notifications_to_create).execute()

    except Exception as e:
        # Log error but don't raise - this is a background task
        # We don't want notification failure to affect alarm creation
        print(f"[Notification Service] Error creating notifications: {e}")
