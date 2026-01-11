-- Migration 066: Template Audit Log
--
-- Purpose: Track changes to device_templates and controller_templates.
-- Useful for debugging when template changes break device communication.
--
-- Records:
-- - Who made the change
-- - When the change was made
-- - What changed (old vs new values for registers, alarm definitions, etc.)

-- ============================================
-- STEP 1: Create template_audit_log table
-- ============================================
CREATE TABLE IF NOT EXISTS template_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What was changed
    template_type TEXT NOT NULL CHECK (template_type IN ('device_template', 'controller_template')),
    template_id UUID NOT NULL,  -- References device_templates.id or controller_templates.id
    template_name TEXT,         -- Snapshot of template name at time of change

    -- Type of change
    action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),

    -- Who made the change
    changed_by UUID REFERENCES auth.users(id),
    changed_by_email TEXT,  -- Snapshot in case user is deleted later

    -- What changed
    old_values JSONB,  -- Previous state (null for create)
    new_values JSONB,  -- New state (null for delete)

    -- Specific fields that changed (for quick filtering)
    changed_fields TEXT[],  -- e.g., ['registers', 'alarm_definitions']

    -- Context
    change_reason TEXT,  -- Optional: why was this changed

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- STEP 2: Create indexes for common queries
-- ============================================

-- Query by template
CREATE INDEX IF NOT EXISTS idx_template_audit_template
ON template_audit_log(template_type, template_id, created_at DESC);

-- Query by user
CREATE INDEX IF NOT EXISTS idx_template_audit_user
ON template_audit_log(changed_by, created_at DESC);

-- Query by action type
CREATE INDEX IF NOT EXISTS idx_template_audit_action
ON template_audit_log(action, created_at DESC);

-- Query recent changes
CREATE INDEX IF NOT EXISTS idx_template_audit_recent
ON template_audit_log(created_at DESC);

