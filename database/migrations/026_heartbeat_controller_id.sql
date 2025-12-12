-- ============================================
-- Migration: 026_heartbeat_controller_id
-- Allows controllers to send heartbeats BEFORE being assigned to a site/project
--
-- Problem: controller_heartbeats requires project_id NOT NULL, but new controllers
-- don't have a project assignment yet. This prevents the wizard from detecting
-- the controller in Step 6 "Verify Online".
--
-- Solution:
-- 1. Add controller_id column (optional reference to controllers table)
-- 2. Make project_id nullable (controllers can send heartbeats before assignment)
-- 3. Add index for efficient controller_id queries
-- ============================================

-- Step 1: Add controller_id column (nullable, references controllers table)
ALTER TABLE controller_heartbeats
ADD COLUMN IF NOT EXISTS controller_id UUID REFERENCES controllers(id) ON DELETE SET NULL;

-- Step 2: Make project_id nullable (for pre-assignment heartbeats)
-- Controllers can now send heartbeats before being assigned to a project
ALTER TABLE controller_heartbeats
ALTER COLUMN project_id DROP NOT NULL;

-- Step 3: Add index for controller_id queries
-- The wizard polls heartbeats by controller_id to detect if controller is online
CREATE INDEX IF NOT EXISTS idx_heartbeats_controller_id
ON controller_heartbeats(controller_id, timestamp DESC);

-- Step 4: Add site_id column for future use (sites are the new physical locations)
ALTER TABLE controller_heartbeats
ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE SET NULL;

-- Step 5: Add index for site_id queries
CREATE INDEX IF NOT EXISTS idx_heartbeats_site_id
ON controller_heartbeats(site_id, timestamp DESC);

-- Comments
COMMENT ON COLUMN controller_heartbeats.controller_id IS 'Controller that sent this heartbeat (for pre-assignment detection)';
COMMENT ON COLUMN controller_heartbeats.site_id IS 'Site this heartbeat is for (after controller is assigned to a site)';
COMMENT ON COLUMN controller_heartbeats.project_id IS 'Project this heartbeat is for (nullable - controllers may not be assigned yet)';
