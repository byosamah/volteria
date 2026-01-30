-- Migration 093: Fix SECURITY DEFINER Functions Search Path
-- Purpose: Add SET search_path = '' to all SECURITY DEFINER functions
-- This prevents search path injection attacks (Supabase Security Advisor warning)
-- Date: 2026-01-30

-- ============================================
-- 1. get_or_create_notification_preferences (022_notification_preferences.sql)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_or_create_notification_preferences(p_user_id UUID)
RETURNS public.notification_preferences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  prefs public.notification_preferences;
BEGIN
  -- Try to get existing preferences
  SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = p_user_id;

  -- If not found, create default preferences
  IF NOT FOUND THEN
    INSERT INTO public.notification_preferences (user_id)
    VALUES (p_user_id)
    RETURNING * INTO prefs;
  END IF;

  RETURN prefs;
END;
$$;

-- ============================================
-- 2. set_command_executed_by (023_control_commands.sql)
-- ============================================
CREATE OR REPLACE FUNCTION public.set_command_executed_by()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Set executed_by to current authenticated user if not already set
  IF NEW.executed_by IS NULL THEN
    NEW.executed_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================
-- 3. get_enterprise_package_limits (039_usage_packages.sql)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_enterprise_package_limits(p_enterprise_id UUID)
RETURNS TABLE (
  package_name VARCHAR,
  storage_limit_bytes BIGINT,
  bandwidth_limit_bytes BIGINT,
  max_sites INTEGER,
  max_controllers INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    up.name,
    up.storage_limit_bytes,
    up.bandwidth_limit_bytes,
    up.max_sites,
    up.max_controllers
  FROM public.enterprises e
  LEFT JOIN public.usage_packages up ON e.usage_package_id = up.id
  WHERE e.id = p_enterprise_id;
END;
$$;

-- ============================================
-- 4. calculate_enterprise_storage (040_usage_snapshots.sql)
-- ============================================
CREATE OR REPLACE FUNCTION public.calculate_enterprise_storage(p_enterprise_id UUID)
RETURNS TABLE (
  control_logs_bytes BIGINT,
  control_logs_rows BIGINT,
  alarms_bytes BIGINT,
  alarms_rows BIGINT,
  heartbeats_bytes BIGINT,
  heartbeats_rows BIGINT,
  audit_logs_bytes BIGINT,
  audit_logs_rows BIGINT,
  total_storage_bytes BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  avg_log_row_size BIGINT := 200;
  avg_alarm_row_size BIGINT := 500;
  avg_heartbeat_row_size BIGINT := 150;
  avg_audit_row_size BIGINT := 400;
BEGIN
  RETURN QUERY
  WITH project_ids AS (
    SELECT p.id
    FROM public.projects p
    WHERE p.enterprise_id = p_enterprise_id
  ),
  controller_ids AS (
    SELECT c.id
    FROM public.controllers c
    WHERE c.enterprise_id = p_enterprise_id
  ),
  user_ids AS (
    SELECT u.id
    FROM public.users u
    WHERE u.enterprise_id = p_enterprise_id
  ),
  log_stats AS (
    SELECT
      COUNT(*) as row_count,
      COUNT(*) * avg_log_row_size as byte_estimate
    FROM public.control_logs cl
    WHERE cl.project_id IN (SELECT id FROM project_ids)
  ),
  alarm_stats AS (
    SELECT
      COUNT(*) as row_count,
      COUNT(*) * avg_alarm_row_size as byte_estimate
    FROM public.alarms a
    WHERE a.project_id IN (SELECT id FROM project_ids)
  ),
  heartbeat_stats AS (
    SELECT
      COUNT(*) as row_count,
      COUNT(*) * avg_heartbeat_row_size as byte_estimate
    FROM public.controller_heartbeats ch
    WHERE ch.controller_id IN (SELECT id FROM controller_ids)
  ),
  audit_stats AS (
    SELECT
      COUNT(*) as row_count,
      COUNT(*) * avg_audit_row_size as byte_estimate
    FROM public.audit_logs al
    WHERE al.user_id IN (SELECT id FROM user_ids)
  )
  SELECT
    COALESCE(l.byte_estimate, 0)::BIGINT as control_logs_bytes,
    COALESCE(l.row_count, 0)::BIGINT as control_logs_rows,
    COALESCE(a.byte_estimate, 0)::BIGINT as alarms_bytes,
    COALESCE(a.row_count, 0)::BIGINT as alarms_rows,
    COALESCE(h.byte_estimate, 0)::BIGINT as heartbeats_bytes,
    COALESCE(h.row_count, 0)::BIGINT as heartbeats_rows,
    COALESCE(au.byte_estimate, 0)::BIGINT as audit_logs_bytes,
    COALESCE(au.row_count, 0)::BIGINT as audit_logs_rows,
    (COALESCE(l.byte_estimate, 0) + COALESCE(a.byte_estimate, 0) +
     COALESCE(h.byte_estimate, 0) + COALESCE(au.byte_estimate, 0))::BIGINT as total_storage_bytes
  FROM log_stats l, alarm_stats a, heartbeat_stats h, audit_stats au;
END;
$$;

-- ============================================
-- 5. create_usage_snapshot (040_usage_snapshots.sql)
-- ============================================
CREATE OR REPLACE FUNCTION public.create_usage_snapshot(p_enterprise_id UUID, p_date DATE DEFAULT CURRENT_DATE)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_snapshot_id UUID;
  v_storage RECORD;
  v_package RECORD;
  v_sites_count INTEGER;
  v_controllers_count INTEGER;
  v_users_count INTEGER;
  v_devices_count INTEGER;
  v_usage_percent DECIMAL(5,2);
BEGIN
  -- Get storage stats
  SELECT * INTO v_storage FROM public.calculate_enterprise_storage(p_enterprise_id);

  -- Get package info
  SELECT
    up.id as package_id,
    up.name as package_name,
    up.storage_limit_bytes
  INTO v_package
  FROM public.enterprises e
  LEFT JOIN public.usage_packages up ON e.usage_package_id = up.id
  WHERE e.id = p_enterprise_id;

  -- Count resources
  SELECT COUNT(*) INTO v_sites_count
  FROM public.sites s
  JOIN public.projects p ON s.project_id = p.id
  WHERE p.enterprise_id = p_enterprise_id;

  SELECT COUNT(*) INTO v_controllers_count
  FROM public.controllers c
  WHERE c.enterprise_id = p_enterprise_id;

  SELECT COUNT(*) INTO v_users_count
  FROM public.users u
  WHERE u.enterprise_id = p_enterprise_id;

  SELECT COUNT(*) INTO v_devices_count
  FROM public.site_devices pd
  JOIN public.sites s ON pd.site_id = s.id
  JOIN public.projects p ON s.project_id = p.id
  WHERE p.enterprise_id = p_enterprise_id;

  -- Calculate usage percentage
  IF v_package.storage_limit_bytes IS NOT NULL AND v_package.storage_limit_bytes > 0 THEN
    v_usage_percent := (v_storage.total_storage_bytes::DECIMAL / v_package.storage_limit_bytes * 100);
  ELSE
    v_usage_percent := 0;
  END IF;

  -- Upsert snapshot
  INSERT INTO public.enterprise_usage_snapshots (
    enterprise_id,
    snapshot_date,
    control_logs_bytes,
    control_logs_rows,
    alarms_bytes,
    alarms_rows,
    heartbeats_bytes,
    heartbeats_rows,
    audit_logs_bytes,
    audit_logs_rows,
    total_storage_bytes,
    sites_count,
    controllers_count,
    users_count,
    devices_count,
    package_id,
    package_name,
    storage_limit_bytes,
    storage_usage_percent
  ) VALUES (
    p_enterprise_id,
    p_date,
    v_storage.control_logs_bytes,
    v_storage.control_logs_rows,
    v_storage.alarms_bytes,
    v_storage.alarms_rows,
    v_storage.heartbeats_bytes,
    v_storage.heartbeats_rows,
    v_storage.audit_logs_bytes,
    v_storage.audit_logs_rows,
    v_storage.total_storage_bytes,
    v_sites_count,
    v_controllers_count,
    v_users_count,
    v_devices_count,
    v_package.package_id,
    v_package.package_name,
    v_package.storage_limit_bytes,
    v_usage_percent
  )
  ON CONFLICT (enterprise_id, snapshot_date)
  DO UPDATE SET
    control_logs_bytes = EXCLUDED.control_logs_bytes,
    control_logs_rows = EXCLUDED.control_logs_rows,
    alarms_bytes = EXCLUDED.alarms_bytes,
    alarms_rows = EXCLUDED.alarms_rows,
    heartbeats_bytes = EXCLUDED.heartbeats_bytes,
    heartbeats_rows = EXCLUDED.heartbeats_rows,
    audit_logs_bytes = EXCLUDED.audit_logs_bytes,
    audit_logs_rows = EXCLUDED.audit_logs_rows,
    total_storage_bytes = EXCLUDED.total_storage_bytes,
    sites_count = EXCLUDED.sites_count,
    controllers_count = EXCLUDED.controllers_count,
    users_count = EXCLUDED.users_count,
    devices_count = EXCLUDED.devices_count,
    package_id = EXCLUDED.package_id,
    package_name = EXCLUDED.package_name,
    storage_limit_bytes = EXCLUDED.storage_limit_bytes,
    storage_usage_percent = EXCLUDED.storage_usage_percent,
    created_at = NOW()
  RETURNING id INTO v_snapshot_id;

  RETURN v_snapshot_id;
END;
$$;

-- ============================================
-- 6. create_all_usage_snapshots (040_usage_snapshots.sql)
-- ============================================
CREATE OR REPLACE FUNCTION public.create_all_usage_snapshots(p_date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enterprise RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_enterprise IN SELECT id FROM public.enterprises WHERE is_active = true LOOP
    PERFORM public.create_usage_snapshot(v_enterprise.id, p_date);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================
-- 7. get_daily_bandwidth (041_api_request_logs.sql)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_daily_bandwidth(
  p_enterprise_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  log_date DATE,
  request_count BIGINT,
  total_bytes BIGINT,
  avg_duration_ms NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE(arl.timestamp) as log_date,
    COUNT(*)::BIGINT as request_count,
    (COALESCE(SUM(arl.request_bytes), 0) + COALESCE(SUM(arl.response_bytes), 0))::BIGINT as total_bytes,
    AVG(arl.duration_ms) as avg_duration_ms
  FROM public.api_request_logs arl
  WHERE arl.enterprise_id = p_enterprise_id
    AND DATE(arl.timestamp) BETWEEN p_start_date AND p_end_date
  GROUP BY DATE(arl.timestamp)
  ORDER BY log_date DESC;
END;
$$;

-- ============================================
-- 8. purge_old_api_logs (041_api_request_logs.sql)
-- ============================================
CREATE OR REPLACE FUNCTION public.purge_old_api_logs(p_days_to_keep INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.api_request_logs
  WHERE timestamp < NOW() - (p_days_to_keep || ' days')::INTERVAL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ============================================
-- 9. aggregate_control_logs_to_hourly (042_data_retention.sql)
-- ============================================
CREATE OR REPLACE FUNCTION public.aggregate_control_logs_to_hourly(
  p_enterprise_id UUID,
  p_older_than_days INTEGER DEFAULT 90
)
RETURNS TABLE (
  records_aggregated INTEGER,
  records_deleted INTEGER,
  bytes_estimated_freed BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_aggregated INTEGER := 0;
  v_deleted INTEGER := 0;
  v_bytes_freed BIGINT := 0;
  v_cutoff TIMESTAMPTZ;
  v_avg_row_size BIGINT := 200;
BEGIN
  v_cutoff := NOW() - (p_older_than_days || ' days')::INTERVAL;

  -- Step 1: Create hourly aggregates
  INSERT INTO public.control_logs_hourly (
    project_id,
    site_id,
    device_id,
    hour_start,
    register_name,
    register_address,
    avg_value,
    min_value,
    max_value,
    sum_value,
    sample_count
  )
  SELECT
    cl.project_id,
    cl.site_id,
    cl.device_id,
    date_trunc('hour', cl.timestamp) as hour_start,
    cl.register_name,
    cl.register_address,
    AVG(cl.value) as avg_value,
    MIN(cl.value) as min_value,
    MAX(cl.value) as max_value,
    SUM(cl.value) as sum_value,
    COUNT(*) as sample_count
  FROM public.control_logs cl
  JOIN public.projects p ON cl.project_id = p.id
  WHERE p.enterprise_id = p_enterprise_id
    AND cl.timestamp < v_cutoff
  GROUP BY
    cl.project_id,
    cl.site_id,
    cl.device_id,
    date_trunc('hour', cl.timestamp),
    cl.register_name,
    cl.register_address
  ON CONFLICT (project_id, device_id, register_address, hour_start)
  DO UPDATE SET
    avg_value = EXCLUDED.avg_value,
    min_value = LEAST(public.control_logs_hourly.min_value, EXCLUDED.min_value),
    max_value = GREATEST(public.control_logs_hourly.max_value, EXCLUDED.max_value),
    sum_value = public.control_logs_hourly.sum_value + EXCLUDED.sum_value,
    sample_count = public.control_logs_hourly.sample_count + EXCLUDED.sample_count;

  GET DIAGNOSTICS v_aggregated = ROW_COUNT;

  -- Step 2: Delete original detailed logs
  WITH deleted AS (
    DELETE FROM public.control_logs cl
    USING public.projects p
    WHERE cl.project_id = p.id
      AND p.enterprise_id = p_enterprise_id
      AND cl.timestamp < v_cutoff
    RETURNING cl.id
  )
  SELECT COUNT(*) INTO v_deleted FROM deleted;

  -- Estimate bytes freed
  v_bytes_freed := v_deleted * v_avg_row_size;

  -- Return results
  RETURN QUERY SELECT v_aggregated, v_deleted, v_bytes_freed;
END;
$$;

-- ============================================
-- 10. delete_oldest_control_logs (042_data_retention.sql)
-- ============================================
CREATE OR REPLACE FUNCTION public.delete_oldest_control_logs(
  p_enterprise_id UUID,
  p_target_percent DECIMAL DEFAULT 90,
  p_batch_size INTEGER DEFAULT 10000
)
RETURNS TABLE (
  records_deleted INTEGER,
  bytes_estimated_freed BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted INTEGER := 0;
  v_bytes_freed BIGINT := 0;
  v_current_bytes BIGINT;
  v_limit_bytes BIGINT;
  v_target_bytes BIGINT;
  v_to_delete BIGINT;
  v_avg_row_size BIGINT := 200;
BEGIN
  -- Get current usage and limit
  SELECT
    eus.total_storage_bytes,
    up.storage_limit_bytes
  INTO v_current_bytes, v_limit_bytes
  FROM public.enterprise_usage_snapshots eus
  JOIN public.enterprises e ON eus.enterprise_id = e.id
  LEFT JOIN public.usage_packages up ON e.usage_package_id = up.id
  WHERE eus.enterprise_id = p_enterprise_id
  ORDER BY eus.snapshot_date DESC
  LIMIT 1;

  -- Calculate target
  v_target_bytes := (v_limit_bytes * p_target_percent / 100);
  v_to_delete := v_current_bytes - v_target_bytes;

  IF v_to_delete <= 0 THEN
    RETURN QUERY SELECT 0, 0::BIGINT;
    RETURN;
  END IF;

  -- Delete oldest logs in batches
  WITH deleted AS (
    DELETE FROM public.control_logs
    WHERE id IN (
      SELECT cl.id
      FROM public.control_logs cl
      JOIN public.projects p ON cl.project_id = p.id
      WHERE p.enterprise_id = p_enterprise_id
      ORDER BY cl.timestamp ASC
      LIMIT LEAST(p_batch_size, (v_to_delete / v_avg_row_size)::INTEGER)
    )
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted FROM deleted;

  v_bytes_freed := v_deleted * v_avg_row_size;

  RETURN QUERY SELECT v_deleted, v_bytes_freed;
END;
$$;

-- ============================================
-- 11. get_or_create_retention_settings (042_data_retention.sql)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_or_create_retention_settings(p_enterprise_id UUID)
RETURNS public.enterprise_data_retention
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_settings public.enterprise_data_retention;
BEGIN
  -- Try to get existing settings
  SELECT * INTO v_settings
  FROM public.enterprise_data_retention
  WHERE enterprise_id = p_enterprise_id;

  -- If not found, create default settings
  IF v_settings IS NULL THEN
    INSERT INTO public.enterprise_data_retention (enterprise_id)
    VALUES (p_enterprise_id)
    RETURNING * INTO v_settings;
  END IF;

  RETURN v_settings;
END;
$$;

-- ============================================
-- 12. fn_audit_device_template (066_template_audit_log.sql)
-- ============================================
CREATE OR REPLACE FUNCTION public.fn_audit_device_template()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_changed_fields TEXT[];
    v_old_values JSONB;
    v_new_values JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.template_audit_log (
            template_type,
            template_id,
            template_name,
            action,
            new_values,
            changed_fields
        ) VALUES (
            'device_template',
            NEW.id,
            NEW.name,
            'create',
            to_jsonb(NEW),
            ARRAY['all']
        );
        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
        v_changed_fields := ARRAY[]::TEXT[];

        IF OLD.name IS DISTINCT FROM NEW.name THEN
            v_changed_fields := array_append(v_changed_fields, 'name');
        END IF;
        IF OLD.device_type IS DISTINCT FROM NEW.device_type THEN
            v_changed_fields := array_append(v_changed_fields, 'device_type');
        END IF;
        IF OLD.brand IS DISTINCT FROM NEW.brand THEN
            v_changed_fields := array_append(v_changed_fields, 'brand');
        END IF;
        IF OLD.model IS DISTINCT FROM NEW.model THEN
            v_changed_fields := array_append(v_changed_fields, 'model');
        END IF;
        IF OLD.registers IS DISTINCT FROM NEW.registers THEN
            v_changed_fields := array_append(v_changed_fields, 'registers');
        END IF;
        IF OLD.alarm_definitions IS DISTINCT FROM NEW.alarm_definitions THEN
            v_changed_fields := array_append(v_changed_fields, 'alarm_definitions');
        END IF;
        IF OLD.rated_power_kw IS DISTINCT FROM NEW.rated_power_kw THEN
            v_changed_fields := array_append(v_changed_fields, 'rated_power_kw');
        END IF;

        IF array_length(v_changed_fields, 1) > 0 THEN
            INSERT INTO public.template_audit_log (
                template_type,
                template_id,
                template_name,
                action,
                old_values,
                new_values,
                changed_fields
            ) VALUES (
                'device_template',
                NEW.id,
                NEW.name,
                'update',
                to_jsonb(OLD),
                to_jsonb(NEW),
                v_changed_fields
            );
        END IF;
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.template_audit_log (
            template_type,
            template_id,
            template_name,
            action,
            old_values,
            changed_fields
        ) VALUES (
            'device_template',
            OLD.id,
            OLD.name,
            'delete',
            to_jsonb(OLD),
            ARRAY['all']
        );
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;

-- ============================================
-- 13. fn_audit_controller_template (066_template_audit_log.sql)
-- ============================================
CREATE OR REPLACE FUNCTION public.fn_audit_controller_template()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_changed_fields TEXT[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.template_audit_log (
            template_type,
            template_id,
            template_name,
            action,
            new_values,
            changed_fields
        ) VALUES (
            'controller_template',
            NEW.id,
            NEW.name,
            'create',
            to_jsonb(NEW),
            ARRAY['all']
        );
        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
        v_changed_fields := ARRAY[]::TEXT[];

        IF OLD.name IS DISTINCT FROM NEW.name THEN
            v_changed_fields := array_append(v_changed_fields, 'name');
        END IF;
        IF OLD.controller_type IS DISTINCT FROM NEW.controller_type THEN
            v_changed_fields := array_append(v_changed_fields, 'controller_type');
        END IF;
        IF OLD.registers IS DISTINCT FROM NEW.registers THEN
            v_changed_fields := array_append(v_changed_fields, 'registers');
        END IF;
        IF OLD.alarm_definitions IS DISTINCT FROM NEW.alarm_definitions THEN
            v_changed_fields := array_append(v_changed_fields, 'alarm_definitions');
        END IF;
        IF OLD.calculated_fields IS DISTINCT FROM NEW.calculated_fields THEN
            v_changed_fields := array_append(v_changed_fields, 'calculated_fields');
        END IF;

        IF array_length(v_changed_fields, 1) > 0 THEN
            INSERT INTO public.template_audit_log (
                template_type,
                template_id,
                template_name,
                action,
                old_values,
                new_values,
                changed_fields
            ) VALUES (
                'controller_template',
                NEW.id,
                NEW.name,
                'update',
                to_jsonb(OLD),
                to_jsonb(NEW),
                v_changed_fields
            );
        END IF;
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.template_audit_log (
            template_type,
            template_id,
            template_name,
            action,
            old_values,
            changed_fields
        ) VALUES (
            'controller_template',
            OLD.id,
            OLD.name,
            'delete',
            to_jsonb(OLD),
            ARRAY['all']
        );
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;

-- ============================================
-- 14. log_audit_action (024_audit_logs.sql)
-- ============================================
CREATE OR REPLACE FUNCTION public.log_audit_action(
  p_user_id UUID,
  p_user_email VARCHAR,
  p_user_role VARCHAR,
  p_action VARCHAR,
  p_action_category VARCHAR,
  p_resource_type VARCHAR DEFAULT NULL,
  p_resource_id UUID DEFAULT NULL,
  p_resource_name VARCHAR DEFAULT NULL,
  p_old_value JSONB DEFAULT NULL,
  p_new_value JSONB DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL,
  p_status VARCHAR DEFAULT 'success',
  p_error_message TEXT DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO public.audit_logs (
    user_id,
    user_email,
    user_role,
    action,
    action_category,
    resource_type,
    resource_id,
    resource_name,
    old_value,
    new_value,
    metadata,
    status,
    error_message,
    ip_address,
    user_agent
  ) VALUES (
    p_user_id,
    p_user_email,
    p_user_role,
    p_action,
    p_action_category,
    p_resource_type,
    p_resource_id,
    p_resource_name,
    p_old_value,
    p_new_value,
    p_metadata,
    p_status,
    p_error_message,
    p_ip_address,
    p_user_agent
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- ============================================
-- VERIFICATION
-- ============================================
-- Run this query after migration to verify all SECURITY DEFINER functions have search_path set:
--
-- SELECT
--   n.nspname AS schema,
--   p.proname AS function_name,
--   p.prosecdef AS security_definer,
--   p.proconfig AS config
-- FROM pg_proc p
-- JOIN pg_namespace n ON p.pronamespace = n.oid
-- WHERE n.nspname = 'public'
--   AND p.prosecdef = true
-- ORDER BY p.proname;
