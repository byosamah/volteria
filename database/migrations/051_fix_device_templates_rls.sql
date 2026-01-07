-- ============================================
-- Migration: 051_fix_device_templates_rls
--
-- Problem: Device templates not showing after creation.
-- Root causes:
-- 1. Conflicting RLS policies from migrations 004, 011, and 043
-- 2. device_type constraint doesn't allow sensor subtypes
--
-- Solution:
-- 1. Drop ALL existing policies and recreate with proper structure
-- 2. Update device_type constraint to allow all sensor subtypes
-- ============================================

-- =============================================================================
-- PART 1: FIX RLS POLICIES
-- =============================================================================

-- Drop ALL existing RLS policies on device_templates
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'device_templates'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON device_templates', pol.policyname);
    END LOOP;
END $$;

-- Enable RLS (should already be enabled, but ensure it)
ALTER TABLE device_templates ENABLE ROW LEVEL SECURITY;

-- SELECT: Anyone authenticated can see public templates + their enterprise's custom templates
-- Super admin/backend admin can see all templates
CREATE POLICY device_templates_select ON device_templates
    FOR SELECT
    TO authenticated
    USING (
        -- Super admin and backend admin see everything
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('super_admin', 'backend_admin')
        )
        -- Everyone can see public templates
        OR template_type = 'public'
        -- Templates with null template_type are treated as public (legacy)
        OR template_type IS NULL
        -- Users can see their enterprise's custom templates
        OR (
            template_type = 'custom'
            AND enterprise_id = (SELECT enterprise_id FROM users WHERE id = auth.uid())
        )
    );

-- INSERT:
-- super_admin/backend_admin/admin can create public or custom templates
-- enterprise_admin/configurator can only create custom templates for their enterprise
CREATE POLICY device_templates_insert ON device_templates
    FOR INSERT
    TO authenticated
    WITH CHECK (
        -- Super admin, backend admin, and admin can create any template
        (
            EXISTS (
                SELECT 1 FROM users
                WHERE users.id = auth.uid()
                AND users.role IN ('super_admin', 'backend_admin', 'admin')
            )
        )
        -- Enterprise admin and configurator can create custom templates for their enterprise only
        OR (
            EXISTS (
                SELECT 1 FROM users
                WHERE users.id = auth.uid()
                AND users.role IN ('enterprise_admin', 'configurator')
            )
            AND template_type = 'custom'
            AND enterprise_id = (SELECT enterprise_id FROM users WHERE id = auth.uid())
        )
    );

-- UPDATE:
-- super_admin/backend_admin/admin can update any template
-- enterprise_admin/configurator can update their enterprise's custom templates
CREATE POLICY device_templates_update ON device_templates
    FOR UPDATE
    TO authenticated
    USING (
        -- Super admin, backend admin, and admin can update any template
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('super_admin', 'backend_admin', 'admin')
        )
        -- Enterprise admin and configurator can update their enterprise's custom templates
        OR (
            EXISTS (
                SELECT 1 FROM users
                WHERE users.id = auth.uid()
                AND users.role IN ('enterprise_admin', 'configurator')
            )
            AND template_type = 'custom'
            AND enterprise_id = (SELECT enterprise_id FROM users WHERE id = auth.uid())
        )
    );

-- DELETE:
-- super_admin can delete any template
-- enterprise_admin/configurator can delete their own custom templates
CREATE POLICY device_templates_delete ON device_templates
    FOR DELETE
    TO authenticated
    USING (
        -- Super admin can delete any template
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role = 'super_admin'
        )
        -- Enterprise admin and configurator can delete templates they created
        OR (
            EXISTS (
                SELECT 1 FROM users
                WHERE users.id = auth.uid()
                AND users.role IN ('enterprise_admin', 'configurator')
            )
            AND template_type = 'custom'
            AND created_by = auth.uid()
        )
    );

-- =============================================================================
-- PART 2: FIX DEVICE TYPE CONSTRAINT
-- =============================================================================

-- Drop the existing constraint
ALTER TABLE device_templates
    DROP CONSTRAINT IF EXISTS device_templates_device_type_check;

-- Add updated constraint with all sensor subtypes
ALTER TABLE device_templates
    ADD CONSTRAINT device_templates_device_type_check
    CHECK (device_type IN (
        'inverter',
        'dg',
        'load_meter',
        'sensor',
        'fuel_level_sensor',
        'temperature_humidity_sensor',
        'solar_radiation_sensor',
        'wind_sensor'
    ));

-- =============================================================================
-- VERIFICATION QUERIES (for manual testing)
-- =============================================================================
-- Run these after migration to verify:

-- Check RLS is enabled:
-- SELECT relname, relrowsecurity FROM pg_class
-- WHERE relnamespace = 'public'::regnamespace AND relname = 'device_templates';

-- Check policies:
-- SELECT policyname, cmd, roles FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'device_templates';

-- Check constraint:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = 'device_templates'::regclass;
