-- Migration 041: API Request Logs for Bandwidth Tracking
-- PHASE 6 - Billing & Storage Management
--
-- Tracks API requests for bandwidth measurement.
-- Used for calculating monthly bandwidth usage per enterprise.
--
-- Note: This table can grow large quickly. Consider:
-- - Partitioning by month
-- - Aggregating and purging old data
-- - Only enabling for specific endpoints

-- ================================================================
-- STEP 1: Create api_request_logs table
-- ================================================================

CREATE TABLE IF NOT EXISTS api_request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which enterprise made the request
  enterprise_id UUID REFERENCES enterprises(id) ON DELETE SET NULL,

  -- User who made the request (optional)
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Request details
  endpoint VARCHAR(255) NOT NULL,        -- e.g., "/api/projects/123/logs"
  method VARCHAR(10) NOT NULL,           -- GET, POST, PUT, DELETE
  status_code INTEGER,                   -- HTTP status code

  -- Size metrics (in bytes)
  request_bytes INTEGER DEFAULT 0,       -- Request body size
  response_bytes INTEGER DEFAULT 0,      -- Response body size

  -- Timing
  duration_ms INTEGER,                   -- Request duration in milliseconds

  -- Timestamp
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- STEP 2: Create indexes
-- ================================================================

-- Primary query: enterprise + time range for bandwidth calculation
CREATE INDEX IF NOT EXISTS idx_api_logs_enterprise_time
  ON api_request_logs(enterprise_id, timestamp DESC);

-- For endpoint analysis
CREATE INDEX IF NOT EXISTS idx_api_logs_endpoint
  ON api_request_logs(endpoint, timestamp DESC);

-- Note: Daily aggregation queries should use the enterprise_time index
-- with timestamp range filters rather than a DATE() function-based index
-- (DATE() is not IMMUTABLE due to timezone dependency)

-- ================================================================
-- STEP 3: Enable RLS
-- ================================================================

ALTER TABLE api_request_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Only admins can view request logs" ON api_request_logs;
DROP POLICY IF EXISTS "System can insert request logs" ON api_request_logs;

-- Only super/backend admins can view
CREATE POLICY "Only admins can view request logs"
  ON api_request_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('super_admin', 'backend_admin')
    )
  );

-- System inserts via service key
CREATE POLICY "System can insert request logs"
  ON api_request_logs
  FOR INSERT
  WITH CHECK (true);

-- ================================================================
-- STEP 4: Aggregation function for daily bandwidth
-- ================================================================

CREATE OR REPLACE FUNCTION get_daily_bandwidth(
  p_enterprise_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  log_date DATE,
  request_count BIGINT,
  total_bytes BIGINT,
  avg_duration_ms NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE(arl.timestamp) as log_date,
    COUNT(*)::BIGINT as request_count,
    (COALESCE(SUM(arl.request_bytes), 0) + COALESCE(SUM(arl.response_bytes), 0))::BIGINT as total_bytes,
    AVG(arl.duration_ms) as avg_duration_ms
  FROM api_request_logs arl
  WHERE arl.enterprise_id = p_enterprise_id
    AND DATE(arl.timestamp) BETWEEN p_start_date AND p_end_date
  GROUP BY DATE(arl.timestamp)
  ORDER BY log_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- STEP 5: Function to purge old request logs
-- ================================================================

CREATE OR REPLACE FUNCTION purge_old_api_logs(p_days_to_keep INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM api_request_logs
  WHERE timestamp < NOW() - (p_days_to_keep || ' days')::INTERVAL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- STEP 6: Documentation
-- ================================================================

COMMENT ON TABLE api_request_logs IS 'Tracks API requests for bandwidth measurement and analytics';
COMMENT ON COLUMN api_request_logs.request_bytes IS 'Size of request body in bytes';
COMMENT ON COLUMN api_request_logs.response_bytes IS 'Size of response body in bytes';
COMMENT ON FUNCTION get_daily_bandwidth IS 'Aggregates bandwidth usage by day for an enterprise';
COMMENT ON FUNCTION purge_old_api_logs IS 'Removes request logs older than N days (default 90)';
