-- Migration 016: Add control method and grid connection fields to sites
-- This supports the new multi-step site creation wizard with:
-- - Control method selection (on-site controller vs gateway API)
-- - Control method backup options
-- - Grid connection type (on-grid vs off-grid)
-- - Cloud logging toggles

-- Step 1: Add control_method column
-- Determines how the site is controlled:
-- - onsite_controller: Raspberry Pi runs control logic locally (works offline)
-- - gateway_api: Server sends commands through Netbiter gateway (requires internet)
ALTER TABLE sites
ADD COLUMN IF NOT EXISTS control_method TEXT DEFAULT 'onsite_controller';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'valid_control_method'
    ) THEN
        ALTER TABLE sites
        ADD CONSTRAINT valid_control_method
        CHECK (control_method IN ('onsite_controller', 'gateway_api'));
    END IF;
END $$;

-- Step 2: Add control_method_backup column
-- What to do if primary control method fails:
-- - none: No backup method
-- - gateway_backup: Switch to gateway API if on-site controller fails
-- - controller_backup: Switch to on-site controller if gateway fails (future)
ALTER TABLE sites
ADD COLUMN IF NOT EXISTS control_method_backup TEXT DEFAULT 'none';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'valid_control_method_backup'
    ) THEN
        ALTER TABLE sites
        ADD CONSTRAINT valid_control_method_backup
        CHECK (control_method_backup IN ('none', 'gateway_backup', 'controller_backup'));
    END IF;
END $$;

-- Step 3: Add grid_connection column
-- Type of grid connection:
-- - off_grid: Diesel generators + solar (default, currently only supported mode)
-- - on_grid: Grid-connected system (coming soon)
ALTER TABLE sites
ADD COLUMN IF NOT EXISTS grid_connection TEXT DEFAULT 'off_grid';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'valid_grid_connection'
    ) THEN
        ALTER TABLE sites
        ADD CONSTRAINT valid_grid_connection
        CHECK (grid_connection IN ('on_grid', 'off_grid'));
    END IF;
END $$;

-- Step 4: Add cloud logging toggles
-- logging_cloud_enabled: Whether to sync logs to cloud via controller
ALTER TABLE sites
ADD COLUMN IF NOT EXISTS logging_cloud_enabled BOOLEAN DEFAULT TRUE;

-- logging_gateway_enabled: Whether to sync logs via gateway API
ALTER TABLE sites
ADD COLUMN IF NOT EXISTS logging_gateway_enabled BOOLEAN DEFAULT FALSE;

-- Step 5: Add comments for documentation
COMMENT ON COLUMN sites.control_method IS 'Primary control method: onsite_controller (local Pi) or gateway_api (remote via Netbiter)';
COMMENT ON COLUMN sites.control_method_backup IS 'Backup control method if primary fails: none, gateway_backup, or controller_backup';
COMMENT ON COLUMN sites.grid_connection IS 'Grid type: off_grid (DG+solar) or on_grid (grid-connected, coming soon)';
COMMENT ON COLUMN sites.logging_cloud_enabled IS 'Whether to sync logs to cloud platform via controller';
COMMENT ON COLUMN sites.logging_gateway_enabled IS 'Whether to sync logs via gateway API (Netbiter)';
