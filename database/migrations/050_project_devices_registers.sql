-- ============================================
-- Migration: 050_project_devices_registers
-- Purpose: Add registers and alarm_registers columns to project_devices
--          Also make template_id nullable (frontend says it's optional)
--
-- Problem: Frontend tries to insert 'registers' and 'alarm_registers'
-- when adding a device, but columns don't exist.
--
-- These columns allow each device to have its own copy of the template's
-- registers, which can be customized independently per device.
-- ============================================

-- Step 1: Add registers column (Modbus register definitions)
-- Copied from device_templates.registers when device is created
ALTER TABLE project_devices
ADD COLUMN IF NOT EXISTS registers JSONB DEFAULT '[]';

-- Step 2: Add alarm_registers column (Alarm register definitions)
-- Copied from device_templates.alarm_registers when device is created
ALTER TABLE project_devices
ADD COLUMN IF NOT EXISTS alarm_registers JSONB DEFAULT '[]';

-- Step 3: Add logging_interval_ms column (if not exists)
-- Controls how often this device is polled/logged
ALTER TABLE project_devices
ADD COLUMN IF NOT EXISTS logging_interval_ms INTEGER DEFAULT 1000;

-- Step 4: Make template_id nullable (templates are optional per frontend)
-- This requires dropping and re-adding the constraint
ALTER TABLE project_devices
ALTER COLUMN template_id DROP NOT NULL;

-- Step 5: Add comments for documentation
COMMENT ON COLUMN project_devices.registers IS 'Modbus register definitions copied from template, can be customized per device';
COMMENT ON COLUMN project_devices.alarm_registers IS 'Alarm register definitions copied from template, can be customized per device';
COMMENT ON COLUMN project_devices.logging_interval_ms IS 'How often to poll/log this device in milliseconds (default: 1000ms)';
COMMENT ON COLUMN project_devices.template_id IS 'Optional reference to device template - NULL if device created without template';
