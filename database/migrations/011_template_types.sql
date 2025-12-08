-- ============================================
-- Volteria - Template Types Migration
-- Migration: 011_template_types
--
-- Adds support for public vs custom device templates.
-- - Public templates: Created by admins, visible to all
-- - Custom templates: Created by enterprises, only visible to them
-- ============================================

-- Add template_type column with default 'public'
ALTER TABLE device_templates
ADD COLUMN IF NOT EXISTS template_type TEXT DEFAULT 'public'
    CHECK (template_type IN ('public', 'custom'));

-- Add enterprise_id for custom templates (nullable, only set for custom templates)
ALTER TABLE device_templates
ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE SET NULL;

-- Add created_by to track who created the template
ALTER TABLE device_templates
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================
-- CONSTRAINTS
-- ============================================

-- Custom templates must have an enterprise_id
-- This is enforced at application level, not database level
-- (since we want to allow existing public templates without enterprise_id)

-- ============================================
-- INDEXES
-- ============================================

-- Index for filtering by template type
CREATE INDEX IF NOT EXISTS idx_device_templates_type ON device_templates(template_type);

-- Index for filtering by enterprise
CREATE INDEX IF NOT EXISTS idx_device_templates_enterprise ON device_templates(enterprise_id) WHERE enterprise_id IS NOT NULL;

-- ============================================
-- UPDATE EXISTING TEMPLATES
-- ============================================

-- Mark all existing templates as public (they were created by admins)
UPDATE device_templates
SET template_type = 'public'
WHERE template_type IS NULL;

-- ============================================
-- RLS POLICIES FOR TEMPLATE ACCESS
-- ============================================

-- Drop existing policy if any
DROP POLICY IF EXISTS "Users can view public templates and their enterprise templates" ON device_templates;

-- Create policy: Users can see public templates + templates from their enterprise
CREATE POLICY "Users can view accessible templates" ON device_templates
    FOR SELECT
    USING (
        template_type = 'public'
        OR enterprise_id IS NULL
        OR enterprise_id IN (
            SELECT enterprise_id FROM users WHERE id = auth.uid()
        )
    );

-- Policy for inserting templates
DROP POLICY IF EXISTS "Users can create custom templates for their enterprise" ON device_templates;

CREATE POLICY "Authenticated users can create templates" ON device_templates
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for updating templates
DROP POLICY IF EXISTS "Users can update their enterprise templates" ON device_templates;

CREATE POLICY "Users can update accessible templates" ON device_templates
    FOR UPDATE
    USING (
        -- Public templates: only super_admin/backend_admin (checked in app)
        template_type = 'public'
        OR enterprise_id IN (
            SELECT enterprise_id FROM users WHERE id = auth.uid()
        )
    );
