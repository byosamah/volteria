-- Migration: Add config_changed_at column
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/usgxhzdctzthcqxyxfxl/sql
--
-- Purpose: Track when configuration actually changes, separately from sync operations.
-- The updated_at column auto-updates when config_synced_at changes, causing both dates to match.

-- Step 1: Add the column
ALTER TABLE sites ADD COLUMN IF NOT EXISTS config_changed_at TIMESTAMPTZ;

-- Step 2: Initialize with current updated_at values
UPDATE sites SET config_changed_at = updated_at WHERE config_changed_at IS NULL;

-- Step 3: Create trigger function that only updates config_changed_at for actual config changes
CREATE OR REPLACE FUNCTION update_config_changed_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update if actual config columns changed (NOT config_synced_at or metadata)
  IF (
    OLD.name IS DISTINCT FROM NEW.name OR
    OLD.location IS DISTINCT FROM NEW.location OR
    OLD.description IS DISTINCT FROM NEW.description OR
    OLD.control_method IS DISTINCT FROM NEW.control_method OR
    OLD.control_method_backup IS DISTINCT FROM NEW.control_method_backup OR
    OLD.grid_connection IS DISTINCT FROM NEW.grid_connection OR
    OLD.operation_mode IS DISTINCT FROM NEW.operation_mode OR
    OLD.dg_reserve_kw IS DISTINCT FROM NEW.dg_reserve_kw OR
    OLD.control_interval_ms IS DISTINCT FROM NEW.control_interval_ms OR
    OLD.logging_local_interval_ms IS DISTINCT FROM NEW.logging_local_interval_ms OR
    OLD.logging_cloud_interval_ms IS DISTINCT FROM NEW.logging_cloud_interval_ms OR
    OLD.logging_local_retention_days IS DISTINCT FROM NEW.logging_local_retention_days OR
    OLD.logging_cloud_enabled IS DISTINCT FROM NEW.logging_cloud_enabled OR
    OLD.logging_gateway_enabled IS DISTINCT FROM NEW.logging_gateway_enabled OR
    OLD.safe_mode_enabled IS DISTINCT FROM NEW.safe_mode_enabled OR
    OLD.safe_mode_type IS DISTINCT FROM NEW.safe_mode_type OR
    OLD.safe_mode_timeout_s IS DISTINCT FROM NEW.safe_mode_timeout_s OR
    OLD.safe_mode_rolling_window_min IS DISTINCT FROM NEW.safe_mode_rolling_window_min OR
    OLD.safe_mode_threshold_pct IS DISTINCT FROM NEW.safe_mode_threshold_pct OR
    OLD.safe_mode_power_limit_kw IS DISTINCT FROM NEW.safe_mode_power_limit_kw
  ) THEN
    NEW.config_changed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create trigger
DROP TRIGGER IF EXISTS trigger_update_config_changed_at ON sites;
CREATE TRIGGER trigger_update_config_changed_at
  BEFORE UPDATE ON sites
  FOR EACH ROW
  EXECUTE FUNCTION update_config_changed_at();

-- Verification: Check column exists
SELECT id, name, config_changed_at, config_synced_at, updated_at FROM sites LIMIT 5;
