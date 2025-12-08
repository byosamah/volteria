-- ============================================
-- Migration: 013_sites_table
-- Creates the sites table for the new hierarchy:
-- Enterprise -> Project -> Site -> Devices
--
-- Sites are physical locations with 1 controller each.
-- Projects become virtual groupings of sites.
--
-- THIS MIGRATION:
-- 1. Creates the sites table
-- 2. Migrates existing project data to sites
-- 3. Adds site_id to related tables
-- 4. Does NOT drop columns from projects (safe rollback)
-- ============================================

-- ============================================
-- STEP 1: Create the sites table
-- ============================================

CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Relationship to project
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Site identification
    name TEXT NOT NULL,
    location TEXT,
    description TEXT,

    -- ============================================
    -- CONTROLLER INFO (moved from projects)
    -- ============================================
    controller_serial_number TEXT UNIQUE,
    controller_hardware_type TEXT DEFAULT 'raspberry_pi_5',
    controller_firmware_version TEXT,
    controller_registered_at TIMESTAMPTZ,
    controller_last_seen TIMESTAMPTZ,
    controller_status TEXT DEFAULT 'offline'
        CHECK (controller_status IN ('online', 'offline', 'error')),

    -- ============================================
    -- CONTROL SETTINGS (moved from projects)
    -- ============================================
    control_interval_ms INTEGER DEFAULT 1000,
    dg_reserve_kw NUMERIC DEFAULT 50 CHECK (dg_reserve_kw >= 0),
    operation_mode TEXT DEFAULT 'zero_dg_reverse',

    -- ============================================
    -- LOGGING SETTINGS (moved from projects)
    -- ============================================
    logging_local_interval_ms INTEGER DEFAULT 1000,
    logging_cloud_interval_ms INTEGER DEFAULT 5000,
    logging_local_retention_days INTEGER DEFAULT 7,

    -- ============================================
    -- SAFE MODE SETTINGS (moved from projects)
    -- ============================================
    safe_mode_enabled BOOLEAN DEFAULT TRUE,
    safe_mode_type TEXT DEFAULT 'rolling_average'
        CHECK (safe_mode_type IN ('time_based', 'rolling_average')),
    safe_mode_timeout_s INTEGER DEFAULT 30,
    safe_mode_rolling_window_min INTEGER DEFAULT 3,
    safe_mode_threshold_pct NUMERIC DEFAULT 80,
    safe_mode_power_limit_kw NUMERIC,

    -- ============================================
    -- SYNC TRACKING (moved from projects)
    -- ============================================
    config_synced_at TIMESTAMPTZ,

    -- ============================================
    -- TRACKING
    -- ============================================
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Status
    is_active BOOLEAN DEFAULT TRUE,

    -- Ensure unique site names within a project
    UNIQUE(project_id, name)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_sites_project_id ON sites(project_id);
CREATE INDEX IF NOT EXISTS idx_sites_controller_serial ON sites(controller_serial_number);
CREATE INDEX IF NOT EXISTS idx_sites_status ON sites(controller_status);
CREATE INDEX IF NOT EXISTS idx_sites_active ON sites(is_active) WHERE is_active = TRUE;

-- Update trigger for updated_at
CREATE TRIGGER update_sites_updated_at
    BEFORE UPDATE ON sites
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE sites IS 'Physical site locations with controllers. Projects group multiple sites.';
COMMENT ON COLUMN sites.project_id IS 'The project this site belongs to';
COMMENT ON COLUMN sites.controller_serial_number IS 'Unique serial number of the controller at this site';
COMMENT ON COLUMN sites.dg_reserve_kw IS 'Minimum DG reserve power - cannot be negative';
COMMENT ON COLUMN sites.config_synced_at IS 'When config was last synced to controller';

-- ============================================
-- STEP 2: Migrate existing projects to sites
-- Each existing project becomes a site under itself
-- (1:1 mapping for backward compatibility)
-- ============================================

