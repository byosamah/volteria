-- ============================================
-- Migration: 049_add_controller_template_to_master_devices
-- Purpose: Add controller_template_id column to site_master_devices table
--
-- Problem: Frontend tries to insert controller_template_id when adding
-- a controller to a site, but the column doesn't exist.
--
-- This column links a site's controller to a controller template,
-- which defines alarms, registers, and calculated fields.
-- ============================================

-- Step 1: Add the controller_template_id column
-- Optional (nullable) because:
-- 1. Existing controllers may not have templates assigned
-- 2. Gateways may not need controller templates
ALTER TABLE site_master_devices
ADD COLUMN IF NOT EXISTS controller_template_id UUID REFERENCES controller_templates(id) ON DELETE SET NULL;

-- Step 2: Add index for foreign key performance
CREATE INDEX IF NOT EXISTS idx_site_master_devices_controller_template
ON site_master_devices(controller_template_id)
WHERE controller_template_id IS NOT NULL;

-- Step 3: Add comment for documentation
COMMENT ON COLUMN site_master_devices.controller_template_id IS
    'Controller template defining alarms, registers, and calculated fields for this master device (only for device_type=controller)';
