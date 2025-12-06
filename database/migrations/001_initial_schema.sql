-- ============================================
-- Solar Diesel Hybrid Controller - Database Schema
-- Migration: 001_initial_schema
--
-- This creates all the core tables for the system.
-- Run this in Supabase SQL Editor or via migrations.
-- ============================================

-- Enable UUID extension (usually already enabled in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. USERS TABLE
-- Stores user accounts with role-based access
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,  -- Managed by Supabase Auth, can be null

    -- User role determines permissions
    -- super_admin: Full access, can create any user
    -- admin: Can create users (except admin/super), manage all projects
    -- configurator: Can edit assigned projects, remote control
    -- viewer: Can view logs, download data
    role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'configurator', 'viewer')),

    -- Profile info
    full_name TEXT,
    phone TEXT,

    -- Tracking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,

    -- Status
    is_active BOOLEAN DEFAULT TRUE
);

-- Index for faster email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============================================
-- 2. DEVICE TEMPLATES TABLE
-- Reusable device definitions with Modbus registers
-- These are shared across ALL projects
-- ============================================
CREATE TABLE IF NOT EXISTS device_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Template identification
    template_id TEXT UNIQUE NOT NULL,  -- e.g., "sungrow_150kw"
    name TEXT NOT NULL,                 -- e.g., "Sungrow SG150KTL-M"

    -- Device classification
    device_type TEXT NOT NULL CHECK (device_type IN ('inverter', 'dg', 'load_meter')),
    operation TEXT NOT NULL CHECK (operation IN ('solar', 'dg', 'meter')),

    -- Manufacturer info
    brand TEXT NOT NULL,
    model TEXT NOT NULL,

    -- Specifications (optional)
    rated_power_kw NUMERIC,
    rated_power_kva NUMERIC,

    -- Modbus register definitions (JSON array)
    -- Each register: {address, name, description, scale, access, datatype}
    registers JSONB NOT NULL DEFAULT '[]',

    -- Additional specifications
    specifications JSONB DEFAULT '{}',

    -- Tracking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Status
    is_active BOOLEAN DEFAULT TRUE
);

-- Index for faster template lookups
CREATE INDEX IF NOT EXISTS idx_device_templates_template_id ON device_templates(template_id);
CREATE INDEX IF NOT EXISTS idx_device_templates_device_type ON device_templates(device_type);

-- ============================================
-- 3. PROJECTS TABLE (Sites)
-- Each project represents a physical site
-- ============================================
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Site identification
    name TEXT NOT NULL,
    location TEXT,
    description TEXT,

    -- Site controller info
    controller_serial_number TEXT UNIQUE,
    controller_hardware_type TEXT DEFAULT 'raspberry_pi_5',
    controller_firmware_version TEXT,
    controller_registered_at TIMESTAMPTZ,
    controller_last_seen TIMESTAMPTZ,
    controller_status TEXT DEFAULT 'offline' CHECK (controller_status IN ('online', 'offline', 'error')),

    -- ============================================
    -- CONTROL SETTINGS
    -- ============================================
    control_interval_ms INTEGER DEFAULT 1000,
    dg_reserve_kw NUMERIC DEFAULT 50 CHECK (dg_reserve_kw >= 0),  -- Cannot be negative!
    operation_mode TEXT DEFAULT 'zero_dg_reverse',

    -- ============================================
    -- LOGGING SETTINGS
    -- Local retention only - cloud retention managed by platform
    -- ============================================
    logging_local_interval_ms INTEGER DEFAULT 1000,
    logging_cloud_interval_ms INTEGER DEFAULT 5000,
    logging_local_retention_days INTEGER DEFAULT 7,

    -- ============================================
    -- SAFE MODE SETTINGS
    -- ============================================
    safe_mode_enabled BOOLEAN DEFAULT TRUE,
    safe_mode_type TEXT DEFAULT 'rolling_average' CHECK (safe_mode_type IN ('time_based', 'rolling_average')),
    safe_mode_timeout_s INTEGER DEFAULT 30,
    safe_mode_rolling_window_min INTEGER DEFAULT 3,
    safe_mode_threshold_pct NUMERIC DEFAULT 80,

    -- Tracking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Status
    is_active BOOLEAN DEFAULT TRUE
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_projects_controller_serial ON projects(controller_serial_number);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(controller_status);

