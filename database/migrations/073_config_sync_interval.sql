-- Migration: Add config_sync_interval_s column to sites table
-- Purpose: Allow configurable automatic sync interval per site (default 5 minutes)

ALTER TABLE sites
ADD COLUMN IF NOT EXISTS config_sync_interval_s INTEGER DEFAULT 300;

-- Add comment
COMMENT ON COLUMN sites.config_sync_interval_s IS 'Configuration sync interval in seconds (default: 300 = 5 minutes)';
