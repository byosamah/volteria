-- ============================================
-- Migration: 048_fix_heartbeat_site_fk
-- Purpose: Fix foreign key constraint on controller_heartbeats.site_id
--
-- Problem: Migration 013 created site_id without ON DELETE SET NULL,
-- which blocks project/site deletion when heartbeats exist.
-- Heartbeats should persist (with site_id = NULL) when sites are deleted.
--
-- Also fixes project_id foreign key to use ON DELETE SET NULL instead
-- of ON DELETE CASCADE - heartbeats are tied to controllers, not projects.
-- ============================================

-- Step 1: Drop the existing site_id foreign key constraint
-- (Constraint name follows PostgreSQL naming: {table}_{column}_fkey)
ALTER TABLE controller_heartbeats
DROP CONSTRAINT IF EXISTS controller_heartbeats_site_id_fkey;

-- Step 2: Re-add the constraint with ON DELETE SET NULL
-- When a site is deleted, heartbeats remain but site_id becomes NULL
ALTER TABLE controller_heartbeats
ADD CONSTRAINT controller_heartbeats_site_id_fkey
FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL;

-- Step 3: Drop the existing project_id foreign key constraint
-- Original constraint had ON DELETE CASCADE which would delete heartbeats
ALTER TABLE controller_heartbeats
DROP CONSTRAINT IF EXISTS controller_heartbeats_project_id_fkey;

-- Step 4: Re-add project_id constraint with ON DELETE SET NULL
-- Heartbeats should persist when projects are deleted
ALTER TABLE controller_heartbeats
ADD CONSTRAINT controller_heartbeats_project_id_fkey
FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;

-- Step 5: Also fix alarms.site_id constraint (same issue)
ALTER TABLE alarms
DROP CONSTRAINT IF EXISTS alarms_site_id_fkey;

ALTER TABLE alarms
ADD CONSTRAINT alarms_site_id_fkey
FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL;

-- Step 6: Fix control_logs.site_id constraint
ALTER TABLE control_logs
DROP CONSTRAINT IF EXISTS control_logs_site_id_fkey;

ALTER TABLE control_logs
ADD CONSTRAINT control_logs_site_id_fkey
FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL;

-- Comments
COMMENT ON COLUMN controller_heartbeats.site_id IS 'Site this heartbeat is for - set to NULL when site is deleted';
COMMENT ON COLUMN controller_heartbeats.project_id IS 'Project this heartbeat is for - set to NULL when project is deleted';
COMMENT ON COLUMN alarms.site_id IS 'Site this alarm is from - set to NULL when site is deleted';
COMMENT ON COLUMN control_logs.site_id IS 'Site this log is from - set to NULL when site is deleted';
