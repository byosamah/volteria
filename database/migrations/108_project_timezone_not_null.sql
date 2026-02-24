-- ============================================
-- Migration: 108_project_timezone_not_null
-- Make timezone NOT NULL with default 'UTC'
--
-- Purpose: Prevent NULL timezone which causes silent
-- time-window misalignment in delta fields and historical data.
-- All existing NULL timezones are set to 'UTC' first.
-- ============================================

-- First, backfill any NULL timezones to UTC
UPDATE projects SET timezone = 'UTC' WHERE timezone IS NULL;

-- Now make the column NOT NULL with a default
ALTER TABLE projects ALTER COLUMN timezone SET DEFAULT 'UTC';
ALTER TABLE projects ALTER COLUMN timezone SET NOT NULL;
