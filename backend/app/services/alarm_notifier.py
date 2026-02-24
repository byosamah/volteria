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


async def _claim_pending_alarms(supabase, is_resolved: bool) -> list[dict]:
    """Atomically claim alarms for email processing.

    Uses UPDATE-then-SELECT pattern: marks alarms as sent FIRST, then fetches
    the ones we just claimed. Prevents duplicate emails across multiple workers.
    """
    if is_resolved:
        # Find IDs of alarms needing resolution email
        id_result = supabase.table("alarms").select("id").eq(
            "email_resolution_sent", False
        ).eq(
            "resolved", True
        ).order("resolved_at", desc=False).limit(BATCH_SIZE).execute()
    else:
        # Find IDs of alarms needing activation email
        id_result = supabase.table("alarms").select("id").eq(
            "email_notification_sent", False
        ).eq(
            "resolved", False
        ).order("created_at", desc=False).limit(BATCH_SIZE).execute()

    if not id_result.data:
        return []

    alarm_ids = [a["id"] for a in id_result.data]
    claimed = []

    for alarm_id in alarm_ids:
        try:
            # Claim by marking as sent — use conditional UPDATE so only one
            # worker succeeds (the flag is already true for the loser).
            flag = "email_resolution_sent" if is_resolved else "email_notification_sent"
            claim_result = supabase.table("alarms").update({
                flag: True
            }).eq("id", alarm_id).eq(flag, False).execute()

            # Supabase REST returns the updated rows. If empty, another worker
            # already claimed it (the eq(flag, False) filtered it out).
            if claim_result.data:
                claimed.append(alarm_id)
        except Exception as e:
            print(f"[Alarm Notifier] Failed to claim alarm {alarm_id}: {e}")

    if not claimed:
        return []

    # Fetch full alarm data for claimed IDs
    select_fields = "id, site_id, alarm_type, device_name, message, condition, severity, created_at"
    if is_resolved:
        select_fields += ", resolved_at"

    alarms = []
    for alarm_id in claimed:
        try:
            result = supabase.table("alarms").select(select_fields).eq(
                "id", alarm_id
            ).execute()
            if result.data:
                alarms.append(result.data[0])
        except Exception as e:
            print(f"[Alarm Notifier] Failed to fetch alarm {alarm_id}: {e}")

    return alarms


async def _send_activation_emails(supabase):
    """Claim and send activation emails for new alarms."""
    alarms = await _claim_pending_alarms(supabase, is_resolved=False)
    for alarm in alarms:
        await _send_alarm_email(supabase, alarm, is_resolved=False)


async def _send_resolution_emails(supabase):
    """Claim and send resolution emails for resolved alarms."""
    alarms = await _claim_pending_alarms(supabase, is_resolved=True)
    for alarm in alarms:
        await _send_alarm_email(supabase, alarm, is_resolved=True)


async def _send_alarm_email(supabase, alarm: dict, is_resolved: bool):
    """Send email for a single alarm (already claimed/marked as sent)."""
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
