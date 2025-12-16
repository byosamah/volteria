-- Migration: 035_controller_templates.sql
-- Purpose: Create controller_templates table for master device templates (Raspberry Pi, gateways)
-- These templates define modbus registers, alarm definitions, and calculated fields for controllers

-- =============================================================================
-- CONTROLLER TEMPLATES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS controller_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Template identification
    template_id TEXT UNIQUE NOT NULL,           -- e.g., "rpi5_standard", "netbiter_ec310"
    name TEXT NOT NULL,                          -- e.g., "Raspberry Pi 5 Standard"
    description TEXT,                            -- Detailed description

    -- Controller type
    controller_type TEXT NOT NULL CHECK (controller_type IN ('raspberry_pi', 'gateway', 'plc')),

    -- Link to approved hardware (optional - for Pi controllers)
    hardware_type_id UUID REFERENCES approved_hardware(id),

    -- Brand and model (for gateways)
    brand TEXT,
    model TEXT,

    -- Registers for logging (same structure as device_templates.registers)
    -- These are system metrics the controller can report
    -- Example: CPU temp, disk usage, memory usage, etc.
    registers JSONB DEFAULT '[]',

    -- Alarm definitions with thresholds
    -- Structure: [{id, name, description, source_type, source_key, conditions, enabled_by_default, cooldown_seconds}]
    alarm_definitions JSONB DEFAULT '[]',

    -- Calculated field references
    -- References to calculated_field_definitions table
    calculated_fields JSONB DEFAULT '[]',

    -- Additional specifications
    specifications JSONB DEFAULT '{}',

    -- Template access control
    template_type TEXT DEFAULT 'master' CHECK (template_type IN ('master', 'custom')),
    enterprise_id UUID REFERENCES enterprises(id),  -- NULL for master templates (super_admin only)

    -- Tracking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    is_active BOOLEAN DEFAULT TRUE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_controller_templates_template_id ON controller_templates(template_id);
CREATE INDEX IF NOT EXISTS idx_controller_templates_type ON controller_templates(controller_type);
CREATE INDEX IF NOT EXISTS idx_controller_templates_enterprise ON controller_templates(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_controller_templates_hardware ON controller_templates(hardware_type_id);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_controller_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_controller_templates_updated_at
    BEFORE UPDATE ON controller_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_controller_templates_updated_at();

-- Comments
COMMENT ON TABLE controller_templates IS 'Master templates for controllers (Raspberry Pi, gateways) with system registers, alarm definitions, and calculated fields';
COMMENT ON COLUMN controller_templates.template_id IS 'Unique identifier for the template (e.g., rpi5_standard)';
COMMENT ON COLUMN controller_templates.registers IS 'JSONB array of system register definitions for logging';
COMMENT ON COLUMN controller_templates.alarm_definitions IS 'JSONB array of alarm definitions with threshold conditions';
COMMENT ON COLUMN controller_templates.calculated_fields IS 'JSONB array of calculated field references';
COMMENT ON COLUMN controller_templates.template_type IS 'master = system-wide (super_admin only), custom = enterprise-specific';

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE controller_templates ENABLE ROW LEVEL SECURITY;

-- Super admin and backend admin can see all templates
CREATE POLICY controller_templates_select_admin ON controller_templates
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('super_admin', 'backend_admin')
        )
        OR template_type = 'master'
        OR (
            template_type = 'custom'
            AND enterprise_id = (SELECT enterprise_id FROM users WHERE id = auth.uid())
        )
    );

-- Only super_admin can insert/update/delete master templates
CREATE POLICY controller_templates_insert_admin ON controller_templates
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role = 'super_admin'
        )
    );

CREATE POLICY controller_templates_update_admin ON controller_templates
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role = 'super_admin'
        )
    );

CREATE POLICY controller_templates_delete_admin ON controller_templates
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role = 'super_admin'
        )
    );

-- =============================================================================
-- SEED DEFAULT CONTROLLER TEMPLATE
-- =============================================================================

