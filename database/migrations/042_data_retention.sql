-- Migration 042: Enterprise Data Retention Settings
-- PHASE 6 - Billing & Storage Management
--
-- Manages data retention policies per enterprise.
-- When storage limit is exceeded for 30 days with 10%+ overage:
-- - Option A: Aggregate minute-level data to hourly (default)
-- - Option B: Delete oldest data
--
-- Features:
-- - Per-enterprise retention settings
-- - Automatic cleanup scheduling
-- - Aggregation to reduce storage without losing trends

-- ================================================================
-- STEP 1: Create enterprise_data_retention table
-- ================================================================

CREATE TABLE IF NOT EXISTS enterprise_data_retention (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which enterprise
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,

  -- ============================================
  -- Retention settings
  -- ============================================

  -- How long to keep detailed data (in days)
  retention_days INTEGER NOT NULL DEFAULT 365,

  -- When auto-cleanup kicks in after grace period expires
  auto_cleanup_enabled BOOLEAN NOT NULL DEFAULT false,

  -- What to do when cleaning up:
  -- 'aggregate': Convert minute data to hourly averages (default, preserves trends)
  -- 'delete': Delete oldest data entirely (more aggressive)
  cleanup_strategy VARCHAR(20) NOT NULL DEFAULT 'aggregate',

  -- Age threshold for data to be aggregated/deleted (days)
  cleanup_threshold_days INTEGER NOT NULL DEFAULT 90,

  -- ============================================
  -- Cleanup tracking
  -- ============================================

  -- When was the last cleanup run
  last_cleanup_at TIMESTAMPTZ,

  -- How many records were affected
  last_cleanup_records_affected INTEGER,

  -- How many bytes were freed
  last_cleanup_bytes_freed BIGINT,

  -- Next scheduled cleanup (NULL if not scheduled)
  next_cleanup_at TIMESTAMPTZ,

  -- ============================================
  -- Timestamps
  -- ============================================

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one setting per enterprise
ALTER TABLE enterprise_data_retention
  DROP CONSTRAINT IF EXISTS unique_enterprise_retention;

ALTER TABLE enterprise_data_retention
  ADD CONSTRAINT unique_enterprise_retention
  UNIQUE (enterprise_id);

-- ================================================================
-- STEP 2: Create control_logs_hourly table for aggregated data
-- ================================================================

CREATE TABLE IF NOT EXISTS control_logs_hourly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  device_id UUID REFERENCES project_devices(id) ON DELETE SET NULL,

  -- Time bucket (hour start)
  hour_start TIMESTAMPTZ NOT NULL,

  -- Register/measurement identification
  register_name VARCHAR(100),
  register_address INTEGER,

  -- Aggregated values
  avg_value DECIMAL(20,6),
  min_value DECIMAL(20,6),
  max_value DECIMAL(20,6),
  sum_value DECIMAL(20,6),
  sample_count INTEGER NOT NULL DEFAULT 0,

  -- When this aggregate was created
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one aggregate per hour per register
ALTER TABLE control_logs_hourly
  DROP CONSTRAINT IF EXISTS unique_hourly_aggregate;

ALTER TABLE control_logs_hourly
  ADD CONSTRAINT unique_hourly_aggregate
  UNIQUE (project_id, device_id, register_address, hour_start);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hourly_logs_project_time
  ON control_logs_hourly(project_id, hour_start DESC);

CREATE INDEX IF NOT EXISTS idx_hourly_logs_site_time
  ON control_logs_hourly(site_id, hour_start DESC);

-- ================================================================
-- STEP 3: Enable RLS
-- ================================================================

ALTER TABLE enterprise_data_retention ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_logs_hourly ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Admins can view own enterprise retention" ON enterprise_data_retention;
DROP POLICY IF EXISTS "Super admins can manage all retention" ON enterprise_data_retention;
DROP POLICY IF EXISTS "Users can view hourly logs for their projects" ON control_logs_hourly;

-- Enterprise admins can view their own settings
CREATE POLICY "Admins can view own enterprise retention"
  ON enterprise_data_retention
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.enterprise_id = enterprise_data_retention.enterprise_id
      AND u.role IN ('enterprise_admin', 'admin')
    )
  );

-- Super admins can do everything
CREATE POLICY "Super admins can manage all retention"
  ON enterprise_data_retention
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('super_admin', 'backend_admin')
    )
  );

