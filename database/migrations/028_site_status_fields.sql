-- Migration: 028_site_status_fields.sql
-- Purpose: Add control loop status tracking to heartbeats and config version tracking to sites
-- Date: 2024-12-14

-- =============================================================================
-- Step 1: Add control loop status fields to controller_heartbeats table
-- These fields allow the controller to report its operational state
-- =============================================================================

-- control_loop_status: Current state of the control loop
-- Values: 'running' | 'stopped' | 'error' | 'unknown'
ALTER TABLE controller_heartbeats
ADD COLUMN IF NOT EXISTS control_loop_status TEXT DEFAULT 'unknown';

-- last_error: Most recent error message (if control loop is in error state)
ALTER TABLE controller_heartbeats
ADD COLUMN IF NOT EXISTS last_error TEXT;

-- active_alarms_count: Number of currently active (unacknowledged) alarms
ALTER TABLE controller_heartbeats
ADD COLUMN IF NOT EXISTS active_alarms_count INTEGER DEFAULT 0;

-- =============================================================================
-- Step 2: Add config version tracking to sites table
-- These fields track platform vs controller config synchronization
-- =============================================================================

-- platform_config_version: Hash of current platform config (updated when site config changes)
ALTER TABLE sites
ADD COLUMN IF NOT EXISTS platform_config_version TEXT;

-- controller_config_version: Hash of config currently on controller (updated via heartbeat)
ALTER TABLE sites
ADD COLUMN IF NOT EXISTS controller_config_version TEXT;

-- =============================================================================
-- Step 3: Create function to auto-update platform_config_version when site changes
-- =============================================================================

-- Function to generate config version hash from site data
CREATE OR REPLACE FUNCTION generate_site_config_version()
RETURNS TRIGGER AS $$
BEGIN
  -- Generate a hash based on key config fields
  -- This will change whenever the site configuration is modified
  NEW.platform_config_version := md5(
    COALESCE(NEW.operation_mode, '') || '|' ||
    COALESCE(NEW.control_method, '') || '|' ||
    COALESCE(NEW.dg_reserve_kw::TEXT, '0') || '|' ||
    COALESCE(NEW.control_interval_ms::TEXT, '1000') || '|' ||
    COALESCE(NEW.safe_mode_enabled::TEXT, 'false') || '|' ||
    COALESCE(NEW.safe_mode_type, '') || '|' ||
    COALESCE(NEW.safe_mode_timeout_s::TEXT, '30') || '|' ||
    COALESCE(NEW.safe_mode_threshold_kw::TEXT, '0') || '|' ||
    COALESCE(NEW.safe_mode_power_limit_pct::TEXT, '0') || '|' ||
    COALESCE(NEW.updated_at::TEXT, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update platform_config_version on site changes
DROP TRIGGER IF EXISTS update_site_config_version ON sites;
CREATE TRIGGER update_site_config_version
  BEFORE INSERT OR UPDATE ON sites
  FOR EACH ROW
  EXECUTE FUNCTION generate_site_config_version();

-- =============================================================================
-- Step 4: Add index for efficient heartbeat queries
-- =============================================================================

-- Index on controller_id and timestamp for fast latest heartbeat lookup
CREATE INDEX IF NOT EXISTS idx_heartbeats_controller_timestamp
ON controller_heartbeats(controller_id, timestamp DESC);

-- =============================================================================
-- Step 5: Add comments for documentation
-- =============================================================================

COMMENT ON COLUMN controller_heartbeats.control_loop_status IS 'Current state of the control loop: running, stopped, error, or unknown';
COMMENT ON COLUMN controller_heartbeats.last_error IS 'Most recent error message if control loop is in error state';
COMMENT ON COLUMN controller_heartbeats.active_alarms_count IS 'Number of currently active (unacknowledged) alarms';
COMMENT ON COLUMN sites.platform_config_version IS 'MD5 hash of platform config (auto-generated on changes)';
COMMENT ON COLUMN sites.controller_config_version IS 'MD5 hash of config currently on controller (updated via heartbeat)';
