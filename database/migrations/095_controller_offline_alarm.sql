-- Migration 095: Controller Offline Alarm Infrastructure
-- Description: Add pg_cron job to detect when controllers go offline and create/resolve alarms
-- Pattern follows migration 082 (device_not_reporting_alarm) exactly

-- =============================================================================
-- 1. Add alarm settings columns to site_master_devices
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'site_master_devices' AND column_name = 'controller_alarm_enabled') THEN
        ALTER TABLE site_master_devices ADD COLUMN controller_alarm_enabled BOOLEAN DEFAULT true;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'site_master_devices' AND column_name = 'controller_alarm_severity') THEN
        ALTER TABLE site_master_devices ADD COLUMN controller_alarm_severity TEXT DEFAULT 'critical'
            CHECK (controller_alarm_severity IN ('warning', 'minor', 'major', 'critical'));
    END IF;
END $$;

-- =============================================================================
-- 2. Helper function: Get controllers that haven't sent heartbeat in timeout_seconds
-- Uses controller_heartbeats table (heartbeats sent every 30s, offline after 2 min)
-- =============================================================================
CREATE OR REPLACE FUNCTION get_offline_controllers(p_timeout_seconds INT DEFAULT 120)
RETURNS TABLE(
    site_id UUID,
    controller_id UUID,
    controller_name TEXT,
    project_id UUID,
    last_heartbeat TIMESTAMPTZ,
    seconds_since_last INT,
    alarm_enabled BOOLEAN,
    alarm_severity TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH latest_heartbeats AS (
        SELECT DISTINCT ON (ch.controller_id)
            ch.controller_id,
            ch.timestamp
        FROM public.controller_heartbeats ch
        ORDER BY ch.controller_id, ch.timestamp DESC
    )
    SELECT
        smd.site_id,
        smd.controller_id,
        smd.name,
        s.project_id,
        lh.timestamp,
        EXTRACT(EPOCH FROM (now() - lh.timestamp))::INT,
        COALESCE(smd.controller_alarm_enabled, true),
        COALESCE(smd.controller_alarm_severity, 'critical')
    FROM public.site_master_devices smd
    JOIN public.sites s ON s.id = smd.site_id
    JOIN public.controllers c ON c.id = smd.controller_id
    LEFT JOIN latest_heartbeats lh ON lh.controller_id = smd.controller_id
    WHERE smd.device_type = 'controller'
      AND smd.is_active = true
      AND COALESCE(smd.controller_alarm_enabled, true) = true
      -- Controller has heartbeat history AND is now offline
      AND lh.timestamp IS NOT NULL
      AND now() - lh.timestamp > (p_timeout_seconds || ' seconds')::INTERVAL;
$$;

-- =============================================================================
-- 3. Helper function: Get controllers that ARE online (for auto-resolve)
-- =============================================================================
CREATE OR REPLACE FUNCTION get_online_controllers(p_timeout_seconds INT DEFAULT 120)
RETURNS TABLE(
    site_id UUID,
    controller_id UUID,
    controller_name TEXT,
    last_heartbeat TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH latest_heartbeats AS (
        SELECT DISTINCT ON (ch.controller_id)
            ch.controller_id,
            ch.timestamp
        FROM public.controller_heartbeats ch
        ORDER BY ch.controller_id, ch.timestamp DESC
    )
    SELECT
        smd.site_id,
        smd.controller_id,
        smd.name,
        lh.timestamp
    FROM public.site_master_devices smd
    JOIN public.controllers c ON c.id = smd.controller_id
    JOIN latest_heartbeats lh ON lh.controller_id = smd.controller_id
    WHERE smd.device_type = 'controller'
      AND smd.is_active = true
      -- Controller has heartbeat within timeout (online)
      AND now() - lh.timestamp <= (p_timeout_seconds || ' seconds')::INTERVAL;
$$;

-- =============================================================================
-- 4. Helper function: Create controller_offline alarm if not already active
-- =============================================================================
CREATE OR REPLACE FUNCTION create_controller_offline_alarm(
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
    v_existing_alarm UUID;
BEGIN
    -- Check for existing unresolved alarm for this controller (by site)
    SELECT id INTO v_existing_alarm
    FROM public.alarms
    WHERE site_id = p_site_id
      AND alarm_type = 'controller_offline'
      AND resolved = false
    LIMIT 1;

    -- If alarm already exists, return null (no new alarm created)
    IF v_existing_alarm IS NOT NULL THEN
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
-- 5. Helper function: Auto-resolve controller_offline alarm when heartbeat resumes
-- =============================================================================
CREATE OR REPLACE FUNCTION resolve_controller_offline_alarm(p_site_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count INT;
BEGIN
    UPDATE public.alarms
    SET resolved = true,
        resolved_at = now()
    WHERE site_id = p_site_id
      AND alarm_type = 'controller_offline'
      AND resolved = false;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- =============================================================================
-- 6. Main function: Check all controllers and create/resolve alarms
-- Called by pg_cron every 5 minutes
-- =============================================================================
CREATE OR REPLACE FUNCTION check_controller_connection_status(
    p_timeout_seconds INT DEFAULT 120
)
RETURNS TABLE(
    action TEXT,
    controller_id UUID,
    controller_name TEXT,
    site_id UUID,
    alarm_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_controller RECORD;
    v_alarm_id UUID;
    v_resolved_count INT;
BEGIN
    -- First, handle controllers that ARE online (resolve any existing alarms)
    FOR v_controller IN
        SELECT * FROM public.get_online_controllers(p_timeout_seconds)
    LOOP
        -- Resolve any existing controller_offline alarm
        SELECT public.resolve_controller_offline_alarm(v_controller.site_id) INTO v_resolved_count;

        IF v_resolved_count > 0 THEN
            action := 'resolved';
            controller_id := v_controller.controller_id;
            controller_name := v_controller.controller_name;
            site_id := v_controller.site_id;
            alarm_id := NULL;
            RETURN NEXT;
        END IF;
    END LOOP;

    -- Then, handle controllers that are OFFLINE (create alarms)
    FOR v_controller IN
        SELECT * FROM public.get_offline_controllers(p_timeout_seconds)
    LOOP
        -- Create alarm with configured severity
        SELECT public.create_controller_offline_alarm(
            v_controller.site_id,
            v_controller.controller_name,
            v_controller.alarm_severity
        ) INTO v_alarm_id;

        IF v_alarm_id IS NOT NULL THEN
            action := 'alarm_created';
            controller_id := v_controller.controller_id;
            controller_name := v_controller.controller_name;
            site_id := v_controller.site_id;
            alarm_id := v_alarm_id;
            RETURN NEXT;
        ELSE
            action := 'alarm_exists';
            controller_id := v_controller.controller_id;
            controller_name := v_controller.controller_name;
            site_id := v_controller.site_id;
            alarm_id := NULL;
            RETURN NEXT;
        END IF;
    END LOOP;

    RETURN;
END;
$$;

-- =============================================================================
-- 7. Grant execute permissions to service role
-- =============================================================================
GRANT EXECUTE ON FUNCTION get_offline_controllers(INT) TO service_role;
GRANT EXECUTE ON FUNCTION get_online_controllers(INT) TO service_role;
GRANT EXECUTE ON FUNCTION create_controller_offline_alarm(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION resolve_controller_offline_alarm(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION check_controller_connection_status(INT) TO service_role;

-- =============================================================================
-- 8. Schedule the check to run every 5 minutes
-- =============================================================================
SELECT cron.schedule(
    'check-controller-alarms',           -- job name
    '*/5 * * * *',                        -- cron expression: every 5 minutes
    $$SELECT * FROM check_controller_connection_status(120)$$  -- 2 min timeout (4 missed heartbeats)
);
