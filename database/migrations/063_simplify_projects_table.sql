-- Migration 063: Simplify Projects Table
--
-- Purpose: Remove duplicate columns from the projects table that are now managed at the site level.
-- Projects are now just containers for grouping sites - all operational settings are stored in the sites table.
--
-- IMPORTANT: Before running this migration, ensure:
-- 1. All frontend pages have been updated to not use these columns
-- 2. All backend endpoints have been updated to not use these columns
-- 3. You have a backup of the database
--
-- Removed columns (now in sites table):
-- - Controller info: controller_serial_number, controller_status, controller_hardware_type,
--   controller_firmware_version, controller_registered_at, controller_last_seen
-- - Control settings: control_interval_ms, dg_reserve_kw, operation_mode
-- - Logging settings: logging_local_interval_ms, logging_cloud_interval_ms, logging_local_retention_days
-- - Safe mode settings: safe_mode_enabled, safe_mode_type, safe_mode_timeout_s,
--   safe_mode_rolling_window_min, safe_mode_threshold_pct
--
-- Kept columns in projects:
-- - id, name, location, description, timezone, enterprise_id, is_active, created_at, updated_at

-- Step 1: Drop RLS policies that might reference these columns
-- (none should exist, but safety first)

-- Step 2: Drop the duplicate columns
-- Controller info
ALTER TABLE projects DROP COLUMN IF EXISTS controller_serial_number;
ALTER TABLE projects DROP COLUMN IF EXISTS controller_status;
ALTER TABLE projects DROP COLUMN IF EXISTS controller_hardware_type;
ALTER TABLE projects DROP COLUMN IF EXISTS controller_firmware_version;
ALTER TABLE projects DROP COLUMN IF EXISTS controller_registered_at;
ALTER TABLE projects DROP COLUMN IF EXISTS controller_last_seen;

-- Control settings
ALTER TABLE projects DROP COLUMN IF EXISTS control_interval_ms;
ALTER TABLE projects DROP COLUMN IF EXISTS dg_reserve_kw;
ALTER TABLE projects DROP COLUMN IF EXISTS operation_mode;

-- Logging settings
ALTER TABLE projects DROP COLUMN IF EXISTS logging_local_interval_ms;
ALTER TABLE projects DROP COLUMN IF EXISTS logging_cloud_interval_ms;
ALTER TABLE projects DROP COLUMN IF EXISTS logging_local_retention_days;

-- Safe mode settings
ALTER TABLE projects DROP COLUMN IF EXISTS safe_mode_enabled;
ALTER TABLE projects DROP COLUMN IF EXISTS safe_mode_type;
ALTER TABLE projects DROP COLUMN IF EXISTS safe_mode_timeout_s;
ALTER TABLE projects DROP COLUMN IF EXISTS safe_mode_rolling_window_min;
ALTER TABLE projects DROP COLUMN IF EXISTS safe_mode_threshold_pct;

-- Step 3: Add a comment to document the change
COMMENT ON TABLE projects IS 'Projects are containers for grouping sites. All operational settings (control, logging, safe mode) are managed at the site level. See the sites table for operational configuration.';

-- Step 4: Verify the simplified structure
-- Expected remaining columns: id, name, location, description, timezone, enterprise_id, is_active, created_at, updated_at
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'projects'
ORDER BY ordinal_position;
