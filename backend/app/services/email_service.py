"""
Email Service — Resend API Integration

Sends transactional emails via Resend REST API.
Uses httpx (already in requirements) — no new dependencies.

Free tier: 3,000 emails/month, 100/day.
Upgrade to Pro ($20/mo) for 50,000/month with no daily cap.
"""

import os
import httpx

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")

# Custom domain verified on Resend (alerts.volteria.org)
FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "Volteria <no-reply@alerts.volteria.org>")


async def send_email(to: str, subject: str, html: str) -> dict:
    """
    Send an email via Resend API.

    Args:
        to: Recipient email address
        subject: Email subject line
        html: HTML email body

    Returns:
        dict with "id" on success, or "error" on failure
        Success: {"id": "resend-id-here"}
        Failure: {"error": "422: detailed error message"}
    """
    if not RESEND_API_KEY:
        print("[Email Service] RESEND_API_KEY not set — skipping email")
        return {"error": "RESEND_API_KEY not configured"}

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {RESEND_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": FROM_EMAIL,
                    "to": [to],
                    "subject": subject,
                    "html": html,
                },
                timeout=10.0,
            )
            response.raise_for_status()
            result = response.json()
            print(f"[Email Service] Sent to {to}: {subject} (id: {result.get('id')})")
            return result
    except httpx.HTTPStatusError as e:
        error_detail = f"{e.response.status_code}: {e.response.text}"
        print(f"[Email Service] HTTP error sending to {to}: {error_detail}")
        return {"error": error_detail}
    except Exception as e:
        error_detail = f"Connection error: {e}"
        print(f"[Email Service] Error sending to {to}: {error_detail}")
        return {"error": error_detail}
