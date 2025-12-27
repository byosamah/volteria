-- Migration: 046_controller_template_types.sql
-- Purpose: Update controller_templates to use 'public'/'custom' terminology
--          and allow enterprise_admin + configurator to create custom templates

-- =============================================================================
-- UPDATE TEMPLATE TYPE VALUES
-- =============================================================================

-- Change 'master' to 'public' for consistency with device_templates
UPDATE controller_templates SET template_type = 'public' WHERE template_type = 'master';

-- Update the check constraint
ALTER TABLE controller_templates DROP CONSTRAINT IF EXISTS controller_templates_template_type_check;
ALTER TABLE controller_templates ADD CONSTRAINT controller_templates_template_type_check
    CHECK (template_type IN ('public', 'custom'));

-- Update table comment
COMMENT ON TABLE controller_templates IS
    'Master device templates for controllers. Public templates visible to all, custom templates scoped to enterprise.';

COMMENT ON COLUMN controller_templates.template_type IS
    'public = visible to all users (super_admin/backend_admin only), custom = enterprise-specific';

-- =============================================================================
-- UPDATE ROW LEVEL SECURITY POLICIES
-- =============================================================================

-- Drop existing policies to recreate with proper permissions
DROP POLICY IF EXISTS controller_templates_select_admin ON controller_templates;
DROP POLICY IF EXISTS controller_templates_insert_admin ON controller_templates;
DROP POLICY IF EXISTS controller_templates_update_admin ON controller_templates;
DROP POLICY IF EXISTS controller_templates_delete_admin ON controller_templates;

-- SELECT: Everyone can see public templates + their enterprise's custom templates
-- super_admin/backend_admin can see all templates
CREATE POLICY controller_templates_select ON controller_templates
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
        -- Users can see their enterprise's custom templates
        OR (
            template_type = 'custom'
            AND enterprise_id = (SELECT enterprise_id FROM users WHERE id = auth.uid())
        )
    );

-- INSERT:
-- super_admin/backend_admin can create public or custom templates
-- enterprise_admin/configurator can only create custom templates for their enterprise
CREATE POLICY controller_templates_insert ON controller_templates
    FOR INSERT
    TO authenticated
    WITH CHECK (
        -- Super admin and backend admin can create any template
        (
            EXISTS (
                SELECT 1 FROM users
                WHERE users.id = auth.uid()
                AND users.role IN ('super_admin', 'backend_admin')
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
-- super_admin can update any template
-- backend_admin can update any template
-- enterprise_admin/configurator can update their enterprise's custom templates
CREATE POLICY controller_templates_update ON controller_templates
    FOR UPDATE
    TO authenticated
    USING (
        -- Super admin and backend admin can update any template
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('super_admin', 'backend_admin')
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
CREATE POLICY controller_templates_delete ON controller_templates
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
