-- Auto-delete heartbeats older than 8 days
-- Heartbeats are sent every 30s; only recent ones needed for online status
-- Applied: 2026-02-20

CREATE OR REPLACE FUNCTION public.cleanup_old_heartbeats()
RETURNS void LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.controller_heartbeats
  WHERE timestamp < now() - interval '8 days';
END;
$$;

-- Run daily at 3 AM UTC
SELECT cron.schedule(
  'cleanup-old-heartbeats',
  '0 3 * * *',
  'SELECT public.cleanup_old_heartbeats()'
);
