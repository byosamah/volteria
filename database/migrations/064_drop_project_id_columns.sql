-- Migration 064: Drop Redundant project_id Columns
--
-- Purpose: Remove redundant project_id columns from control_logs and alarms tables.
-- The project can be derived via: site_id -> sites.project_id
--
-- This completes the site-centric data model where:
-- - Controller sends data by site_id (physical location with controller)
-- - Project is a grouping/container derived via JOIN
-- - Queries aggregate across all sites in a project
--
-- IMPORTANT: Before running this migration, ensure:
-- 1. All backend endpoints have been updated to query via site_id
-- 2. Controller cloud sync uses site_id (already done)
-- 3. All existing data has site_id populated (done in migration 013)

-- ============================================
-- STEP 1: Drop unique constraint on project_id+timestamp (control_logs)
-- ============================================
-- The old constraint was: UNIQUE(project_id, timestamp)
-- New constraint will be: UNIQUE(site_id, timestamp)

ALTER TABLE control_logs DROP CONSTRAINT IF EXISTS control_logs_project_id_timestamp_key;
ALTER TABLE control_logs DROP CONSTRAINT IF EXISTS control_logs_project_timestamp_unique;

-- Add new unique constraint on site_id + timestamp
ALTER TABLE control_logs ADD CONSTRAINT control_logs_site_id_timestamp_key
    UNIQUE(site_id, timestamp);

-- ============================================
-- STEP 2: Drop project_id column from control_logs
-- ============================================
ALTER TABLE control_logs DROP COLUMN IF EXISTS project_id;

-- ============================================
-- STEP 3: Drop project_id column from alarms
-- ============================================
ALTER TABLE alarms DROP COLUMN IF EXISTS project_id;

-- ============================================
-- STEP 4: Add composite indexes for query performance
-- ============================================

-- Index 1: Alarms filtered by site + resolved + created_at
-- Speeds up: "Show unresolved alarms for site X, newest first"
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alarms_site_resolved_created
ON alarms(site_id, resolved, created_at DESC);

-- Index 2: User-project permission lookups
-- Speeds up: Permission checks (can user X access project Y?)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_projects_user_project
ON user_projects(user_id, project_id);

-- Index 3: Alarms by site + acknowledged + severity
-- Speeds up: Site alarm page filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alarms_site_ack_severity
ON alarms(site_id, acknowledged, severity);

-- Index 4: Control logs by site + time (verify exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'idx_control_logs_site_time'
    ) THEN
        CREATE INDEX idx_control_logs_site_time ON control_logs(site_id, timestamp DESC);
    END IF;
END $$;

-- ============================================
-- STEP 5: Verify changes
-- ============================================

-- Show control_logs columns (should NOT have project_id)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'control_logs'
ORDER BY ordinal_position;

-- Show alarms columns (should NOT have project_id)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'alarms'
ORDER BY ordinal_position;

-- Show new indexes
SELECT indexname, tablename
FROM pg_indexes
WHERE indexname IN (
    'control_logs_site_id_timestamp_key',
    'idx_alarms_site_resolved_created',
    'idx_user_projects_user_project',
    'idx_alarms_site_ack_severity',
    'idx_control_logs_site_time'
)
ORDER BY tablename, indexname;
