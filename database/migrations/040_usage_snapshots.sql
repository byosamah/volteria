-- Migration 040: Enterprise Usage Snapshots
-- PHASE 6 - Billing & Storage Management
--
-- Creates daily snapshots of enterprise storage and bandwidth usage.
-- Snapshots are calculated nightly for fast dashboard queries.
--
-- Benefits:
-- - Fast queries (no expensive real-time calculations)
-- - Historical tracking for trends and charts
-- - Billing accuracy with daily granularity

-- ================================================================
-- STEP 1: Create enterprise_usage_snapshots table
-- ================================================================

CREATE TABLE IF NOT EXISTS enterprise_usage_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which enterprise
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,

  -- When this snapshot was taken
  snapshot_date DATE NOT NULL,

  -- ============================================
  -- Storage metrics (in bytes)
  -- ============================================

  -- Control logs (typically the largest)
  control_logs_bytes BIGINT NOT NULL DEFAULT 0,
  control_logs_rows BIGINT NOT NULL DEFAULT 0,

  -- Alarms
  alarms_bytes BIGINT NOT NULL DEFAULT 0,
  alarms_rows BIGINT NOT NULL DEFAULT 0,

  -- Controller heartbeats
  heartbeats_bytes BIGINT NOT NULL DEFAULT 0,
  heartbeats_rows BIGINT NOT NULL DEFAULT 0,

  -- Audit logs
  audit_logs_bytes BIGINT NOT NULL DEFAULT 0,
  audit_logs_rows BIGINT NOT NULL DEFAULT 0,

  -- Notifications
  notifications_bytes BIGINT NOT NULL DEFAULT 0,
  notifications_rows BIGINT NOT NULL DEFAULT 0,

  -- Total storage (sum of all above)
  total_storage_bytes BIGINT NOT NULL DEFAULT 0,

  -- ============================================
  -- Bandwidth metrics (for the day)
  -- ============================================

  -- API requests count for this day
  api_requests_count BIGINT NOT NULL DEFAULT 0,

  -- Total data transferred (request + response bytes)
  data_transferred_bytes BIGINT NOT NULL DEFAULT 0,

  -- ============================================
  -- Resource counts (point-in-time)
  -- ============================================

  -- Number of active resources at snapshot time
  sites_count INTEGER NOT NULL DEFAULT 0,
  controllers_count INTEGER NOT NULL DEFAULT 0,
  users_count INTEGER NOT NULL DEFAULT 0,
  devices_count INTEGER NOT NULL DEFAULT 0,

  -- ============================================
  -- Package context (for historical reference)
  -- ============================================

  -- Package at time of snapshot (for accurate historical views)
  package_id UUID REFERENCES usage_packages(id),
  package_name VARCHAR(50),
  storage_limit_bytes BIGINT,

  -- Calculated usage percentage
  storage_usage_percent DECIMAL(5,2) DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one snapshot per enterprise per day
ALTER TABLE enterprise_usage_snapshots
  DROP CONSTRAINT IF EXISTS unique_enterprise_snapshot_date;

ALTER TABLE enterprise_usage_snapshots
  ADD CONSTRAINT unique_enterprise_snapshot_date
  UNIQUE (enterprise_id, snapshot_date);

-- ================================================================
-- STEP 2: Create indexes for fast queries
-- ================================================================

-- Primary query pattern: enterprise + date range
CREATE INDEX IF NOT EXISTS idx_usage_snapshots_enterprise_date
  ON enterprise_usage_snapshots(enterprise_id, snapshot_date DESC);

-- For admin dashboard: all enterprises on a date
CREATE INDEX IF NOT EXISTS idx_usage_snapshots_date
  ON enterprise_usage_snapshots(snapshot_date DESC);

-- For warning detection: find enterprises over threshold
CREATE INDEX IF NOT EXISTS idx_usage_snapshots_usage_percent
  ON enterprise_usage_snapshots(snapshot_date DESC, storage_usage_percent DESC)
  WHERE storage_usage_percent >= 80;

-- ================================================================
-- STEP 3: Enable RLS
-- ================================================================

ALTER TABLE enterprise_usage_snapshots ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for re-run safety
DROP POLICY IF EXISTS "Super/backend admins can view all snapshots" ON enterprise_usage_snapshots;
DROP POLICY IF EXISTS "Enterprise admins can view own snapshots" ON enterprise_usage_snapshots;
DROP POLICY IF EXISTS "System can insert snapshots" ON enterprise_usage_snapshots;

-- Super/backend admins can view all
CREATE POLICY "Super/backend admins can view all snapshots"
  ON enterprise_usage_snapshots
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('super_admin', 'backend_admin')
    )
  );

-- Enterprise users can view their own enterprise's snapshots
CREATE POLICY "Enterprise admins can view own snapshots"
  ON enterprise_usage_snapshots
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.enterprise_id = enterprise_usage_snapshots.enterprise_id
      AND u.role IN ('enterprise_admin', 'admin')
    )
  );

-- System can insert (via service key)
CREATE POLICY "System can insert snapshots"
  ON enterprise_usage_snapshots
  FOR INSERT
  WITH CHECK (true);