-- Users can view hourly logs for projects they have access to
CREATE POLICY "Users can view hourly logs for their projects"
  ON control_logs_hourly
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_projects up
      WHERE up.project_id = control_logs_hourly.project_id
      AND up.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('super_admin', 'backend_admin')
    )
  );

-- ================================================================
-- STEP 4: Function to aggregate logs to hourly
-- ================================================================

CREATE OR REPLACE FUNCTION aggregate_control_logs_to_hourly(
  p_enterprise_id UUID,
  p_older_than_days INTEGER DEFAULT 90
)
RETURNS TABLE (
  records_aggregated INTEGER,
  records_deleted INTEGER,
  bytes_estimated_freed BIGINT
) AS $$
DECLARE
  v_aggregated INTEGER := 0;
  v_deleted INTEGER := 0;
  v_bytes_freed BIGINT := 0;
  v_cutoff TIMESTAMPTZ;
  v_avg_row_size BIGINT := 200; -- Estimated bytes per row
BEGIN
  v_cutoff := NOW() - (p_older_than_days || ' days')::INTERVAL;

  -- Step 1: Create hourly aggregates
  INSERT INTO control_logs_hourly (
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
  FROM control_logs cl
  JOIN projects p ON cl.project_id = p.id
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
    min_value = LEAST(control_logs_hourly.min_value, EXCLUDED.min_value),
    max_value = GREATEST(control_logs_hourly.max_value, EXCLUDED.max_value),
    sum_value = control_logs_hourly.sum_value + EXCLUDED.sum_value,
    sample_count = control_logs_hourly.sample_count + EXCLUDED.sample_count;

  GET DIAGNOSTICS v_aggregated = ROW_COUNT;

  -- Step 2: Delete original detailed logs
  WITH deleted AS (
    DELETE FROM control_logs cl
    USING projects p
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- STEP 5: Function to delete oldest logs (alternative strategy)
-- ================================================================

CREATE OR REPLACE FUNCTION delete_oldest_control_logs(
  p_enterprise_id UUID,
  p_target_percent DECIMAL DEFAULT 90, -- Reduce to 90% of limit
  p_batch_size INTEGER DEFAULT 10000
)
RETURNS TABLE (
  records_deleted INTEGER,
  bytes_estimated_freed BIGINT
) AS $$
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
  FROM enterprise_usage_snapshots eus
  JOIN enterprises e ON eus.enterprise_id = e.id
  LEFT JOIN usage_packages up ON e.usage_package_id = up.id
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
    DELETE FROM control_logs
    WHERE id IN (
      SELECT cl.id
      FROM control_logs cl
      JOIN projects p ON cl.project_id = p.id
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- STEP 6: Trigger for updated_at
-- ================================================================

CREATE OR REPLACE FUNCTION update_data_retention_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_data_retention_updated_at ON enterprise_data_retention;

CREATE TRIGGER trigger_data_retention_updated_at
  BEFORE UPDATE ON enterprise_data_retention
  FOR EACH ROW
  EXECUTE FUNCTION update_data_retention_updated_at();

-- ================================================================
-- STEP 7: Function to get or create retention settings
-- ================================================================

CREATE OR REPLACE FUNCTION get_or_create_retention_settings(p_enterprise_id UUID)
RETURNS enterprise_data_retention AS $$
DECLARE
  v_settings enterprise_data_retention;
BEGIN
  -- Try to get existing settings
  SELECT * INTO v_settings
  FROM enterprise_data_retention
  WHERE enterprise_id = p_enterprise_id;

  -- If not found, create default settings
  IF v_settings IS NULL THEN
    INSERT INTO enterprise_data_retention (enterprise_id)
    VALUES (p_enterprise_id)
    RETURNING * INTO v_settings;
  END IF;

  RETURN v_settings;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- STEP 8: Documentation
-- ================================================================

COMMENT ON TABLE enterprise_data_retention IS 'Per-enterprise data retention and cleanup settings';
COMMENT ON COLUMN enterprise_data_retention.cleanup_strategy IS 'aggregate (default): Convert to hourly, delete: Remove entirely';
COMMENT ON COLUMN enterprise_data_retention.cleanup_threshold_days IS 'Data older than this is eligible for cleanup';
COMMENT ON TABLE control_logs_hourly IS 'Hourly aggregated control logs (created from minute-level data during cleanup)';
COMMENT ON FUNCTION aggregate_control_logs_to_hourly IS 'Aggregates minute-level logs to hourly averages for an enterprise';
COMMENT ON FUNCTION delete_oldest_control_logs IS 'Deletes oldest control logs to reduce storage to target percentage';