INSERT INTO sites (
    id,
    project_id,
    name,
    location,
    description,
    controller_serial_number,
    controller_hardware_type,
    controller_firmware_version,
    controller_registered_at,
    controller_last_seen,
    controller_status,
    control_interval_ms,
    dg_reserve_kw,
    operation_mode,
    logging_local_interval_ms,
    logging_cloud_interval_ms,
    logging_local_retention_days,
    safe_mode_enabled,
    safe_mode_type,
    safe_mode_timeout_s,
    safe_mode_rolling_window_min,
    safe_mode_threshold_pct,
    config_synced_at,
    created_at,
    created_by,
    is_active
)
SELECT
    uuid_generate_v4(),                         -- New UUID for site
    id,                                         -- project_id = original project id
    name,                                       -- Site name = project name (not appending suffix)
    location,
    description,
    controller_serial_number,
    COALESCE(controller_hardware_type, 'raspberry_pi_5'),
    controller_firmware_version,
    controller_registered_at,
    controller_last_seen,
    COALESCE(controller_status, 'offline'),
    COALESCE(control_interval_ms, 1000),
    COALESCE(dg_reserve_kw, 50),
    COALESCE(operation_mode, 'zero_dg_reverse'),
    COALESCE(logging_local_interval_ms, 1000),
    COALESCE(logging_cloud_interval_ms, 5000),
    COALESCE(logging_local_retention_days, 7),
    COALESCE(safe_mode_enabled, TRUE),
    COALESCE(safe_mode_type, 'rolling_average'),
    COALESCE(safe_mode_timeout_s, 30),
    COALESCE(safe_mode_rolling_window_min, 3),
    COALESCE(safe_mode_threshold_pct, 80),
    config_synced_at,
    created_at,
    created_by,
    COALESCE(is_active, TRUE)
FROM projects
WHERE NOT EXISTS (
    -- Only migrate if sites don't already exist for this project
    SELECT 1 FROM sites s WHERE s.project_id = projects.id
);

-- ============================================
-- STEP 3: Add site_id to project_devices
-- ============================================

ALTER TABLE project_devices
ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id);

-- Populate site_id from project_id (using the migrated sites)
UPDATE project_devices pd
SET site_id = s.id
FROM sites s
WHERE s.project_id = pd.project_id
  AND pd.site_id IS NULL;

-- Comment
COMMENT ON COLUMN project_devices.site_id IS 'The site this device belongs to';

-- Create index
CREATE INDEX IF NOT EXISTS idx_project_devices_site ON project_devices(site_id);

-- ============================================
-- STEP 4: Add site_id to control_logs
-- ============================================

ALTER TABLE control_logs
ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id);

-- Populate site_id from project_id
UPDATE control_logs cl
SET site_id = s.id
FROM sites s
WHERE s.project_id = cl.project_id
  AND cl.site_id IS NULL;

-- Comment
COMMENT ON COLUMN control_logs.site_id IS 'The site this log entry is from';

-- Create index
CREATE INDEX IF NOT EXISTS idx_control_logs_site_time ON control_logs(site_id, timestamp DESC);

-- ============================================
-- STEP 5: Add site_id to alarms
-- ============================================

ALTER TABLE alarms
ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id);

-- Populate site_id from project_id
UPDATE alarms a
SET site_id = s.id
FROM sites s
WHERE s.project_id = a.project_id
  AND a.site_id IS NULL;

-- Comment
COMMENT ON COLUMN alarms.site_id IS 'The site this alarm is from';

-- Create index
CREATE INDEX IF NOT EXISTS idx_alarms_site ON alarms(site_id);

-- ============================================
-- STEP 6: Add site_id to controller_heartbeats
-- ============================================

ALTER TABLE controller_heartbeats
ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id);

