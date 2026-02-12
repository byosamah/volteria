-- Fix: Disabled devices (enabled=false) should not trigger "Not Reporting" alarms
-- Root cause: get_non_reporting_devices() and the online check in check_device_connection_status()
-- had no filter on sd.enabled, so disabled devices with stale readings triggered alarms indefinitely
-- Applied: 2026-02-12

-- Drop and recreate with enabled filter
DROP FUNCTION IF EXISTS public.get_non_reporting_devices(integer);

CREATE OR REPLACE FUNCTION public.get_non_reporting_devices(timeout_seconds integer DEFAULT 600)
RETURNS TABLE(device_id uuid, device_name text, site_id uuid, project_id uuid, last_reading timestamp with time zone, seconds_since_last integer, alarm_enabled boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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
        EXTRACT(EPOCH FROM (now() - lr.timestamp))::INT,
        sd.connection_alarm_enabled
    FROM public.site_devices sd
    JOIN public.sites s ON s.id = sd.site_id
    JOIN latest_readings lr ON lr.device_id = sd.id
    WHERE sd.enabled = true
      AND now() - lr.timestamp > (timeout_seconds || ' seconds')::INTERVAL;
$function$;

-- Also update check_device_connection_status to skip disabled devices in the "online" loop
CREATE OR REPLACE FUNCTION public.check_device_connection_status(p_timeout_seconds integer DEFAULT 600)
RETURNS TABLE(action text, device_id uuid, device_name text, site_id uuid, alarm_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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
            sd.connection_alarm_enabled,
            lr.timestamp as last_reading
        FROM public.site_devices sd
        LEFT JOIN latest_readings lr ON lr.device_id = sd.id
        WHERE sd.enabled = true
          AND lr.timestamp IS NOT NULL
          AND now() - lr.timestamp <= (p_timeout_seconds || ' seconds')::INTERVAL
    LOOP
        -- Update device status to online
        UPDATE public.site_devices
        SET is_online = true, last_seen = v_device.last_reading
        WHERE id = v_device.id;

        -- Only resolve alarm if alarm was enabled for this device
        IF v_device.connection_alarm_enabled THEN
            SELECT public.resolve_not_reporting_alarm(v_device.site_id, v_device.name) INTO v_resolved_count;

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

    -- Then, handle devices that are NOT reporting (only enabled devices)
    FOR v_device IN
        SELECT * FROM public.get_non_reporting_devices(p_timeout_seconds)
    LOOP
        -- Check if controller is online for this site
        v_controller_online := public.is_site_controller_online(v_device.site_id);

        IF v_controller_online THEN
            -- Controller is online but device not reporting - update status
            UPDATE public.site_devices
            SET is_online = false, last_seen = v_device.last_reading
            WHERE id = v_device.device_id;

            -- Only create alarm if connection_alarm_enabled
            IF v_device.alarm_enabled THEN
                SELECT public.create_not_reporting_alarm(v_device.site_id, v_device.device_id, v_device.device_name)
                INTO v_alarm_id;

                IF v_alarm_id IS NOT NULL THEN
                    action := 'alarm_created';
                ELSE
                    action := 'alarm_exists';
                END IF;
            ELSE
                -- Device went offline but alarm disabled
                action := 'offline_no_alarm';
            END IF;

            device_id := v_device.device_id;
            device_name := v_device.device_name;
            site_id := v_device.site_id;
            alarm_id := v_alarm_id;
            RETURN NEXT;
        ELSE
            -- Controller offline - don't alarm individual devices
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
$function$;
