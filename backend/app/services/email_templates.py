"""
Email Templates — Alarm Notification Emails

Generates HTML email content for alarm activation and resolution events.
Includes severity badges, alarm details, timestamps, and links to the alarms page.
"""

from datetime import datetime


# Severity → color mapping for email badges
SEVERITY_COLORS = {
    "critical": {"bg": "#dc2626", "text": "#ffffff"},  # Red
    "major": {"bg": "#ea580c", "text": "#ffffff"},      # Orange
    "warning": {"bg": "#ca8a04", "text": "#ffffff"},    # Amber
    "minor": {"bg": "#2563eb", "text": "#ffffff"},      # Blue
    "info": {"bg": "#6b7280", "text": "#ffffff"},       # Gray
}


def format_alarm_email(
    alarm: dict,
    project_name: str,
    site_name: str,
    is_resolved: bool = False,
    timezone: str = "UTC",
) -> tuple[str, str]:
    """
    Generate email subject and HTML body for an alarm notification.

    Args:
        alarm: Alarm data dict (alarm_type, device_name, message, severity, created_at, resolved_at)
        project_name: Name of the project
        site_name: Name of the site
        is_resolved: Whether this is a resolution notification
        timezone: Project timezone (IANA format) for display

    Returns:
        Tuple of (subject, html_body)
    """
    severity = alarm.get("severity", "warning")
    alarm_type = alarm.get("alarm_type", "unknown")
    device_name = alarm.get("device_name", "—")
    message = alarm.get("message", "")
    condition = alarm.get("condition", "")
    created_at = alarm.get("created_at", "")
    resolved_at = alarm.get("resolved_at", "")

    # Format readable alarm type
    alarm_type_display = alarm_type.replace("_", " ").title()

    # Status — green header for resolved, severity color for activated
    status = "RESOLVED" if is_resolved else "ACTIVATED"
    header_bg = "#16a34a" if is_resolved else SEVERITY_COLORS.get(severity, SEVERITY_COLORS["warning"])["bg"]
    severity_colors = SEVERITY_COLORS.get(severity, SEVERITY_COLORS["warning"])

    # Subject line
    if is_resolved:
        subject = f"[Resolved] {alarm_type_display} — {site_name}"
    else:
        subject = f"[{severity.upper()}] {alarm_type_display} — {site_name}"

    # Format timestamps
    created_display = _format_timestamp(created_at, timezone)
    resolved_display = _format_timestamp(resolved_at, timezone) if resolved_at else "—"

    # Build HTML
    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background-color:{header_bg};padding:20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="color:#ffffff;font-size:12px;text-transform:uppercase;letter-spacing:1px;opacity:0.9;">Alarm {status}</span>
                    <br>
                    <span style="color:#ffffff;font-size:22px;font-weight:700;">{alarm_type_display}</span>
                  </td>
                  <td align="right" valign="top">
                    <span style="display:inline-block;background-color:rgba(255,255,255,0.2);color:#ffffff;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;text-transform:uppercase;">
                      {"resolved" if is_resolved else severity}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding:20px 24px 12px;">
              {f'<p style="margin:0 0 8px;color:#16a34a;font-size:14px;font-weight:600;">This alarm has been resolved.</p>' if is_resolved else ''}
              <p style="margin:0;color:#374151;font-size:15px;line-height:1.5;">{message}</p>
              {f'<p style="margin:8px 0 0;color:#6b7280;font-size:13px;">Condition: {condition}</p>' if condition else ''}
            </td>
          </tr>

          <!-- Details Table -->
          <tr>
            <td style="padding:8px 24px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
                {_detail_row("Project", project_name, "#f9fafb")}
                {_detail_row("Site", site_name)}
                {_detail_row("Device", device_name, "#f9fafb")}
                {_detail_row("Triggered", f"{created_display} ({timezone})")}
                {_detail_row("Resolved", f"{resolved_display} ({timezone})", "#f9fafb") if is_resolved else ""}
              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding:0 24px 24px;" align="center">
              <a href="https://volteria.org/alarms" style="display:inline-block;background-color:#111827;color:#ffffff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;">
                View Alarms
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:16px 24px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                Volteria — Energy Management
                <br>
                <a href="https://volteria.org/settings/notifications" style="color:#6b7280;text-decoration:underline;">Notification Settings</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    return subject, html


def _detail_row(label: str, value: str, bg_color: str = "#ffffff") -> str:
    """Generate a single row for the details table."""
    return f"""<tr>
    <td style="padding:10px 14px;background-color:{bg_color};border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;width:100px;">{label}</td>
    <td style="padding:10px 14px;background-color:{bg_color};border-bottom:1px solid #e5e7eb;color:#111827;font-size:13px;font-weight:500;">{value}</td>
</tr>"""


def _format_timestamp(ts: str, timezone: str = "UTC") -> str:
    """
    Format an ISO timestamp string for display.

    Attempts timezone conversion if pytz/zoneinfo available,
    falls back to UTC display otherwise.
    """
    if not ts:
        return "—"

    try:
        # Parse ISO timestamp
        if isinstance(ts, str):
            # Handle various ISO formats
            ts_clean = ts.replace("Z", "+00:00")
            dt = datetime.fromisoformat(ts_clean)
        else:
            dt = ts

        # Try timezone conversion
        try:
            from zoneinfo import ZoneInfo
            if timezone and timezone != "UTC":
                dt = dt.astimezone(ZoneInfo(timezone))
            else:
                dt = dt.astimezone(ZoneInfo("UTC"))
        except (ImportError, KeyError):
            pass  # Fall back to UTC

        return dt.strftime("%b %d, %Y at %I:%M %p")
    except Exception:
        # If all parsing fails, return the raw string
        return str(ts)[:19]
