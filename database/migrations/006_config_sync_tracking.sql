-- ============================================
-- Migration: 006_config_sync_tracking
-- Adds config sync tracking to projects table
--
-- Purpose:
-- Track when project configuration was last synced
-- to the on-site controller. Allows showing
-- "Sync Needed" vs "Synced" status in UI.
-- ============================================

-- Add config_synced_at column to projects table
-- This tracks when the configuration was last pushed to the controller
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS config_synced_at TIMESTAMPTZ;

-- Comment explaining the column
COMMENT ON COLUMN projects.config_synced_at IS
  'Timestamp of when project config was last synced to controller. Compare with updated_at to determine sync status.';

-- ============================================
-- Sync Status Logic:
--
-- If config_synced_at IS NULL:
--   Status = "Never Synced" (needs initial sync)
--
-- If updated_at > config_synced_at:
--   Status = "Sync Needed" (config changed since last sync)
--
-- If config_synced_at >= updated_at:
--   Status = "Synced" (controller has latest config)
--
-- Note: controller_status should also be checked:
--   If controller is "offline", sync is not possible
-- ============================================