INSERT INTO controller_templates (
    template_id,
    name,
    description,
    controller_type,
    brand,
    model,
    registers,
    alarm_definitions,
    calculated_fields,
    template_type
) VALUES (
    'rpi5_standard',
    'Raspberry Pi 5 Standard',
    'Standard controller template for Raspberry Pi 5 with NVMe storage. Includes system monitoring alarms and calculated fields.',
    'raspberry_pi',
    'Raspberry Pi',
    'Pi 5',
    -- System registers (logged from heartbeat data)
    '[
        {"name": "cpu_temp", "source": "device_info", "field": "cpu_temp_celsius", "unit": "C", "description": "CPU Temperature"},
        {"name": "cpu_usage", "source": "device_info", "field": "cpu_usage_pct", "unit": "%", "description": "CPU Usage"},
        {"name": "memory_usage", "source": "device_info", "field": "memory_usage_pct", "unit": "%", "description": "Memory Usage"},
        {"name": "disk_usage", "source": "device_info", "field": "disk_usage_pct", "unit": "%", "description": "Disk Usage"},
        {"name": "uptime", "source": "device_info", "field": "uptime_seconds", "unit": "s", "description": "System Uptime"}
    ]'::JSONB,
    -- Alarm definitions
    '[
        {
            "id": "high_cpu_temp",
            "name": "High CPU Temperature",
            "description": "Controller CPU temperature is elevated",
            "source_type": "device_info",
            "source_key": "cpu_temp_celsius",
            "conditions": [
                {"operator": ">", "value": 70, "severity": "warning", "message": "CPU temperature above 70C"},
                {"operator": ">", "value": 85, "severity": "critical", "message": "CPU temperature critically high"}
            ],
            "enabled_by_default": true,
            "cooldown_seconds": 300
        },
        {
            "id": "controller_offline",
            "name": "Controller Offline",
            "description": "No heartbeat received from controller",
            "source_type": "heartbeat",
            "source_key": "last_heartbeat_seconds",
            "conditions": [
                {"operator": ">", "value": 60, "severity": "critical", "message": "Controller offline for more than 1 minute"}
            ],
            "enabled_by_default": true,
            "cooldown_seconds": 0
        },
        {
            "id": "low_disk_space",
            "name": "Low Disk Space",
            "description": "Controller disk storage is running low",
            "source_type": "device_info",
            "source_key": "disk_usage_pct",
            "conditions": [
                {"operator": ">", "value": 80, "severity": "warning", "message": "Disk usage above 80%"},
                {"operator": ">", "value": 95, "severity": "critical", "message": "Disk usage critically high"}
            ],
            "enabled_by_default": true,
            "cooldown_seconds": 3600
        },
        {
            "id": "high_memory_usage",
            "name": "High Memory Usage",
            "description": "Controller memory usage is elevated",
            "source_type": "device_info",
            "source_key": "memory_usage_pct",
            "conditions": [
                {"operator": ">", "value": 80, "severity": "warning", "message": "Memory usage above 80%"},
                {"operator": ">", "value": 95, "severity": "critical", "message": "Memory usage critically high"}
            ],
            "enabled_by_default": true,
            "cooldown_seconds": 300
        },
        {
            "id": "high_cpu_usage",
            "name": "High CPU Usage",
            "description": "Controller CPU usage is elevated",
            "source_type": "device_info",
            "source_key": "cpu_usage_pct",
            "conditions": [
                {"operator": ">", "value": 85, "severity": "warning", "message": "CPU usage above 85%"},
                {"operator": ">", "value": 95, "severity": "critical", "message": "CPU usage critically high"}
            ],
            "enabled_by_default": true,
            "cooldown_seconds": 300
        }
    ]'::JSONB,
    -- Calculated fields (references)
    '["total_solar_kw", "total_load_kw", "dg_power_kw"]'::JSONB,
    'master'
) ON CONFLICT (template_id) DO NOTHING;
