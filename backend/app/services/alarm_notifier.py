"""
Alarm Email Notifier — Background Task

Polls the alarms table every 30 seconds for:
1. New alarms that haven't had activation emails sent (email_notification_sent = false)
2. Resolved alarms that haven't had resolution emails sent (email_resolution_sent = false)

For each, sends an email via Resend and logs to notification_log.

Architecture:
- Runs as an asyncio background task started in FastAPI lifespan
- Uses the same Supabase service_role client as the rest of the backend
- Phase 1: hardcoded recipient (testing)
- Phase 2: per-user preferences via user_project_notifications table
"""

import asyncio
from datetime import datetime, timezone
from uuid import uuid4

from ..services.supabase import get_supabase
from ..services.email_service import send_email
from ..services.email_templates import format_alarm_email

# Phase 1: Hardcoded test recipient
# Phase 2: Replace with user preference lookup
TEST_RECIPIENT = "mohkof1106@gmail.com"

# How often to poll for unsent notifications (seconds)
POLL_INTERVAL = 30

# Max alarms to process per poll cycle (prevent runaway)
BATCH_SIZE = 20

# Track the background task so we can cancel on shutdown
_notifier_task: asyncio.Task | None = None


async def start_notifier():
    """Start the alarm notification background loop."""
    global _notifier_task
    _notifier_task = asyncio.create_task(_notification_loop())
    print("[Alarm Notifier] Started — polling every 30s")


async def stop_notifier():
    """Stop the alarm notification background loop."""
    global _notifier_task
    if _notifier_task:
        _notifier_task.cancel()
        try:
            await _notifier_task
        except asyncio.CancelledError:
            pass
        print("[Alarm Notifier] Stopped")


async def _notification_loop():
    """Main polling loop — runs forever until cancelled."""
    # Wait a bit on startup to let services initialize
    await asyncio.sleep(5)

    while True:
        try:
            await _process_pending_notifications()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[Alarm Notifier] Error in poll cycle: {e}")

        await asyncio.sleep(POLL_INTERVAL)


async def _process_pending_notifications():
    """Single poll cycle: find and send pending alarm emails."""
    supabase = get_supabase()

    # 1. Find new alarms needing activation email
    await _send_activation_emails(supabase)

    # 2. Find resolved alarms needing resolution email
    await _send_resolution_emails(supabase)


async def _send_activation_emails(supabase):
    """Find unresolved alarms where email_notification_sent = false and send activation emails."""
    result = supabase.table("alarms").select(
        "id, site_id, alarm_type, device_name, message, condition, severity, created_at"
    ).eq(
        "email_notification_sent", False
    ).eq(
        "resolved", False
    ).order(
        "created_at", desc=False  # Oldest first
    ).limit(BATCH_SIZE).execute()

    if not result.data:
        return

    for alarm in result.data:
        await _send_alarm_email(supabase, alarm, is_resolved=False)


async def _send_resolution_emails(supabase):
    """Find resolved alarms where email_resolution_sent = false and send resolution emails."""
    result = supabase.table("alarms").select(
        "id, site_id, alarm_type, device_name, message, condition, severity, created_at, resolved_at"
    ).eq(
        "email_resolution_sent", False
    ).eq(
        "resolved", True
    ).order(
        "resolved_at", desc=False  # Oldest first
    ).limit(BATCH_SIZE).execute()

    if not result.data:
        return

    for alarm in result.data:
        await _send_alarm_email(supabase, alarm, is_resolved=True)


async def _send_alarm_email(supabase, alarm: dict, is_resolved: bool):
    """Send email for a single alarm and mark as sent."""
    alarm_id = alarm["id"]
    site_id = alarm.get("site_id")

    # Get project/site context for the email
    project_name, site_name, timezone_str = await _get_alarm_context(supabase, site_id)

    # Generate email content
    subject, html = format_alarm_email(
        alarm=alarm,
        project_name=project_name,
        site_name=site_name,
        is_resolved=is_resolved,
        timezone=timezone_str,
    )

    # Send email
    recipient = TEST_RECIPIENT
    result = await send_email(to=recipient, subject=subject, html=html)

    # Log the notification
    status = "sent" if result else "failed"
    error_msg = None if result else "Resend API call failed"

    try:
        supabase.table("notification_log").insert({
            "id": str(uuid4()),
            "alarm_id": alarm_id,
            "event_type": "resolved" if is_resolved else "activated",
            "channel": "email",
            "recipient": recipient,
            "status": status,
            "error_message": error_msg,
        }).execute()
    except Exception as e:
        print(f"[Alarm Notifier] Failed to log notification: {e}")

    # Mark alarm as email-sent (even on failure — prevents infinite retry loops)
    # Failed notifications are visible in notification_log for debugging
    try:
        if is_resolved:
            supabase.table("alarms").update({
                "email_resolution_sent": True
            }).eq("id", alarm_id).execute()
        else:
            supabase.table("alarms").update({
                "email_notification_sent": True
            }).eq("id", alarm_id).execute()
    except Exception as e:
        print(f"[Alarm Notifier] Failed to mark alarm {alarm_id} as sent: {e}")


async def _get_alarm_context(supabase, site_id: str | None) -> tuple[str, str, str]:
    """
    Get project name, site name, and timezone for email context.

    Returns:
        Tuple of (project_name, site_name, timezone)
    """
    if not site_id:
        return "Unknown Project", "Unknown Site", "UTC"

    try:
        # Get site with project info
        site_result = supabase.table("sites").select(
            "name, project_id, projects(name, timezone)"
        ).eq("id", site_id).limit(1).execute()

        if site_result.data:
            site = site_result.data[0]
            site_name = site.get("name", "Unknown Site")
            project_data = site.get("projects", {})
            project_name = project_data.get("name", "Unknown Project") if project_data else "Unknown Project"
            timezone_str = project_data.get("timezone", "UTC") if project_data else "UTC"
            return project_name, site_name, timezone_str
    except Exception as e:
        print(f"[Alarm Notifier] Error fetching alarm context for site {site_id}: {e}")

    return "Unknown Project", "Unknown Site", "UTC"