-- Populate site_id from project_id
UPDATE controller_heartbeats ch
SET site_id = s.id
FROM sites s
WHERE s.project_id = ch.project_id
  AND ch.site_id IS NULL;

-- Comment
COMMENT ON COLUMN controller_heartbeats.site_id IS 'The site this heartbeat is from';

-- Create index
CREATE INDEX IF NOT EXISTS idx_heartbeats_site_time ON controller_heartbeats(site_id, timestamp DESC);

-- ============================================
-- STEP 7: Add site_id to controllers table
-- ============================================

ALTER TABLE controllers
ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id);

-- Populate site_id from project_id (if controller was assigned to a project)
UPDATE controllers c
SET site_id = s.id
FROM sites s
WHERE s.project_id = c.project_id
  AND c.project_id IS NOT NULL
  AND c.site_id IS NULL;

-- Comment
COMMENT ON COLUMN controllers.site_id IS 'The site this controller is assigned to';

-- Create index
CREATE INDEX IF NOT EXISTS idx_controllers_site ON controllers(site_id);

-- ============================================
-- STEP 8: Update trigger for heartbeats to update site
-- ============================================

-- Create a new function to update site controller status
CREATE OR REPLACE FUNCTION update_site_controller_status()
RETURNS TRIGGER AS $$
BEGIN
    -- Update the site's controller_last_seen and status
    IF NEW.site_id IS NOT NULL THEN
        UPDATE sites
        SET
            controller_last_seen = NEW.timestamp,
            controller_status = 'online'
        WHERE id = NEW.site_id;
    END IF;

    -- Also update the project for backward compatibility (until fully migrated)
    IF NEW.project_id IS NOT NULL THEN
        UPDATE projects
        SET
            controller_last_seen = NEW.timestamp,
            controller_status = 'online'
        WHERE id = NEW.project_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Replace the old trigger
DROP TRIGGER IF EXISTS update_controller_status_on_heartbeat ON controller_heartbeats;

CREATE TRIGGER update_controller_status_on_heartbeat
    AFTER INSERT ON controller_heartbeats
    FOR EACH ROW EXECUTE FUNCTION update_site_controller_status();

-- ============================================
-- STEP 9: Create user_sites table (like user_projects)
-- ============================================

CREATE TABLE IF NOT EXISTS user_sites (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,

    -- Permissions
    can_edit BOOLEAN DEFAULT FALSE,     -- Can modify site settings
    can_control BOOLEAN DEFAULT FALSE,  -- Can send remote commands

    -- Tracking
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id),

    PRIMARY KEY (user_id, site_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_sites_user ON user_sites(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sites_site ON user_sites(site_id);

-- Migrate user_projects to user_sites
INSERT INTO user_sites (user_id, site_id, can_edit, can_control, assigned_at, assigned_by)
SELECT
    up.user_id,
    s.id,
    up.can_edit,
    up.can_control,
    up.assigned_at,
    up.assigned_by
FROM user_projects up
JOIN sites s ON s.project_id = up.project_id
WHERE NOT EXISTS (
    SELECT 1 FROM user_sites us
    WHERE us.user_id = up.user_id AND us.site_id = s.id
);

-- ============================================
-- VERIFICATION QUERIES (run manually to check)
-- ============================================

-- Check sites were created:
-- SELECT COUNT(*) FROM sites;
-- SELECT COUNT(*) FROM projects;
-- (These should be equal after migration)

-- Check site_id populated in project_devices:
-- SELECT COUNT(*) FROM project_devices WHERE site_id IS NULL;
-- (Should be 0 after migration)

-- Check control_logs:
-- SELECT COUNT(*) FROM control_logs WHERE site_id IS NULL AND project_id IS NOT NULL;
-- (Should be 0 after migration)

-- ============================================
-- NOTE: We are NOT dropping columns from projects table yet.
-- This allows for safe rollback and gradual migration.
-- A future migration (014) will clean up the projects table
-- after verifying everything works.
-- ============================================
