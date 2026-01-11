-- ============================================
-- Migration: 064_site_level_alarms.sql
-- Purpose: Add site_level_alarms column to site_master_devices
--
-- Site-level alarms are based on calculated field values:
-- - "Suspected Power Outage (Load)" when total_load_kw = 0
-- - "Suspected Power Outage (Generation)" when total generation <= 0
-- - "High Reverse Power" when DG power < threshold
--
-- These are stored per master device (controller) and can be
-- auto-populated from controller templates.
-- ============================================

-- Step 1: Add site_level_alarms JSONB column to site_master_devices
-- Stores array of alarm configurations
ALTER TABLE site_master_devices
ADD COLUMN IF NOT EXISTS site_level_alarms JSONB DEFAULT '[]';

-- Step 2: Add site_level_alarms JSONB column to controller_templates
-- Templates define default site-level alarms that get copied to master devices
ALTER TABLE controller_templates
ADD COLUMN IF NOT EXISTS site_level_alarms JSONB DEFAULT '[]';

-- Step 3: Add comments for documentation
COMMENT ON COLUMN site_master_devices.site_level_alarms IS
    'Site-level alarm configurations based on calculated fields (e.g., power outage detection). Array of {alarm_id, name, source_field, condition, severity, enabled, cooldown_seconds}';

COMMENT ON COLUMN controller_templates.site_level_alarms IS
    'Default site-level alarm definitions for this template. Copied to site_master_devices when template is selected.';
