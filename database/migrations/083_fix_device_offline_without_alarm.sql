-- Fix: Device should go offline even if connection_alarm_enabled = false
-- Only the alarm creation should be conditional
-- Applied: 2026-01-21

-- Drop and recreate with new signature (includes alarm_enabled flag)
DROP FUNCTION IF EXISTS public.get_non_reporting_devices(integer);

-- Return ALL devices that stopped reporting (with alarm_enabled flag)
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
    WHERE now() - lr.timestamp > (timeout_seconds || ' seconds')::INTERVAL;
$function$;

-- Update main function to only create alarm if enabled
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
        WHERE lr.timestamp IS NOT NULL
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

    -- Then, handle devices that are NOT reporting (ALL devices, not just alarm-enabled)
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

-- Also create migration for the site_devices trigger fix
-- (This was applied earlier to prevent false config sync warnings)
CREATE OR REPLACE FUNCTION public.update_site_devices_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
    -- Only update updated_at if CONFIG fields changed (not operational fields)
    -- Operational fields that should NOT trigger updated_at:
    --   is_online, last_seen, last_error
    IF (
        OLD.template_id IS DISTINCT FROM NEW.template_id OR
        OLD.name IS DISTINCT FROM NEW.name OR
        OLD.protocol IS DISTINCT FROM NEW.protocol OR
        OLD.ip_address IS DISTINCT FROM NEW.ip_address OR
        OLD.port IS DISTINCT FROM NEW.port OR
        OLD.gateway_ip IS DISTINCT FROM NEW.gateway_ip OR
        OLD.gateway_port IS DISTINCT FROM NEW.gateway_port OR
        OLD.serial_port IS DISTINCT FROM NEW.serial_port OR
        OLD.baudrate IS DISTINCT FROM NEW.baudrate OR
        OLD.slave_id IS DISTINCT FROM NEW.slave_id OR
        OLD.rated_power_kw IS DISTINCT FROM NEW.rated_power_kw OR
        OLD.rated_power_kva IS DISTINCT FROM NEW.rated_power_kva OR
        OLD.enabled IS DISTINCT FROM NEW.enabled OR
        OLD.logging_registers IS DISTINCT FROM NEW.logging_registers OR
        OLD.logging_interval_ms IS DISTINCT FROM NEW.logging_interval_ms OR
        OLD.device_type IS DISTINCT FROM NEW.device_type OR
        OLD.alarm_registers IS DISTINCT FROM NEW.alarm_registers OR
        OLD.visualization_registers IS DISTINCT FROM NEW.visualization_registers OR
        OLD.registers IS DISTINCT FROM NEW.registers OR
        OLD.calculated_fields IS DISTINCT FROM NEW.calculated_fields OR
        OLD.connection_alarm_enabled IS DISTINCT FROM NEW.connection_alarm_enabled
    ) THEN
        NEW.updated_at = NOW();
    ELSE
        -- Keep old updated_at for operational-only changes
        NEW.updated_at = OLD.updated_at;
    END IF;
    RETURN NEW;
END;
$function$;

-- Replace the trigger to use the new function
DROP TRIGGER IF EXISTS update_project_devices_updated_at ON public.site_devices;
DROP TRIGGER IF EXISTS update_site_devices_config_updated_at ON public.site_devices;

CREATE TRIGGER update_site_devices_config_updated_at
BEFORE UPDATE ON public.site_devices
FOR EACH ROW
EXECUTE FUNCTION public.update_site_devices_updated_at();
