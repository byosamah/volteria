-- Migration 091: Update create_not_reporting_alarm to use device severity
-- Purpose: Read connection_alarm_severity from site_devices instead of hardcoding 'warning'

-- =============================================================================
-- 1. Update create_not_reporting_alarm function
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
    v_severity TEXT;
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

    -- Get device's configured severity (default to 'warning' for backwards compatibility)
    SELECT COALESCE(connection_alarm_severity, 'warning') INTO v_severity
    FROM public.site_devices
    WHERE id = p_device_id;

    -- Fallback if device not found
    IF v_severity IS NULL THEN
        v_severity := 'warning';
    END IF;

    -- Create new alarm with device-specific severity
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
        v_severity,
        false,
        false,
        now()
    )
    RETURNING id INTO v_alarm_id;

    RETURN v_alarm_id;
END;
$$;

-- Grant execute permissions to service role
GRANT EXECUTE ON FUNCTION create_not_reporting_alarm(UUID, UUID, TEXT) TO service_role;
