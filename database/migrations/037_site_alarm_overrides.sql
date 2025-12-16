-- Migration: 037_site_alarm_overrides.sql
-- Purpose: Create site_alarm_overrides table for site-specific alarm threshold customization
-- Allows users (except viewers) to override alarm thresholds at the site level

-- =============================================================================
-- SITE ALARM OVERRIDES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS site_alarm_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Site this override belongs to
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,

    -- Source of the alarm definition
    -- "controller_template" = from controller_templates.alarm_definitions
    -- "device_template" = from device_templates.alarm_definitions
    -- "device" = device-specific (for project_devices)
    source_type TEXT NOT NULL CHECK (source_type IN ('controller_template', 'device_template', 'device')),

    -- ID of the source (controller_template.id, device_template.id, or project_device.id)
    source_id UUID NOT NULL,

    -- Alarm definition ID (matches the "id" field in the alarm_definitions JSONB)
    alarm_definition_id TEXT NOT NULL,

    -- Override fields (NULL means use template default)

    -- Enable/disable this alarm for this site
    enabled BOOLEAN,

    -- Custom threshold conditions (replaces template conditions)
    -- Same structure as conditions in alarm_definitions
    conditions_override JSONB,

    -- Custom cooldown (NULL = use template default)
    cooldown_seconds_override INTEGER,

    -- Notes about why this was customized
    notes TEXT,

    -- Tracking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique constraint: one override per alarm per site per source
    UNIQUE(site_id, source_type, source_id, alarm_definition_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_site_alarm_overrides_site ON site_alarm_overrides(site_id);
CREATE INDEX IF NOT EXISTS idx_site_alarm_overrides_source ON site_alarm_overrides(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_site_alarm_overrides_alarm ON site_alarm_overrides(alarm_definition_id);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_site_alarm_overrides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_site_alarm_overrides_updated_at
    BEFORE UPDATE ON site_alarm_overrides
    FOR EACH ROW
    EXECUTE FUNCTION update_site_alarm_overrides_updated_at();

-- Comments
COMMENT ON TABLE site_alarm_overrides IS 'Site-specific alarm configuration overrides. Allows customizing thresholds per site.';
COMMENT ON COLUMN site_alarm_overrides.source_type IS 'Source of alarm definition: controller_template, device_template, or device';
COMMENT ON COLUMN site_alarm_overrides.source_id IS 'UUID of the source entity (template or device)';
COMMENT ON COLUMN site_alarm_overrides.alarm_definition_id IS 'ID of the alarm definition being overridden (e.g., high_cpu_temp)';
COMMENT ON COLUMN site_alarm_overrides.enabled IS 'Override enabled state (NULL = use template default)';
COMMENT ON COLUMN site_alarm_overrides.conditions_override IS 'Custom threshold conditions (NULL = use template defaults)';

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE site_alarm_overrides ENABLE ROW LEVEL SECURITY;

-- Users can view overrides for sites in their projects
CREATE POLICY site_alarm_overrides_select ON site_alarm_overrides
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('super_admin', 'backend_admin')
        )
        OR EXISTS (
            SELECT 1 FROM sites s
            JOIN projects p ON s.project_id = p.id
            JOIN user_projects up ON p.id = up.project_id
            WHERE s.id = site_alarm_overrides.site_id
            AND up.user_id = auth.uid()
        )
    );

-- Users with can_edit can modify alarm overrides (not viewers)
CREATE POLICY site_alarm_overrides_insert ON site_alarm_overrides
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('super_admin', 'backend_admin', 'admin', 'enterprise_admin')
        )
        OR EXISTS (
            SELECT 1 FROM sites s
            JOIN projects p ON s.project_id = p.id
            JOIN user_projects up ON p.id = up.project_id
            WHERE s.id = site_alarm_overrides.site_id
            AND up.user_id = auth.uid()
            AND up.can_edit = TRUE
        )
    );

CREATE POLICY site_alarm_overrides_update ON site_alarm_overrides
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('super_admin', 'backend_admin', 'admin', 'enterprise_admin')
        )
        OR EXISTS (
            SELECT 1 FROM sites s
            JOIN projects p ON s.project_id = p.id
            JOIN user_projects up ON p.id = up.project_id
            WHERE s.id = site_alarm_overrides.site_id
            AND up.user_id = auth.uid()
            AND up.can_edit = TRUE
        )
    );

CREATE POLICY site_alarm_overrides_delete ON site_alarm_overrides
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('super_admin', 'backend_admin', 'admin', 'enterprise_admin')
        )
        OR EXISTS (
            SELECT 1 FROM sites s
            JOIN projects p ON s.project_id = p.id
            JOIN user_projects up ON p.id = up.project_id
            WHERE s.id = site_alarm_overrides.site_id
            AND up.user_id = auth.uid()
            AND up.can_edit = TRUE
        )
    );
