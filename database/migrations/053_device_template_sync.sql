-- Migration 053: Device Template Sync Tracking
-- Adds columns to project_devices for template sync functionality:
-- - visualization_registers: Live display only registers (not stored in DB)
-- - calculated_fields: Selected calculated fields for the device
-- - template_synced_at: When device was last synced from its template

-- ============================================
-- ADD COLUMNS TO project_devices
-- ============================================

-- Visualization registers (live display only, not logged to DB)
ALTER TABLE project_devices
ADD COLUMN IF NOT EXISTS visualization_registers JSONB DEFAULT '[]'::jsonb;

-- Calculated fields selection
ALTER TABLE project_devices
ADD COLUMN IF NOT EXISTS calculated_fields JSONB DEFAULT '[]'::jsonb;

-- Template sync timestamp
ALTER TABLE project_devices
ADD COLUMN IF NOT EXISTS template_synced_at TIMESTAMPTZ;

-- ============================================
-- INDEXES
-- ============================================

-- Index for finding all devices using a specific template (for sync operations)
CREATE INDEX IF NOT EXISTS idx_project_devices_template_id ON project_devices(template_id);

-- Index for finding devices that need sync (template_synced_at is NULL or old)
CREATE INDEX IF NOT EXISTS idx_project_devices_template_synced_at ON project_devices(template_synced_at);

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON COLUMN project_devices.visualization_registers IS
'Registers for live display only (not stored in DB). Copied from template, can be customized per device.
Format: [{ address, name, type, datatype, scale, unit, ... }]';

COMMENT ON COLUMN project_devices.calculated_fields IS
'Selected calculated fields for this device. Copied from template, can be customized.
Format: [{ field_id: string, name: string, storage_mode: "log" | "viz_only" }]';

COMMENT ON COLUMN project_devices.template_synced_at IS
'Timestamp when this device was last synced from its template.
Compare with device_templates.updated_at to detect if sync is needed.
NULL means device was never synced or has no template.';
