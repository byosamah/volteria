-- ============================================
-- Migration: 062_rename_project_devices.sql
-- Purpose: Rename project_devices to site_devices (devices belong to sites)
--
-- This migration:
-- 1. Renames the table from project_devices to site_devices
-- 2. Drops the redundant project_id column (site already has project_id)
-- 3. Makes site_id NOT NULL
-- 4. Updates indexes, triggers, and RLS policies
-- ============================================

-- Step 1: Rename the table
ALTER TABLE project_devices RENAME TO site_devices;

-- Step 2: Drop the redundant project_id column
-- (site_id already links to sites which have project_id)
ALTER TABLE site_devices DROP COLUMN IF EXISTS project_id;

-- Step 3: Make site_id NOT NULL (was nullable for migration)
-- First, delete any orphaned devices without a site
DELETE FROM site_devices WHERE site_id IS NULL;
ALTER TABLE site_devices ALTER COLUMN site_id SET NOT NULL;

-- Step 4: Rename indexes to match new table name
ALTER INDEX IF EXISTS idx_project_devices_project RENAME TO idx_site_devices_project_old;
ALTER INDEX IF EXISTS idx_project_devices_template RENAME TO idx_site_devices_template;
ALTER INDEX IF EXISTS idx_project_devices_protocol RENAME TO idx_site_devices_protocol;
ALTER INDEX IF EXISTS idx_project_devices_site RENAME TO idx_site_devices_site;

-- Drop the old project index (no longer needed)
DROP INDEX IF EXISTS idx_site_devices_project_old;

-- Step 5: Update the trigger
DROP TRIGGER IF EXISTS update_project_devices_updated_at ON site_devices;
CREATE TRIGGER update_site_devices_updated_at
    BEFORE UPDATE ON site_devices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Step 6: Update comments
COMMENT ON TABLE site_devices IS 'Devices configured for each site with connection details';
COMMENT ON COLUMN site_devices.site_id IS 'The site this device belongs to (required)';

-- Step 7: Update RLS policies
-- First drop old policies
DROP POLICY IF EXISTS "Users can view project devices" ON site_devices;
DROP POLICY IF EXISTS "Users can insert project devices" ON site_devices;
DROP POLICY IF EXISTS "Users can update project devices" ON site_devices;
DROP POLICY IF EXISTS "Users can delete project devices" ON site_devices;
DROP POLICY IF EXISTS "Authenticated users can view project_devices" ON site_devices;
DROP POLICY IF EXISTS "Authenticated users can insert project_devices" ON site_devices;
DROP POLICY IF EXISTS "Authenticated users can update project_devices" ON site_devices;
DROP POLICY IF EXISTS "Authenticated users can delete project_devices" ON site_devices;

-- Create new policies with correct names
CREATE POLICY "Users can view site devices" ON site_devices
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert site devices" ON site_devices
    FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can update site devices" ON site_devices
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Users can delete site devices" ON site_devices
    FOR DELETE TO authenticated USING (true);

-- Step 8: Update constraint names if needed
-- (The valid_measurement_type constraint from migration 061 will work as-is)