-- ============================================
-- 4. PROJECT DEVICES TABLE
-- Devices configured for each project/site
-- Connection details are per-site (not in template)
-- ============================================
CREATE TABLE IF NOT EXISTS project_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Link to project and template
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES device_templates(id),

    -- Device naming
    name TEXT NOT NULL,  -- e.g., "DG-1", "Load Meter A", "Solar Inverter 1"

    -- ============================================
    -- CONNECTION DETAILS (per-site, not in template!)
    -- ============================================

    -- Protocol type determines which fields are mandatory
    protocol TEXT NOT NULL CHECK (protocol IN ('tcp', 'rtu_gateway', 'rtu_direct')),

    -- For TCP protocol (direct Modbus TCP)
    ip_address TEXT,           -- Mandatory for tcp
    port INTEGER DEFAULT 502,

    -- For RTU via Gateway protocol
    gateway_ip TEXT,           -- Mandatory for rtu_gateway
    gateway_port INTEGER DEFAULT 502,

    -- For Direct RTU protocol
    serial_port TEXT,          -- Mandatory for rtu_direct
    baudrate INTEGER DEFAULT 9600,

    -- Modbus slave ID (required for all protocols)
    slave_id INTEGER NOT NULL,

    -- ============================================
    -- OPTIONAL OVERRIDES
    -- These override values from the template
    -- ============================================
    rated_power_kw NUMERIC,
    rated_power_kva NUMERIC,

    -- Device status (auto-updated by controller)
    last_seen TIMESTAMPTZ,
    is_online BOOLEAN DEFAULT FALSE,
    last_error TEXT,

    -- Tracking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Status
    enabled BOOLEAN DEFAULT TRUE,

    -- Ensure unique device names within a project
    UNIQUE(project_id, name)
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_project_devices_project ON project_devices(project_id);
CREATE INDEX IF NOT EXISTS idx_project_devices_template ON project_devices(template_id);
CREATE INDEX IF NOT EXISTS idx_project_devices_protocol ON project_devices(protocol);

