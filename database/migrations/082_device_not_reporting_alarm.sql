-- Migration: Device Not-Reporting Alarm Infrastructure
-- Description: Drop unused timeout_multiplier column, add helper functions for cloud-side detection

-- =============================================================================
-- 1. Drop unused timeout_multiplier column
-- =============================================================================
ALTER TABLE site_devices DROP COLUMN IF EXISTS connection_timeout_multiplier;

-- =============================================================================
-- 2. Add is_online and last_seen columns if they don't exist
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'site_devices' AND column_name = 'is_online') THEN
        ALTER TABLE site_devices ADD COLUMN is_online BOOLEAN DEFAULT true;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'site_devices' AND column_name = 'last_seen') THEN
        ALTER TABLE site_devices ADD COLUMN last_seen TIMESTAMPTZ;
    END IF;
END $$;

-- =============================================================================
-- 3. Enable pg_cron extension
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- =============================================================================
-- 4. Helper function: Get devices that haven't reported in timeout_seconds
-- NOTE: Only returns devices that HAVE reported before (INNER JOIN on readings)
-- =============================================================================
CREATE OR REPLACE FUNCTION get_non_reporting_devices(timeout_seconds INT DEFAULT 600)
RETURNS TABLE(
    device_id UUID,
    device_name TEXT,
    site_id UUID,
    project_id UUID,
    last_reading TIMESTAMPTZ,
    seconds_since_last INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH latest_readings AS (
        SELECT DISTINCT ON (dr.device_id)
            dr.device_id,
            dr.timestamp
        FROM public.device_readings dr
        ORDER BY dr.device_id, dr.timestamp DESC
    )
    SELECT
        sd.id,
        sd.name,
        sd.site_id,
        s.project_id,
        lr.timestamp,
        EXTRACT(EPOCH FROM (now() - lr.timestamp))::INT
    FROM public.site_devices sd
    JOIN public.sites s ON s.id = sd.site_id
    JOIN latest_readings lr ON lr.device_id = sd.id  -- INNER JOIN = only devices with readings
    WHERE sd.connection_alarm_enabled = true
      AND now() - lr.timestamp > (timeout_seconds || ' seconds')::INTERVAL;
$$;

-- =============================================================================
-- 5. Helper function: Check if controller is online (heartbeat within 2 minutes)
-- Links via: heartbeats.controller_id → controllers.id → controllers.site_id
-- =============================================================================
CREATE OR REPLACE FUNCTION is_site_controller_online(p_site_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.controller_heartbeats ch
        JOIN public.controllers c ON c.id = ch.controller_id
        WHERE c.site_id = p_site_id
          AND ch.timestamp > now() - interval '2 minutes'
    );
$$;

-- =============================================================================
-- 6. Helper function: Create not_reporting alarm if not already active
-- Uses device_name (not device_id) since alarms table uses device_name
-- =============================================================================
CREATE OR REPLACE FUNCTION create_not_reporting_alarm(
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
    v_existing_alarm UUID;
BEGIN
    -- Check for existing unresolved alarm for this device (by name)
    SELECT id INTO v_existing_alarm
    FROM public.alarms
    WHERE site_id = p_site_id
      AND device_name = p_device_name
      AND alarm_type = 'not_reporting'
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
        p_device_name,
        'not_reporting',
        'Device has not reported data for more than 10 minutes',
        'warning',
        false,
        false,
        now()
    )
    RETURNING id INTO v_alarm_id;

    RETURN v_alarm_id;
END;
$$;

-- =============================================================================
-- 7. Helper function: Auto-resolve not_reporting alarm when device comes back
-- Uses device_name (not device_id) since alarms table uses device_name
-- =============================================================================
CREATE OR REPLACE FUNCTION resolve_not_reporting_alarm(
    p_site_id UUID,
    p_device_name TEXT
)
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
      AND device_name = p_device_name
      AND alarm_type = 'not_reporting'
      AND resolved = false;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- =============================================================================
-- 8. Main function: Check all devices and update status + alarms
-- Called by pg_cron every 5 minutes
-- =============================================================================
CREATE OR REPLACE FUNCTION check_device_connection_status(
    p_timeout_seconds INT DEFAULT 600
)
RETURNS TABLE(
    action TEXT,
    device_id UUID,
    device_name TEXT,
    site_id UUID,
    alarm_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_device RECORD;
    v_controller_online BOOLEAN;
    v_alarm_id UUID;
    v_resolved_count INT;
BEGIN
    -- First, handle devices that ARE reporting (update is_online = true, resolve alarms)
    FOR v_device IN
        WITH latest_readings AS (
            SELECT DISTINCT ON (dr.device_id)
                dr.device_id,
                dr.timestamp
            FROM public.device_readings dr
            ORDER BY dr.device_id, dr.timestamp DESC
        )
        SELECT
            sd.id,
            sd.name,
            sd.site_id,
            lr.timestamp as last_reading
        FROM public.site_devices sd
        LEFT JOIN latest_readings lr ON lr.device_id = sd.id
        WHERE sd.connection_alarm_enabled = true
          AND lr.timestamp IS NOT NULL
          AND now() - lr.timestamp <= (p_timeout_seconds || ' seconds')::INTERVAL
    LOOP
        -- Update device status to online
        UPDATE public.site_devices
        SET is_online = true, last_seen = v_device.last_reading
        WHERE id = v_device.id;

        -- Resolve any existing not_reporting alarm (using device name)
        SELECT public.resolve_not_reporting_alarm(v_device.site_id, v_device.name) INTO v_resolved_count;

        IF v_resolved_count > 0 THEN
            action := 'resolved';
            device_id := v_device.id;
            device_name := v_device.name;
            site_id := v_device.site_id;
            alarm_id := NULL;
            RETURN NEXT;
        END IF;
    END LOOP;

    -- Then, handle devices that are NOT reporting
    FOR v_device IN
        SELECT * FROM public.get_non_reporting_devices(p_timeout_seconds)
    LOOP
        -- Check if controller is online for this site
        v_controller_online := public.is_site_controller_online(v_device.site_id);

        IF v_controller_online THEN
            -- Controller is online but device not reporting - create alarm
            UPDATE public.site_devices
            SET is_online = false, last_seen = v_device.last_reading
            WHERE id = v_device.device_id;

            SELECT public.create_not_reporting_alarm(v_device.site_id, v_device.device_id, v_device.device_name)
            INTO v_alarm_id;

            IF v_alarm_id IS NOT NULL THEN
                action := 'alarm_created';
                device_id := v_device.device_id;
                device_name := v_device.device_name;
                site_id := v_device.site_id;
                alarm_id := v_alarm_id;
                RETURN NEXT;
            ELSE
                action := 'alarm_exists';
                device_id := v_device.device_id;
                device_name := v_device.device_name;
                site_id := v_device.site_id;
                alarm_id := NULL;
                RETURN NEXT;
            END IF;
        ELSE
            -- Controller offline - don't alarm individual devices
            -- (controller_offline alarm should be handled separately)
            action := 'controller_offline';
            device_id := v_device.device_id;
            device_name := v_device.device_name;
            site_id := v_device.site_id;
            alarm_id := NULL;
            RETURN NEXT;
        END IF;
    END LOOP;

    RETURN;
END;
$$;

-- Grant execute permissions to service role
GRANT EXECUTE ON FUNCTION get_non_reporting_devices(INT) TO service_role;
GRANT EXECUTE ON FUNCTION is_site_controller_online(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION create_not_reporting_alarm(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION resolve_not_reporting_alarm(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION check_device_connection_status(INT) TO service_role;

-- =============================================================================
-- 9. Schedule the check to run every 5 minutes
-- =============================================================================
SELECT cron.schedule(
    'check-device-alarms',           -- job name
    '*/5 * * * *',                   -- cron expression: every 5 minutes
    $$SELECT * FROM check_device_connection_status(600)$$  -- function call with 10 min timeout
);
