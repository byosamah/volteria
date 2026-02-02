-- =============================================================================
-- Migration 096: Faster Controller Alarm Checks + Mark Devices Offline
-- =============================================================================
-- Changes:
-- 1. Reduce cron interval from 5 minutes to 2 minutes (faster alarm response)
-- 2. When controller goes offline, mark all its devices offline too
--
-- Result:
-- - Alarm delay reduced from 7-8 min to 3-4 min
-- - Devices immediately show offline when controller disconnects
-- =============================================================================

-- =============================================================================
-- 1. Update the function to mark devices offline when controller goes offline
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
    v_device_count INT;
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
            -- NEW: Mark all devices offline when controller goes offline
            UPDATE public.site_devices
            SET is_online = false
            WHERE site_id = v_controller.site_id
              AND is_online = true;

            GET DIAGNOSTICS v_device_count = ROW_COUNT;

            action := 'alarm_created';
            controller_id := v_controller.controller_id;
            controller_name := v_controller.controller_name;
            site_id := v_controller.site_id;
            alarm_id := v_alarm_id;
            RETURN NEXT;

            -- Log device count if any were marked offline
            IF v_device_count > 0 THEN
                RAISE NOTICE 'Marked % devices offline for site %', v_device_count, v_controller.site_id;
            END IF;
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
-- 2. Update cron job to run every 2 minutes instead of 5
-- =============================================================================
-- First unschedule the existing job
SELECT cron.unschedule('check-controller-alarms');

-- Re-schedule with 2-minute interval
SELECT cron.schedule(
    'check-controller-alarms',           -- job name
    '*/2 * * * *',                        -- cron expression: every 2 minutes (was 5)
    $$SELECT * FROM check_controller_connection_status(120)$$  -- 2 min timeout (4 missed heartbeats)
);

-- =============================================================================
-- 3. Grant permissions (ensure they're still valid after function replacement)
-- =============================================================================
GRANT EXECUTE ON FUNCTION check_controller_connection_status(INT) TO service_role;
