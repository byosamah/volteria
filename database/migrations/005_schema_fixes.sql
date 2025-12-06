-- ============================================
-- Volteria - Schema Fixes
-- Migration: 005_schema_fixes
--
-- Adds missing columns that were discovered during deployment.
-- Run this AFTER 001_initial_schema.sql
-- ============================================

-- ============================================
-- 1. DEVICE_TEMPLATES - Missing Columns
-- ============================================
ALTER TABLE device_templates
ADD COLUMN IF NOT EXISTS rated_power_kva NUMERIC,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS operation TEXT CHECK (operation IN ('solar', 'dg', 'meter')),
ADD COLUMN IF NOT EXISTS specifications JSONB DEFAULT '{}';

-- Update existing rows to have operation values
UPDATE device_templates SET operation = 'solar' WHERE device_type = 'inverter' AND operation IS NULL;
UPDATE device_templates SET operation = 'dg' WHERE device_type = 'dg' AND operation IS NULL;
UPDATE device_templates SET operation = 'meter' WHERE device_type = 'load_meter' AND operation IS NULL;

-- ============================================
-- 2. PROJECT_DEVICES - Missing Columns
-- ============================================
ALTER TABLE project_devices
ADD COLUMN IF NOT EXISTS last_error TEXT;

-- ============================================
-- 3. PROJECTS - Missing Columns
-- ============================================
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS controller_hardware_type TEXT DEFAULT 'raspberry_pi_5',
ADD COLUMN IF NOT EXISTS controller_firmware_version TEXT,
ADD COLUMN IF NOT EXISTS controller_registered_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS created_by UUID;

-- ============================================
-- 4. Create updated_at trigger for device_templates
-- ============================================
DROP TRIGGER IF EXISTS update_device_templates_updated_at ON device_templates;
CREATE TRIGGER update_device_templates_updated_at
    BEFORE UPDATE ON device_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- VERIFICATION
-- ============================================
-- Check columns exist:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'device_templates' ORDER BY ordinal_position;
