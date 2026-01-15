-- Migration 069: Fix RLS on calculated_field_definitions
-- The service_role should bypass RLS but it's not working properly
-- This table contains system-wide definitions that should be readable by all

-- Option 1: Add anon policy (so REST API works without auth)
CREATE POLICY IF NOT EXISTS calc_fields_anon_select ON calculated_field_definitions
    FOR SELECT
    TO anon
    USING (TRUE);

-- Option 2: If the above doesn't exist syntax, drop and recreate
DROP POLICY IF EXISTS calc_fields_select ON calculated_field_definitions;
DROP POLICY IF EXISTS calc_fields_anon_select ON calculated_field_definitions;

-- Allow all select (system data, read-only)
CREATE POLICY calc_fields_public_select ON calculated_field_definitions
    FOR SELECT
    USING (TRUE);

-- Verify data exists
SELECT COUNT(*) as total_fields FROM calculated_field_definitions;
SELECT field_id, name FROM calculated_field_definitions LIMIT 5;
