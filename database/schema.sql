-- Solar Diesel Hybrid Controller - Database Schema
-- Run this in Supabase SQL Editor to create all tables

-- ============================================
-- PROJECTS TABLE
-- Note: Projects are containers for grouping sites.
-- All operational settings (control, logging, safe mode) are managed at the site level.
-- See the sites table for operational configuration.
-- ============================================
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    location TEXT,
    description TEXT,
    timezone TEXT DEFAULT 'UTC',
    enterprise_id UUID REFERENCES enterprises(id),

    -- Status
    is_active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- DEVICE TEMPLATES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS device_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    device_type TEXT NOT NULL CHECK (device_type IN ('inverter', 'load_meter', 'dg')),
    brand TEXT,
    model TEXT,
    rated_power_kw NUMERIC,
    registers JSONB DEFAULT '[]'::JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SITE DEVICES TABLE (devices belong to sites)
-- ============================================
CREATE TABLE IF NOT EXISTS site_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    template_id UUID REFERENCES device_templates(id),

    -- Device naming
    name TEXT NOT NULL,

    -- Connection details
    protocol TEXT NOT NULL CHECK (protocol IN ('tcp', 'rtu_gateway', 'rtu_direct')),
    ip_address TEXT,
    port INTEGER DEFAULT 502,
    gateway_ip TEXT,
    gateway_port INTEGER,
    serial_port TEXT,
    baudrate INTEGER,
    slave_id INTEGER NOT NULL,

    -- Optional overrides
    rated_power_kw NUMERIC,
    rated_power_kva NUMERIC,

    -- Register configuration (from template or custom)
    registers JSONB DEFAULT '[]',
    alarm_registers JSONB DEFAULT '[]',
    logging_interval_ms INTEGER DEFAULT 1000,

    -- Status
    enabled BOOLEAN DEFAULT TRUE,
    is_online BOOLEAN DEFAULT FALSE,
    last_seen TIMESTAMPTZ,
    last_error TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(site_id, name)
);

-- ============================================
-- CONTROL LOGS TABLE (time-series)
-- ============================================
CREATE TABLE IF NOT EXISTS control_logs (
    id BIGSERIAL PRIMARY KEY,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW(),

    -- Power readings
    total_load_kw NUMERIC,
    dg_power_kw NUMERIC,
    solar_output_kw NUMERIC,
    solar_limit_pct NUMERIC,

    -- Status
    safe_mode_active BOOLEAN DEFAULT FALSE,
    config_mode TEXT,

    -- Sync tracking
    synced_at TIMESTAMPTZ
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_control_logs_project_timestamp
ON control_logs(project_id, timestamp DESC);

-- ============================================
-- ALARMS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS alarms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,

    alarm_type TEXT NOT NULL,
    device_name TEXT,
    message TEXT,
    severity TEXT CHECK (severity IN ('warning', 'critical', 'info')),

    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by UUID,
    acknowledged_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_alarms_project_created
ON alarms(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alarms_unacknowledged
ON alarms(acknowledged) WHERE acknowledged = FALSE;

-- ============================================
-- INSERT DEFAULT DEVICE TEMPLATES
-- ============================================

-- Sungrow 150kW Inverter
INSERT INTO device_templates (template_id, name, device_type, brand, model, rated_power_kw, registers)
VALUES (
    'sungrow_150kw',
    'Sungrow SG150KTL-M',
    'inverter',
    'Sungrow',
    'SG150KTL-M',
    150,
    '[
        {"address": 5006, "name": "Inverter Control", "type": "holding", "scale": 1, "access": "write"},
        {"address": 5007, "name": "Power Limitation Switch", "type": "holding", "scale": 1, "access": "write"},
        {"address": 5008, "name": "Active Power Limit", "type": "holding", "scale": 1, "access": "write"},
        {"address": 5031, "name": "Active Power Output", "type": "input", "scale": 0.1, "access": "read"},
        {"address": 5038, "name": "Inverter State", "type": "input", "scale": 1, "access": "read"}
    ]'::JSONB
) ON CONFLICT (template_id) DO NOTHING;

-- Sungrow 110kW Inverter
INSERT INTO device_templates (template_id, name, device_type, brand, model, rated_power_kw, registers)
VALUES (
    'sungrow_110kw',
    'Sungrow SG110CX',
    'inverter',
    'Sungrow',
    'SG110CX',
    110,
    '[
        {"address": 5006, "name": "Inverter Control", "type": "holding", "scale": 1, "access": "write"},
        {"address": 5007, "name": "Power Limitation Switch", "type": "holding", "scale": 1, "access": "write"},
        {"address": 5008, "name": "Active Power Limit", "type": "holding", "scale": 1, "access": "write"},
        {"address": 5031, "name": "Active Power Output", "type": "input", "scale": 0.1, "access": "read"}
    ]'::JSONB
) ON CONFLICT (template_id) DO NOTHING;

-- Meatrol ME431 Power Meter
INSERT INTO device_templates (template_id, name, device_type, brand, model, rated_power_kw, registers)
VALUES (
    'meatrol_me431',
    'Meatrol ME431',
    'load_meter',
    'Meatrol',
    'ME431',
    NULL,
    '[
        {"address": 1000, "name": "Voltage Phase A", "type": "input", "datatype": "float32", "access": "read"},
        {"address": 1016, "name": "Current Phase A", "type": "input", "datatype": "float32", "access": "read"},
        {"address": 1032, "name": "Total Active Power", "type": "input", "datatype": "float32", "access": "read"},
        {"address": 1056, "name": "Power Factor", "type": "input", "datatype": "float32", "access": "read"}
    ]'::JSONB
) ON CONFLICT (template_id) DO NOTHING;

-- ComAp InteliGen 500 DG Controller
INSERT INTO device_templates (template_id, name, device_type, brand, model, rated_power_kw, registers)
VALUES (
    'comap_ig500',
    'ComAp InteliGen 500',
    'dg',
    'ComAp',
    'InteliGen 500',
    NULL,
    '[
        {"address": 1, "name": "Generator Active Power", "type": "input", "scale": 0.1, "access": "read"},
        {"address": 2, "name": "Generator Voltage", "type": "input", "scale": 0.1, "access": "read"},
        {"address": 3, "name": "Generator Current", "type": "input", "scale": 0.1, "access": "read"},
        {"address": 4, "name": "Engine State", "type": "input", "scale": 1, "access": "read"}
    ]'::JSONB
) ON CONFLICT (template_id) DO NOTHING;

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE alarms ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all data
CREATE POLICY "Allow authenticated read" ON projects
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated read" ON device_templates
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated read" ON site_devices
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated read" ON control_logs
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated read" ON alarms
    FOR SELECT TO authenticated USING (true);

-- Allow authenticated users to insert/update projects
CREATE POLICY "Allow authenticated insert" ON projects
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update" ON projects
    FOR UPDATE TO authenticated USING (true);

-- Allow authenticated users to manage project devices
CREATE POLICY "Allow authenticated insert" ON site_devices
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update" ON site_devices
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow authenticated delete" ON site_devices
    FOR DELETE TO authenticated USING (true);

-- Allow authenticated users to manage alarms
CREATE POLICY "Allow authenticated update" ON alarms
    FOR UPDATE TO authenticated USING (true);

-- Service role can do everything (for controller)
CREATE POLICY "Service role full access" ON projects
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON device_templates
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON site_devices
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON control_logs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON alarms
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- REALTIME SUBSCRIPTIONS
-- ============================================

-- Enable realtime for control_logs and alarms
ALTER PUBLICATION supabase_realtime ADD TABLE control_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE alarms;
