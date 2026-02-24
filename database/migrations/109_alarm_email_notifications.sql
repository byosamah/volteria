-- Migration 109: Alarm Email Notifications
--
-- Adds tracking columns to alarms table for email notification dispatch.
-- Backend polls for unsent notifications every 30s and sends via Resend API.
-- No pg_net required — all HTTP logic lives in FastAPI backend.

-- ============================================
-- 1. Add notification tracking columns to alarms
-- ============================================

-- Track whether activation email has been sent
ALTER TABLE public.alarms
ADD COLUMN IF NOT EXISTS email_notification_sent BOOLEAN NOT NULL DEFAULT false;

-- Track whether resolution email has been sent
ALTER TABLE public.alarms
ADD COLUMN IF NOT EXISTS email_resolution_sent BOOLEAN NOT NULL DEFAULT false;

-- Index for efficient polling: find alarms needing activation email
CREATE INDEX IF NOT EXISTS idx_alarms_email_unsent
ON public.alarms (created_at DESC)
WHERE email_notification_sent = false AND resolved = false;

-- Index for efficient polling: find resolved alarms needing resolution email
CREATE INDEX IF NOT EXISTS idx_alarms_email_resolution_unsent
ON public.alarms (resolved_at DESC)
WHERE email_resolution_sent = false AND resolved = true;

-- ============================================
-- 2. Create notification_log table
-- ============================================

CREATE TABLE IF NOT EXISTS public.notification_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alarm_id UUID NOT NULL REFERENCES public.alarms(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('activated', 'resolved')),
    channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
    recipient TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying notification history per alarm
CREATE INDEX IF NOT EXISTS idx_notification_log_alarm
ON public.notification_log (alarm_id, event_type);

-- Index for finding failed notifications
CREATE INDEX IF NOT EXISTS idx_notification_log_failed
ON public.notification_log (created_at DESC)
WHERE status = 'failed';

-- ============================================
-- 3. RLS Policies
-- ============================================

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (backend uses service role)
CREATE POLICY "Service role full access on notification_log"
ON public.notification_log
FOR ALL
USING (true)
WITH CHECK (true);

-- ============================================
-- 4. Comments
-- ============================================

COMMENT ON COLUMN public.alarms.email_notification_sent IS 'Whether activation email has been dispatched for this alarm';
COMMENT ON COLUMN public.alarms.email_resolution_sent IS 'Whether resolution email has been dispatched for this alarm';
COMMENT ON TABLE public.notification_log IS 'Audit log of all email/SMS notifications sent for alarms';