-- ============================================
-- STEP 3: Create trigger function for device_templates
-- ============================================
CREATE OR REPLACE FUNCTION fn_audit_device_template()
RETURNS TRIGGER AS $$
DECLARE
    v_changed_fields TEXT[];
    v_old_values JSONB;
    v_new_values JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Create action
        INSERT INTO template_audit_log (
            template_type,
            template_id,
            template_name,
            action,
            new_values,
            changed_fields
        ) VALUES (
            'device_template',
            NEW.id,
            NEW.name,
            'create',
            to_jsonb(NEW),
            ARRAY['all']
        );
        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
        -- Determine which fields changed
        v_changed_fields := ARRAY[]::TEXT[];

        IF OLD.name IS DISTINCT FROM NEW.name THEN
            v_changed_fields := array_append(v_changed_fields, 'name');
        END IF;
        IF OLD.device_type IS DISTINCT FROM NEW.device_type THEN
            v_changed_fields := array_append(v_changed_fields, 'device_type');
        END IF;
        IF OLD.brand IS DISTINCT FROM NEW.brand THEN
            v_changed_fields := array_append(v_changed_fields, 'brand');
        END IF;
        IF OLD.model IS DISTINCT FROM NEW.model THEN
            v_changed_fields := array_append(v_changed_fields, 'model');
        END IF;
        IF OLD.registers IS DISTINCT FROM NEW.registers THEN
            v_changed_fields := array_append(v_changed_fields, 'registers');
        END IF;
        IF OLD.alarm_definitions IS DISTINCT FROM NEW.alarm_definitions THEN
            v_changed_fields := array_append(v_changed_fields, 'alarm_definitions');
        END IF;
        IF OLD.rated_power_kw IS DISTINCT FROM NEW.rated_power_kw THEN
            v_changed_fields := array_append(v_changed_fields, 'rated_power_kw');
        END IF;

        -- Only log if something actually changed
        IF array_length(v_changed_fields, 1) > 0 THEN
            INSERT INTO template_audit_log (
                template_type,
                template_id,
                template_name,
                action,
                old_values,
                new_values,
                changed_fields
            ) VALUES (
                'device_template',
                NEW.id,
                NEW.name,
                'update',
                to_jsonb(OLD),
                to_jsonb(NEW),
                v_changed_fields
            );
        END IF;
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        -- Delete action
        INSERT INTO template_audit_log (
            template_type,
            template_id,
            template_name,
            action,
            old_values,
            changed_fields
        ) VALUES (
            'device_template',
            OLD.id,
            OLD.name,
            'delete',
            to_jsonb(OLD),
            ARRAY['all']
        );
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- STEP 4: Create trigger function for controller_templates
-- ============================================
CREATE OR REPLACE FUNCTION fn_audit_controller_template()
RETURNS TRIGGER AS $$
DECLARE
    v_changed_fields TEXT[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO template_audit_log (
            template_type,
            template_id,
            template_name,
            action,
            new_values,
            changed_fields
        ) VALUES (
            'controller_template',
            NEW.id,
            NEW.name,
            'create',
            to_jsonb(NEW),
            ARRAY['all']
        );
        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
        v_changed_fields := ARRAY[]::TEXT[];

        IF OLD.name IS DISTINCT FROM NEW.name THEN
            v_changed_fields := array_append(v_changed_fields, 'name');
        END IF;
        IF OLD.controller_type IS DISTINCT FROM NEW.controller_type THEN
            v_changed_fields := array_append(v_changed_fields, 'controller_type');
        END IF;
        IF OLD.registers IS DISTINCT FROM NEW.registers THEN
            v_changed_fields := array_append(v_changed_fields, 'registers');
        END IF;
        IF OLD.alarm_definitions IS DISTINCT FROM NEW.alarm_definitions THEN
            v_changed_fields := array_append(v_changed_fields, 'alarm_definitions');
        END IF;
        IF OLD.calculated_fields IS DISTINCT FROM NEW.calculated_fields THEN
            v_changed_fields := array_append(v_changed_fields, 'calculated_fields');
        END IF;

        IF array_length(v_changed_fields, 1) > 0 THEN
            INSERT INTO template_audit_log (
                template_type,
                template_id,
                template_name,
                action,
                old_values,
                new_values,
                changed_fields
            ) VALUES (
                'controller_template',
                NEW.id,
                NEW.name,
                'update',
                to_jsonb(OLD),
                to_jsonb(NEW),
                v_changed_fields
            );
        END IF;
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO template_audit_log (
            template_type,
            template_id,
            template_name,
            action,
            old_values,
            changed_fields
        ) VALUES (
            'controller_template',
            OLD.id,
            OLD.name,
            'delete',
            to_jsonb(OLD),
            ARRAY['all']
        );
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- STEP 5: Attach triggers to tables
-- ============================================

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS trg_audit_device_template ON device_templates;
DROP TRIGGER IF EXISTS trg_audit_controller_template ON controller_templates;

-- Create triggers
CREATE TRIGGER trg_audit_device_template
    AFTER INSERT OR UPDATE OR DELETE ON device_templates
    FOR EACH ROW EXECUTE FUNCTION fn_audit_device_template();

CREATE TRIGGER trg_audit_controller_template
    AFTER INSERT OR UPDATE OR DELETE ON controller_templates
    FOR EACH ROW EXECUTE FUNCTION fn_audit_controller_template();

-- ============================================
-- STEP 6: Enable RLS
-- ============================================
ALTER TABLE template_audit_log ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read audit logs
CREATE POLICY "Authenticated users can read template audit logs"
ON template_audit_log FOR SELECT
TO authenticated
USING (true);

-- Service role has full access
CREATE POLICY "Service role has full access to template audit logs"
ON template_audit_log FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- STEP 7: Add comments
-- ============================================
COMMENT ON TABLE template_audit_log IS 'Audit trail for device_templates and controller_templates changes';
COMMENT ON COLUMN template_audit_log.changed_fields IS 'Array of field names that were modified';
COMMENT ON COLUMN template_audit_log.old_values IS 'Complete row state before change (JSONB)';
COMMENT ON COLUMN template_audit_log.new_values IS 'Complete row state after change (JSONB)';

-- ============================================
-- STEP 8: Verify
-- ============================================
SELECT
    trigger_name,
    event_manipulation,
    action_statement
FROM information_schema.triggers
WHERE trigger_name IN ('trg_audit_device_template', 'trg_audit_controller_template');
