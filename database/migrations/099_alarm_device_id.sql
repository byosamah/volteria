-- Migration 099: Add device_id to alarms for stable alarm matching
-- Problem: Renaming a device orphans active alarms (matched by device_name TEXT)
-- Solution: Match by device_id UUID (immutable), keep device_name for display
-- Applied: 2026-02-13

-- =============================================================================
-- 1. Add device_id column to alarms table (nullable for backward compat)
-- =============================================================================
ALTER TABLE public.alarms ADD COLUMN IF NOT EXISTS device_id UUID;

CREATE INDEX IF NOT EXISTS idx_alarms_device_id_type
ON public.alarms(device_id, alarm_type) WHERE device_id IS NOT NULL;

-- =============================================================================
-- 2. Backfill existing alarms from site_devices by (site_id, device_name)
-- =============================================================================
UPDATE public.alarms a
SET device_id = sd.id
FROM public.site_devices sd
WHERE a.site_id = sd.site_id
  AND a.device_name = sd.name
  AND a.device_id IS NULL
  AND a.device_name IS NOT NULL;

-- =============================================================================
-- 3. Update create_not_reporting_alarm: store device_id, match by it
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
    v_existing_alarm UUID;
BEGIN
    -- Check for existing unresolved alarm (device_id first, fallback device_name)
    SELECT id INTO v_existing_alarm
    FROM public.alarms
    WHERE site_id = p_site_id
      AND alarm_type = 'not_reporting'
      AND resolved = false
      AND (
          device_id = p_device_id
          OR (device_id IS NULL AND device_name = p_device_name)
      )
    LIMIT 1;

    IF v_existing_alarm IS NOT NULL THEN
        RETURN NULL;
    END IF;

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
-- 4. Update resolve_not_reporting_alarm: new signature with device_id
-- =============================================================================
DROP FUNCTION IF EXISTS public.resolve_not_reporting_alarm(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.resolve_not_reporting_alarm(
    p_site_id UUID,
    p_device_id UUID,
    p_device_name TEXT DEFAULT NULL
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
      AND alarm_type = 'not_reporting'
      AND resolved = false
      AND (
          device_id = p_device_id
          OR (device_id IS NULL AND device_name = p_device_name)
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- =============================================================================
-- 5. Update check_device_connection_status: pass device_id to resolve/create
-- =============================================================================
CREATE OR REPLACE FUNCTION public.check_device_connection_status(p_timeout_seconds integer DEFAULT 600)
RETURNS TABLE(action text, device_id uuid, device_name text, site_id uuid, alarm_id uuid)
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
    -- Handle devices that ARE reporting (resolve alarms)
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
            sd.connection_alarm_enabled,
            lr.timestamp as last_reading
        FROM public.site_devices sd
        LEFT JOIN latest_readings lr ON lr.device_id = sd.id
        WHERE sd.enabled = true
          AND lr.timestamp IS NOT NULL
          AND now() - lr.timestamp <= (p_timeout_seconds || ' seconds')::INTERVAL
    LOOP
        UPDATE public.site_devices
        SET is_online = true, last_seen = v_device.last_reading
        WHERE id = v_device.id;

        IF v_device.connection_alarm_enabled THEN
            -- Resolve by device_id (with name fallback for old alarms)
            SELECT public.resolve_not_reporting_alarm(v_device.site_id, v_device.id, v_device.name)
            INTO v_resolved_count;

            IF v_resolved_count > 0 THEN
                action := 'resolved';
                device_id := v_device.id;
                device_name := v_device.name;
                site_id := v_device.site_id;
                alarm_id := NULL;
                RETURN NEXT;
            END IF;
        END IF;
    END LOOP;

    -- Handle devices that are NOT reporting (only enabled)
    FOR v_device IN
        SELECT * FROM public.get_non_reporting_devices(p_timeout_seconds)
    LOOP
        v_controller_online := public.is_site_controller_online(v_device.site_id);

        IF v_controller_online THEN
            UPDATE public.site_devices
            SET is_online = false, last_seen = v_device.last_reading
            WHERE id = v_device.device_id;

            IF v_device.alarm_enabled THEN
                SELECT public.create_not_reporting_alarm(v_device.site_id, v_device.device_id, v_device.device_name)
                INTO v_alarm_id;

                IF v_alarm_id IS NOT NULL THEN
                    action := 'alarm_created';
                ELSE
                    action := 'alarm_exists';
                END IF;
            ELSE
                action := 'offline_no_alarm';
            END IF;

            device_id := v_device.device_id;
            device_name := v_device.device_name;
            site_id := v_device.site_id;
            alarm_id := v_alarm_id;
            RETURN NEXT;
        ELSE
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

-- =============================================================================
-- 6. Grant permissions
-- =============================================================================
GRANT EXECUTE ON FUNCTION public.resolve_not_reporting_alarm(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_not_reporting_alarm(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_device_connection_status(INT) TO service_role;
