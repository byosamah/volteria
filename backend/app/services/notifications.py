"""
Notification Service

Auto-creates in-app notifications when alarms are raised or resolved.
Supports per-project notification settings with severity thresholds.
"""

from uuid import uuid4
from supabase import Client


# Map alarm severity to notification type
SEVERITY_TO_TYPE = {
    "critical": "critical",
    "major": "warning",  # Display major as warning color
    "warning": "warning",
    "info": "info"
}

# Severity hierarchy (higher number = more severe)
# Used for "X and above" threshold logic
SEVERITY_HIERARCHY = {
    "info": 1,
    "warning": 2,
    "major": 3,
    "critical": 4
}


def should_notify_for_severity(alarm_severity: str, min_severity: str) -> bool:
    """
    Check if alarm severity meets the minimum threshold.

    Example: min_severity="major" means notify for major + critical only.

    Args:
        alarm_severity: The severity of the alarm
        min_severity: User's minimum severity threshold

    Returns:
        True if alarm severity >= min_severity threshold
    """
    alarm_level = SEVERITY_HIERARCHY.get(alarm_severity, 0)
    min_level = SEVERITY_HIERARCHY.get(min_severity, 0)
    return alarm_level >= min_level


def create_alarm_notifications(
    supabase: Client,
    alarm_data: dict,
    project_id: str,
    is_resolved: bool = False
):
    """
    Create in-app notifications for users who should be notified about this alarm.

    This is called as a background task after alarm creation or resolution.

    Steps:
    1. Get all users with access to this project (from user_projects)
    2. Get admin users who have access to all projects
    3. For each user, check per-project notification settings first
    4. Fall back to global notification_preferences if no per-project settings
    5. Create notification if user meets criteria

    Args:
        supabase: Supabase client instance
        alarm_data: The alarm that was just created/resolved (dict with id, severity, message, etc.)
        project_id: The project ID this alarm belongs to
        is_resolved: Whether this notification is for alarm resolution (default: False)
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

        # Step 3: Get per-project notification settings for these users
        project_prefs_result = supabase.table("user_project_notifications").select(
            "user_id, email_enabled, email_min_severity, email_on_active, email_on_resolved, "
            "sms_enabled, sms_min_severity, sms_on_active, sms_on_resolved"
        ).eq("project_id", project_id).in_("user_id", all_user_ids).execute()

        # Build map of user_id -> per-project preferences
        project_prefs_map = {}
        for pref in (project_prefs_result.data or []):
            project_prefs_map[pref["user_id"]] = pref

        # Step 4: Get global notification preferences as fallback
        global_prefs_result = supabase.table("notification_preferences").select(
            "user_id, in_app_enabled, in_app_critical, in_app_warning, in_app_info, email_enabled, email_critical, email_warning, email_info"
        ).in_("user_id", all_user_ids).execute()

        # Build map of user_id -> global preferences
        global_prefs_map = {}
        for pref in (global_prefs_result.data or []):
            global_prefs_map[pref["user_id"]] = pref

        # Step 5: Create notifications for users who want them
        notifications_to_create = []
        notification_title = f"{'Resolved' if is_resolved else 'New'} {alarm_severity.capitalize()} Alarm"

        for user_id in all_user_ids:
            # Check per-project settings first
            project_prefs = project_prefs_map.get(user_id)

            if project_prefs:
                # Use per-project settings
                # Check trigger condition (active or resolved)
                if is_resolved:
                    # For email - check email_on_resolved
                    should_email = (
                        project_prefs.get("email_enabled", True) and
                        project_prefs.get("email_on_resolved", False) and
                        should_notify_for_severity(alarm_severity, project_prefs.get("email_min_severity", "major"))
                    )
                else:
                    # For email - check email_on_active
                    should_email = (
                        project_prefs.get("email_enabled", True) and
                        project_prefs.get("email_on_active", True) and
                        should_notify_for_severity(alarm_severity, project_prefs.get("email_min_severity", "major"))
                    )

                # For now, in-app notifications follow email settings (could separate later)
                should_notify_in_app = should_email

            else:
                # Fall back to global settings
                global_prefs = global_prefs_map.get(user_id, {})

                # Check if in-app notifications are enabled (default: true)
                in_app_enabled = global_prefs.get("in_app_enabled", True)
                if not in_app_enabled:
                    continue

                # Check if this severity is enabled for in-app (defaults: all true except info)
                # Map to global settings fields
                severity_field_map = {
                    "critical": "in_app_critical",
                    "major": "in_app_warning",  # Major falls back to warning setting
                    "warning": "in_app_warning",
                    "info": "in_app_info"
                }
                severity_field = severity_field_map.get(alarm_severity, "in_app_info")

                # Default values: critical=True, warning=False, info=False
                default_values = {
                    "in_app_critical": True,
                    "in_app_warning": False,
                    "in_app_info": False
                }
                severity_enabled = global_prefs.get(severity_field, default_values.get(severity_field, False))

                # Only notify on active alarms when using global settings
                # (global settings don't have resolved trigger option)
                if is_resolved:
                    continue

                should_notify_in_app = severity_enabled

            if not should_notify_in_app:
                continue

            # User wants this notification - create it
            notification = {
                "id": str(uuid4()),
                "user_id": user_id,
                "title": notification_title,
                "message": alarm_message,
                "type": SEVERITY_TO_TYPE.get(alarm_severity, "info"),
                "resource_type": "alarm",
                "resource_id": alarm_id,
                "action_url": f"/projects/{project_id}",
                "read": False
            }
            notifications_to_create.append(notification)

        # Step 6: Bulk insert all notifications
        if notifications_to_create:
            supabase.table("notifications").insert(notifications_to_create).execute()

    except Exception as e:
        # Log error but don't raise - this is a background task
        # We don't want notification failure to affect alarm creation
        print(f"[Notification Service] Error creating notifications: {e}")


def create_resolved_alarm_notifications(
    supabase: Client,
    alarm_data: dict,
    project_id: str
):
    """
    Create notifications for alarm resolution.

    This is a convenience wrapper around create_alarm_notifications
    with is_resolved=True.

    Args:
        supabase: Supabase client instance
        alarm_data: The alarm that was resolved
        project_id: The project ID this alarm belongs to
    """
    create_alarm_notifications(supabase, alarm_data, project_id, is_resolved=True)


# =============================================================================
# Usage Warning Notifications
# =============================================================================

# Warning messages for different usage thresholds
USAGE_WARNING_MESSAGES = {
    "approaching": {
        "title": "Storage Usage Warning",
        "message": "Your organization is approaching its storage limit ({percent}% used). Consider deleting old data or upgrading your package.",
        "type": "warning"
    },
    "exceeded": {
        "title": "Storage Limit Exceeded",
        "message": "Your organization has exceeded its storage limit ({percent}% used). A 30-day grace period has started. Please delete old data or upgrade your package to avoid data loss.",
        "type": "critical"
    },
    "grace_period_ending": {
        "title": "Grace Period Ending Soon",
        "message": "Your storage grace period is ending in {days_left} days. Please reduce storage usage to under your limit to avoid automatic data cleanup.",
        "type": "critical"
    },
    "critical": {
        "title": "Storage Critical: Automatic Cleanup Imminent",
        "message": "Your organization is at {percent}% storage (over 10% limit). Automatic data cleanup will begin soon. Upgrade your package immediately to prevent data loss.",
        "type": "critical"
    }
}


def create_usage_warning_notification(
    supabase: Client,
    enterprise_id: str,
    warning_type: str,
    usage_percent: float,
    days_left: int = None
):
    """
    Create in-app notifications for storage usage warnings.

    Sends notifications to all enterprise admins and super/backend admins
    when an enterprise approaches or exceeds storage limits.

    Args:
        supabase: Supabase client instance
        enterprise_id: The enterprise ID that triggered the warning
        warning_type: One of "approaching", "exceeded", "grace_period_ending", "critical"
        usage_percent: Current storage usage percentage
        days_left: Days left in grace period (only for grace_period_ending)
    """
    try:
        # Get warning message template
        warning_config = USAGE_WARNING_MESSAGES.get(warning_type)
        if not warning_config:
            print(f"[Notification Service] Unknown usage warning type: {warning_type}")
            return

        # Get enterprise name for context
        enterprise_result = supabase.table("enterprises").select(
            "name"
        ).eq("id", enterprise_id).single().execute()

        enterprise_name = enterprise_result.data.get("name", "Unknown") if enterprise_result.data else "Unknown"

        # Get all enterprise admins for this enterprise
        enterprise_admins_result = supabase.table("users").select(
            "id"
        ).eq("enterprise_id", enterprise_id).eq("role", "enterprise_admin").execute()

        enterprise_admin_ids = [
            row["id"] for row in (enterprise_admins_result.data or [])
        ]

        # Get global admins (super_admin, backend_admin)
        global_admin_result = supabase.table("users").select(
            "id"
        ).in_("role", ["super_admin", "backend_admin"]).execute()

        global_admin_ids = [
            row["id"] for row in (global_admin_result.data or [])
        ]

        # Combine and deduplicate
        all_admin_ids = list(set(enterprise_admin_ids + global_admin_ids))

        if not all_admin_ids:
            return

        # Format message
        message = warning_config["message"].format(
            percent=round(usage_percent, 1),
            days_left=days_left or 0
        )

        title = f"{warning_config['title']} - {enterprise_name}"

        # Create notifications
        notifications_to_create = []
        for user_id in all_admin_ids:
            notification = {
                "id": str(uuid4()),
                "user_id": user_id,
                "title": title,
                "message": message,
                "type": warning_config["type"],
                "resource_type": "usage",
                "resource_id": enterprise_id,
                "action_url": "/settings",
                "read": False
            }
            notifications_to_create.append(notification)

        # Bulk insert
        if notifications_to_create:
            supabase.table("notifications").insert(notifications_to_create).execute()

            # Update enterprise warning level
            supabase.table("enterprises").update({
                "usage_warning_level": warning_type
            }).eq("id", enterprise_id).execute()

    except Exception as e:
        print(f"[Notification Service] Error creating usage warning notifications: {e}")


def check_and_send_usage_warnings(
    supabase: Client,
    enterprise_id: str,
    usage_percent: float,
    grace_period_start: str = None
):
    """
    Check storage usage and send appropriate warnings.

    Called after calculating enterprise storage snapshot.
    Determines which warning level applies and sends notification
    if the level changed since last check.

    Warning thresholds:
    - 80%+: approaching
    - 100%+: exceeded (starts grace period)
    - 110%+: critical
    - Grace period < 7 days: grace_period_ending

    Args:
        supabase: Supabase client instance
        enterprise_id: The enterprise ID to check
        usage_percent: Current storage usage percentage
        grace_period_start: ISO timestamp when grace period started (if any)
    """
    try:
        # Get current warning level
        enterprise_result = supabase.table("enterprises").select(
            "usage_warning_level"
        ).eq("id", enterprise_id).single().execute()

        current_level = enterprise_result.data.get("usage_warning_level") if enterprise_result.data else None

        # Determine new warning level
        new_level = None
        days_left = None

        if usage_percent >= 110:
            new_level = "critical"
        elif usage_percent >= 100:
            new_level = "exceeded"

            # Check if grace period is ending
            if grace_period_start:
                from datetime import datetime, timedelta
                start_date = datetime.fromisoformat(grace_period_start.replace("Z", "+00:00"))
                end_date = start_date + timedelta(days=30)
                days_left = (end_date - datetime.now(start_date.tzinfo)).days

                if days_left <= 7:
                    new_level = "grace_period_ending"
        elif usage_percent >= 80:
            new_level = "approaching"

        # Only send notification if level changed (or increased in severity)
        severity_order = {
            None: 0,
            "approaching": 1,
            "exceeded": 2,
            "grace_period_ending": 3,
            "critical": 4
        }

        current_severity = severity_order.get(current_level, 0)
        new_severity = severity_order.get(new_level, 0)

        if new_level and new_severity > current_severity:
            create_usage_warning_notification(
                supabase,
                enterprise_id,
                new_level,
                usage_percent,
                days_left
            )

            # Start grace period if exceeded for the first time
            if new_level == "exceeded" and not grace_period_start:
                from datetime import datetime
                supabase.table("enterprises").update({
                    "usage_grace_period_start": datetime.utcnow().isoformat()
                }).eq("id", enterprise_id).execute()

        # Clear warning if back under 80%
        elif usage_percent < 80 and current_level:
            supabase.table("enterprises").update({
                "usage_warning_level": None,
                "usage_grace_period_start": None
            }).eq("id", enterprise_id).execute()

    except Exception as e:
        print(f"[Notification Service] Error checking usage warnings: {e}")
