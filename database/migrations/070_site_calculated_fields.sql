-- Migration 070: Add controller_calculated_fields to sites table
-- Stores which controller-level calculated fields are enabled for this site

-- Add column for selected controller-level calculated fields
ALTER TABLE sites
ADD COLUMN IF NOT EXISTS controller_calculated_fields JSONB DEFAULT '[]'::JSONB;

COMMENT ON COLUMN sites.controller_calculated_fields IS 'Selected controller-level calculated fields (e.g., total_solar_kw, total_load_kw). Each entry has field_id and optional storage_mode.';

-- Example structure:
-- [
--   {"field_id": "total_solar_kw", "storage_mode": "log"},
--   {"field_id": "total_load_kw", "storage_mode": "log"},
--   {"field_id": "dg_power_kw", "storage_mode": "viz_only"}
-- ]