-- ============================================
-- 5. USER-PROJECT ASSIGNMENTS TABLE
-- Links users to projects with specific permissions
-- ============================================
CREATE TABLE IF NOT EXISTS user_projects (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Permissions
    can_edit BOOLEAN DEFAULT FALSE,     -- Can modify project settings
    can_control BOOLEAN DEFAULT FALSE,  -- Can send remote commands

    -- Tracking
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id),

    PRIMARY KEY (user_id, project_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_projects_user ON user_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_user_projects_project ON user_projects(project_id);

-- ============================================
-- 6. CONTROL LOGS TABLE
-- Time-series data pushed from site controllers
-- ============================================
CREATE TABLE IF NOT EXISTS control_logs (
    id BIGSERIAL PRIMARY KEY,

    -- Link to project
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Timestamp (from controller, not insertion time)
    timestamp TIMESTAMPTZ NOT NULL,

    -- Power readings (kW)
    total_load_kw NUMERIC,
    dg_power_kw NUMERIC,
    solar_output_kw NUMERIC,

    -- Control state
    solar_limit_pct NUMERIC,
    available_headroom_kw NUMERIC,

    -- Status
    safe_mode_active BOOLEAN DEFAULT FALSE,
    config_mode TEXT,  -- 'meter_inverter', 'dg_inverter', 'full_system'

    -- Device counts
    load_meters_online INTEGER DEFAULT 0,
    inverters_online INTEGER DEFAULT 0,
    generators_online INTEGER DEFAULT 0,

    -- Raw data (optional, for debugging)
    raw_data JSONB
);

-- Indexes for time-series queries
CREATE INDEX IF NOT EXISTS idx_control_logs_project_time ON control_logs(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_control_logs_timestamp ON control_logs(timestamp DESC);

-- Partition hint: For high-volume data, consider partitioning by time
-- This can be done later when data grows

-- ============================================
-- 7. ALARMS TABLE
-- System alarms and notifications
-- ============================================
CREATE TABLE IF NOT EXISTS alarms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Link to project
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Alarm details
    alarm_type TEXT NOT NULL,
    -- Types: 'communication_lost', 'control_error', 'safe_mode_triggered',
    --        'not_reporting', 'controller_offline', 'write_failed', 'command_not_taken'

    device_name TEXT,      -- Which device triggered the alarm (if applicable)
    message TEXT NOT NULL,

    -- Severity
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),

    -- Acknowledgment
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,

    -- Resolution
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for alarm queries
CREATE INDEX IF NOT EXISTS idx_alarms_project ON alarms(project_id);
CREATE INDEX IF NOT EXISTS idx_alarms_severity ON alarms(severity);
CREATE INDEX IF NOT EXISTS idx_alarms_unacknowledged ON alarms(project_id, acknowledged) WHERE NOT acknowledged;
CREATE INDEX IF NOT EXISTS idx_alarms_created ON alarms(created_at DESC);

-- ============================================
-- 8. CONTROLLER HEARTBEATS TABLE
-- Tracks controller online status (heartbeat every 5 min)
-- ============================================
CREATE TABLE IF NOT EXISTS controller_heartbeats (
    id BIGSERIAL PRIMARY KEY,

    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Heartbeat timestamp
    timestamp TIMESTAMPTZ DEFAULT NOW(),

    -- Controller status snapshot
    firmware_version TEXT,
    uptime_seconds BIGINT,
    cpu_usage_pct NUMERIC,
    memory_usage_pct NUMERIC,
    disk_usage_pct NUMERIC,

    -- Network info
    ip_address TEXT,

    -- Additional info
    metadata JSONB DEFAULT '{}'
);

-- Index for heartbeat queries
CREATE INDEX IF NOT EXISTS idx_heartbeats_project_time ON controller_heartbeats(project_id, timestamp DESC);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Function to update 'updated_at' timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables with updated_at
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_device_templates_updated_at
    BEFORE UPDATE ON device_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_devices_updated_at
    BEFORE UPDATE ON project_devices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update project controller_last_seen from heartbeats
CREATE OR REPLACE FUNCTION update_controller_last_seen()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE projects
    SET
        controller_last_seen = NEW.timestamp,
        controller_status = 'online'
    WHERE id = NEW.project_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_controller_status_on_heartbeat
    AFTER INSERT ON controller_heartbeats
    FOR EACH ROW EXECUTE FUNCTION update_controller_last_seen();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- Enable for production use with Supabase Auth
-- ============================================

-- Enable RLS on all tables (uncomment for production)
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE project_devices ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_projects ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE control_logs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE alarms ENABLE ROW LEVEL SECURITY;

-- RLS policies would be added here based on user roles
-- Example: Users can only see projects they're assigned to

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE users IS 'User accounts with role-based access control';
COMMENT ON TABLE device_templates IS 'Reusable device definitions shared across projects';
COMMENT ON TABLE projects IS 'Physical sites with their controllers and settings';
COMMENT ON TABLE project_devices IS 'Devices configured for each site with connection details';
COMMENT ON TABLE user_projects IS 'User-to-project assignments with permissions';
COMMENT ON TABLE control_logs IS 'Time-series control data pushed from controllers';
COMMENT ON TABLE alarms IS 'System alarms and notifications';
COMMENT ON TABLE controller_heartbeats IS 'Controller heartbeat data for online status';

COMMENT ON COLUMN projects.dg_reserve_kw IS 'Minimum DG reserve power - cannot be negative';
COMMENT ON COLUMN project_devices.protocol IS 'tcp=direct Modbus TCP, rtu_gateway=RTU via TCP gateway, rtu_direct=direct RS485';
