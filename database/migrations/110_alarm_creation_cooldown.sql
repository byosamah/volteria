-- Migration 110: Add cooldown to alarm creation functions
-- Problem: When a user resolves an alarm while the condition persists (e.g., controller
-- still offline), the cron recreates it on the next cycle (2 min), triggering another
-- email notification. This creates a create→resolve→create churn loop.
-- Fix: After the dedup check, also check if the same alarm type was resolved recently
-- (within 30 minutes). If so, skip creation — the cooldown prevents rapid churn.

-- =============================================================================
-- 1. Update create_controller_offline_alarm with cooldown
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_controller_offline_alarm(
    p_site_id UUID,
    p_controller_name TEXT,
    p_severity TEXT DEFAULT 'critical'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_alarm_id UUID;
    v_existing UUID;
BEGIN
    -- Check 1: existing unresolved alarm (original dedup)
    SELECT id INTO v_existing
    FROM public.alarms
    WHERE site_id = p_site_id
      AND alarm_type = 'controller_offline'
      AND resolved = false
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
        RETURN NULL;
    END IF;

    -- Check 2: recently resolved alarm (cooldown — prevent churn)
    -- If same alarm was resolved in last 30 min, don't re-create
    SELECT id INTO v_existing
    FROM public.alarms
    WHERE site_id = p_site_id
      AND alarm_type = 'controller_offline'
      AND resolved = true
      AND resolved_at > now() - INTERVAL '30 minutes'
    ORDER BY resolved_at DESC
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
        RETURN NULL;
    END IF;

    -- Create new alarm
    INSERT INTO public.alarms (
        site_id,
        device_name,
        alarm_type,
        message,
        severity,
        acknowledged,
        resolved,
        created_at
    )
    VALUES (
        p_site_id,
        p_controller_name,
        'controller_offline',
        'Controller has not sent heartbeat for more than 2 minutes',
        p_severity,
        false,
        false,
        now()
    )
    RETURNING id INTO v_alarm_id;

    RETURN v_alarm_id;
END;
$$;

-- =============================================================================
-- 2. Update create_not_reporting_alarm with cooldown
-- Preserves device_id matching from migration 099 + severity from 091
-- =============================================================================
DROP FUNCTION IF EXISTS public.create_not_reporting_alarm(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.create_not_reporting_alarm(
    p_site_id UUID,
    p_device_id UUID,
    p_device_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_alarm_id UUID;
    v_existing UUID;
    v_severity TEXT;
BEGIN
    -- Check 1: existing unresolved alarm (device_id first, fallback device_name)
    SELECT id INTO v_existing
    FROM public.alarms
    WHERE site_id = p_site_id
      AND alarm_type = 'not_reporting'
      AND resolved = false
      AND (
          device_id = p_device_id
          OR (device_id IS NULL AND device_name = p_device_name)
      )
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
        RETURN NULL;
    END IF;

    -- Check 2: recently resolved alarm (cooldown — prevent churn)
    SELECT id INTO v_existing
    FROM public.alarms
    WHERE site_id = p_site_id
      AND alarm_type = 'not_reporting'
      AND resolved = true
      AND resolved_at > now() - INTERVAL '30 minutes'
      AND (
          device_id = p_device_id
          OR (device_id IS NULL AND device_name = p_device_name)
      )
    ORDER BY resolved_at DESC
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
        RETURN NULL;
    END IF;

    -- Get device's configured severity
    SELECT COALESCE(connection_alarm_severity, 'warning') INTO v_severity
    FROM public.site_devices
    WHERE id = p_device_id;

    IF v_severity IS NULL THEN
        v_severity := 'warning';
    END IF;

    -- Create new alarm
    INSERT INTO public.alarms (
        site_id,
        device_id,
        device_name,
        alarm_type,
        message,
        severity,
        acknowledged,
        resolved,
        created_at
    )
    VALUES (
        p_site_id,
        p_device_id,
        p_device_name,
        'not_reporting',
        'Device has not reported data for more than 10 minutes',
        v_severity,
        false,
        false,
        now()
    )
    RETURNING id INTO v_alarm_id;

    RETURN v_alarm_id;
END;
$$;

-- =============================================================================
-- 3. Grant permissions
-- =============================================================================
GRANT EXECUTE ON FUNCTION create_controller_offline_alarm(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_not_reporting_alarm(UUID, UUID, TEXT) TO service_role;
