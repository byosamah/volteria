-- ============================================
-- Migration: 014_device_registers
-- Adds device-specific registers and logging settings
--
-- When a device is created from a template, registers
-- are copied to the device. This allows customization
-- without affecting the original template.
-- ============================================

-- Add registers column to project_devices
-- This stores a copy of the template's registers that can be customized
ALTER TABLE project_devices
ADD COLUMN IF NOT EXISTS registers JSONB;

-- Add logging interval for per-device polling frequency
ALTER TABLE project_devices
ADD COLUMN IF NOT EXISTS logging_interval_ms INTEGER DEFAULT 1000;

-- Comments
COMMENT ON COLUMN project_devices.registers IS 'Device-specific Modbus registers (copied from template, can be customized independently)';
COMMENT ON COLUMN project_devices.logging_interval_ms IS 'How often to poll this device in milliseconds (default: 1000ms)';

-- ============================================
-- Populate registers from templates for existing devices
-- ============================================

UPDATE project_devices pd
SET registers = dt.registers
FROM device_templates dt
WHERE pd.template_id = dt.id
  AND pd.registers IS NULL;