-- ================================================================
-- STEP 4: Helper function to calculate storage for an enterprise
-- ================================================================

CREATE OR REPLACE FUNCTION calculate_enterprise_storage(p_enterprise_id UUID)
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
) AS $$
DECLARE
  avg_log_row_size BIGINT := 200;       -- Estimated average bytes per control_logs row
  avg_alarm_row_size BIGINT := 500;     -- Estimated average bytes per alarm row
  avg_heartbeat_row_size BIGINT := 150; -- Estimated average bytes per heartbeat row
  avg_audit_row_size BIGINT := 400;     -- Estimated average bytes per audit_log row
BEGIN
  RETURN QUERY
  WITH project_ids AS (
    SELECT p.id
    FROM projects p
    WHERE p.enterprise_id = p_enterprise_id
  ),
  controller_ids AS (
    SELECT c.id
    FROM controllers c
    WHERE c.enterprise_id = p_enterprise_id
  ),
  user_ids AS (
    SELECT u.id
    FROM users u
    WHERE u.enterprise_id = p_enterprise_id
  ),
  log_stats AS (
    SELECT
      COUNT(*) as row_count,
      COUNT(*) * avg_log_row_size as byte_estimate
    FROM control_logs cl
    WHERE cl.project_id IN (SELECT id FROM project_ids)
  ),
  alarm_stats AS (
    SELECT
      COUNT(*) as row_count,
      COUNT(*) * avg_alarm_row_size as byte_estimate
    FROM alarms a
    WHERE a.project_id IN (SELECT id FROM project_ids)
  ),
  heartbeat_stats AS (
    SELECT
      COUNT(*) as row_count,
      COUNT(*) * avg_heartbeat_row_size as byte_estimate
    FROM controller_heartbeats ch
    WHERE ch.controller_id IN (SELECT id FROM controller_ids)
  ),
  audit_stats AS (
    SELECT
      COUNT(*) as row_count,
      COUNT(*) * avg_audit_row_size as byte_estimate
    FROM audit_logs al
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- STEP 5: Function to create a daily snapshot for an enterprise
-- ================================================================

CREATE OR REPLACE FUNCTION create_usage_snapshot(p_enterprise_id UUID, p_date DATE DEFAULT CURRENT_DATE)
RETURNS UUID AS $$
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
  SELECT * INTO v_storage FROM calculate_enterprise_storage(p_enterprise_id);

  -- Get package info
  SELECT
    up.id as package_id,
    up.name as package_name,
    up.storage_limit_bytes
  INTO v_package
  FROM enterprises e
  LEFT JOIN usage_packages up ON e.usage_package_id = up.id
  WHERE e.id = p_enterprise_id;

  -- Count resources
  SELECT COUNT(*) INTO v_sites_count
  FROM sites s
  JOIN projects p ON s.project_id = p.id
  WHERE p.enterprise_id = p_enterprise_id;

  SELECT COUNT(*) INTO v_controllers_count
  FROM controllers c
  WHERE c.enterprise_id = p_enterprise_id;

  SELECT COUNT(*) INTO v_users_count
  FROM users u
  WHERE u.enterprise_id = p_enterprise_id;

  SELECT COUNT(*) INTO v_devices_count
  FROM project_devices pd
  JOIN projects p ON pd.project_id = p.id
  WHERE p.enterprise_id = p_enterprise_id;

  -- Calculate usage percentage
  IF v_package.storage_limit_bytes IS NOT NULL AND v_package.storage_limit_bytes > 0 THEN
    v_usage_percent := (v_storage.total_storage_bytes::DECIMAL / v_package.storage_limit_bytes * 100);
  ELSE
    v_usage_percent := 0;
  END IF;

  -- Upsert snapshot
  INSERT INTO enterprise_usage_snapshots (
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- STEP 6: Function to create snapshots for all enterprises
-- ================================================================

CREATE OR REPLACE FUNCTION create_all_usage_snapshots(p_date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER AS $$
DECLARE
  v_enterprise RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_enterprise IN SELECT id FROM enterprises WHERE is_active = true LOOP
    PERFORM create_usage_snapshot(v_enterprise.id, p_date);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- STEP 7: Documentation
-- ================================================================

COMMENT ON TABLE enterprise_usage_snapshots IS 'Daily snapshots of enterprise storage and bandwidth usage for billing and analytics';
COMMENT ON COLUMN enterprise_usage_snapshots.snapshot_date IS 'Date of the snapshot (one per enterprise per day)';
COMMENT ON COLUMN enterprise_usage_snapshots.total_storage_bytes IS 'Total estimated storage in bytes across all tracked tables';
COMMENT ON COLUMN enterprise_usage_snapshots.storage_usage_percent IS 'Percentage of package limit used (0-100+, can exceed 100)';
COMMENT ON FUNCTION calculate_enterprise_storage IS 'Calculates storage used by an enterprise across all tracked tables';
COMMENT ON FUNCTION create_usage_snapshot IS 'Creates or updates a daily usage snapshot for an enterprise';
COMMENT ON FUNCTION create_all_usage_snapshots IS 'Creates snapshots for all active enterprises (run nightly)';
