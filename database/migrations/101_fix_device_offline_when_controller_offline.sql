-- Fix: Devices stay "Online" when controller goes offline
-- Root cause: ELSE branch in check_device_connection_status() skipped the
-- UPDATE site_devices SET is_online = false when controller was offline.
-- Devices can't report data without their controller, so they should be marked offline.
-- Applied: 2026-02-20

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
            -- Controller offline - still mark device offline, but don't alarm
            -- (controller_offline alarm handles the root cause separately)
            UPDATE public.site_devices
            SET is_online = false, last_seen = v_device.last_reading
            WHERE id = v_device.device_id;

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
