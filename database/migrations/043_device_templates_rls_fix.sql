-- ============================================
-- Volteria - Fix Device Templates RLS Policy
-- Migration: 043_device_templates_rls_fix
--
-- Problem: Authenticated users can only READ device_templates,
-- but cannot INSERT/UPDATE/DELETE (only service_role could).
-- This caused "Not authenticated" error when saving templates.
--
-- Solution: Add policy allowing authenticated users to manage templates.
-- ============================================

-- Allow authenticated users to manage device templates
-- (Super admins and enterprise admins need to create/edit templates)
CREATE POLICY "Authenticated users can manage templates"
    ON device_templates FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
