-- ============================================
-- Solar Diesel Hybrid Controller - Sample Project
-- Migration: 003_sample_project
--
-- This creates a sample project configuration
-- for testing and demonstration purposes.
-- ============================================

-- ============================================
-- 1. CREATE SAMPLE SUPER ADMIN USER
-- ============================================

-- Create super admin user (password should be set via Supabase Auth)
INSERT INTO users (
    id,
    email,
    role,
    full_name,
    is_active
) VALUES (
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'admin@solardiesel.local',
    'super_admin',
    'System Administrator',
    TRUE
) ON CONFLICT (email) DO NOTHING;

-- ============================================
-- 2. CREATE SAMPLE PROJECT (Site)
-- ============================================

-- Stone Crushing Site 1 - UAE
INSERT INTO projects (
    id,
    name,
    location,
    description,

    -- Controller registration
    controller_serial_number,
    controller_hardware_type,
    controller_firmware_version,
    controller_status,

    -- Control settings
    control_interval_ms,
    dg_reserve_kw,
    operation_mode,

    -- Logging settings
    logging_local_interval_ms,
    logging_cloud_interval_ms,
    logging_local_retention_days,

    -- Safe mode settings
    safe_mode_enabled,
    safe_mode_type,
    safe_mode_timeout_s,
    safe_mode_rolling_window_min,
    safe_mode_threshold_pct,

    -- Tracking
    created_by,
    is_active
) VALUES (
    'b0000000-0000-0000-0000-000000000001'::uuid,
    'Stone Crushing Site 1',
    'UAE',
    'Stone crushing facility with 8x 800kVA DGs and 150kW solar system',

    -- Controller registration
    'RPI5-2024-001',
    'raspberry_pi_5',
    '1.0.0',
    'offline',  -- Will be 'online' when controller starts sending heartbeats

    -- Control settings
    1000,       -- 1 second control loop
    50.0,       -- 50 kW DG reserve
    'zero_dg_reverse',

    -- Logging settings
    1000,       -- Log locally every 1 second
    5000,       -- Push to cloud every 5 seconds
    7,          -- Keep local data for 7 days

    -- Safe mode settings
    TRUE,
    'rolling_average',
    30,         -- 30 second timeout
    3,          -- 3 minute rolling window
    80.0,       -- 80% threshold

    -- Tracking
    'a0000000-0000-0000-0000-000000000001'::uuid,
    TRUE
) ON CONFLICT (controller_serial_number) DO UPDATE SET
    name = EXCLUDED.name,
    location = EXCLUDED.location,
    description = EXCLUDED.description,
    updated_at = NOW();

-- ============================================
-- 3. ADD PROJECT DEVICES
-- ============================================

-- Helper: Get template IDs
-- We need to reference templates by their template_id

-- ─────────────────────────────────────────────
-- LOAD METERS (Meatrol ME431 via RTU Gateway)
-- ─────────────────────────────────────────────

-- Load Meter A
INSERT INTO project_devices (
    id,
    project_id,
    template_id,
    name,
    protocol,
    gateway_ip,
    gateway_port,
    slave_id,
    enabled
) VALUES (
    'c0000000-0000-0000-0000-000000000001'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid,
    (SELECT id FROM device_templates WHERE template_id = 'meatrol_me431'),
    'Load Meter A',
    'rtu_gateway',
    '192.168.1.1',
    502,
    2,
    TRUE
) ON CONFLICT (project_id, name) DO UPDATE SET
    gateway_ip = EXCLUDED.gateway_ip,
    gateway_port = EXCLUDED.gateway_port,
    slave_id = EXCLUDED.slave_id,
    updated_at = NOW();

-- Load Meter B
INSERT INTO project_devices (
    id,
    project_id,
    template_id,
    name,
    protocol,
    gateway_ip,
    gateway_port,
    slave_id,
    enabled
) VALUES (
    'c0000000-0000-0000-0000-000000000002'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid,
    (SELECT id FROM device_templates WHERE template_id = 'meatrol_me431'),
    'Load Meter B',
    'rtu_gateway',
    '192.168.1.1',
    502,
    3,
    TRUE
) ON CONFLICT (project_id, name) DO UPDATE SET
    gateway_ip = EXCLUDED.gateway_ip,
    gateway_port = EXCLUDED.gateway_port,
    slave_id = EXCLUDED.slave_id,
    updated_at = NOW();

-- ─────────────────────────────────────────────
-- SOLAR INVERTER (Sungrow 150kW via RTU Gateway)
-- ─────────────────────────────────────────────

INSERT INTO project_devices (
    id,
    project_id,
    template_id,
    name,
    protocol,
    gateway_ip,
    gateway_port,
    slave_id,
    rated_power_kw,
    enabled
) VALUES (
    'c0000000-0000-0000-0000-000000000003'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid,
    (SELECT id FROM device_templates WHERE template_id = 'sungrow_150kw'),
    'Solar Inverter 1',
    'rtu_gateway',
    '192.168.1.1',
    502,
    1,
    150.0,
    TRUE
) ON CONFLICT (project_id, name) DO UPDATE SET
    gateway_ip = EXCLUDED.gateway_ip,
    gateway_port = EXCLUDED.gateway_port,
    slave_id = EXCLUDED.slave_id,
    rated_power_kw = EXCLUDED.rated_power_kw,
    updated_at = NOW();

-- ─────────────────────────────────────────────
-- DIESEL GENERATORS (ComAp IG500 via Direct TCP)
-- ─────────────────────────────────────────────

-- DG-1
INSERT INTO project_devices (
    id,
    project_id,
    template_id,
    name,
    protocol,
    ip_address,
    port,
    slave_id,
    rated_power_kva,
    enabled
) VALUES (
    'c0000000-0000-0000-0000-000000000010'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid,
    (SELECT id FROM device_templates WHERE template_id = 'comap_ig500'),
    'DG-1',
    'tcp',
    '192.168.1.30',
    502,
    1,
    800.0,
    TRUE
) ON CONFLICT (project_id, name) DO UPDATE SET
    ip_address = EXCLUDED.ip_address,
    port = EXCLUDED.port,
    slave_id = EXCLUDED.slave_id,
    rated_power_kva = EXCLUDED.rated_power_kva,
    updated_at = NOW();

-- DG-2
INSERT INTO project_devices (
    id,
    project_id,
    template_id,
    name,
    protocol,
    ip_address,
    port,
    slave_id,
    rated_power_kva,
    enabled
) VALUES (
    'c0000000-0000-0000-0000-000000000011'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid,
    (SELECT id FROM device_templates WHERE template_id = 'comap_ig500'),
    'DG-2',
    'tcp',
    '192.168.1.31',
    502,
    1,
    800.0,
    TRUE
) ON CONFLICT (project_id, name) DO UPDATE SET
    ip_address = EXCLUDED.ip_address,
    port = EXCLUDED.port,
    slave_id = EXCLUDED.slave_id,
    rated_power_kva = EXCLUDED.rated_power_kva,
    updated_at = NOW();

-- DG-3
INSERT INTO project_devices (
    id,
    project_id,
    template_id,
    name,
    protocol,
    ip_address,
    port,
    slave_id,
    rated_power_kva,
    enabled
) VALUES (
    'c0000000-0000-0000-0000-000000000012'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid,
    (SELECT id FROM device_templates WHERE template_id = 'comap_ig500'),
    'DG-3',
    'tcp',
    '192.168.1.32',
    502,
    1,
    800.0,
    TRUE
) ON CONFLICT (project_id, name) DO UPDATE SET
    ip_address = EXCLUDED.ip_address,
    port = EXCLUDED.port,
    slave_id = EXCLUDED.slave_id,
    rated_power_kva = EXCLUDED.rated_power_kva,
    updated_at = NOW();

-- DG-4
INSERT INTO project_devices (
    id,
    project_id,
    template_id,
    name,
    protocol,
    ip_address,
    port,
    slave_id,
    rated_power_kva,
    enabled
) VALUES (
    'c0000000-0000-0000-0000-000000000013'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid,
    (SELECT id FROM device_templates WHERE template_id = 'comap_ig500'),
    'DG-4',
    'tcp',
    '192.168.1.33',
    502,
    1,
    800.0,
    TRUE
) ON CONFLICT (project_id, name) DO UPDATE SET
    ip_address = EXCLUDED.ip_address,
    port = EXCLUDED.port,
    slave_id = EXCLUDED.slave_id,
    rated_power_kva = EXCLUDED.rated_power_kva,
    updated_at = NOW();

-- DG-5
INSERT INTO project_devices (
    id,
    project_id,
    template_id,
    name,
    protocol,
    ip_address,
    port,
    slave_id,
    rated_power_kva,
    enabled
) VALUES (
    'c0000000-0000-0000-0000-000000000014'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid,
    (SELECT id FROM device_templates WHERE template_id = 'comap_ig500'),
    'DG-5',
    'tcp',
    '192.168.1.34',
    502,
    1,
    800.0,
    TRUE
) ON CONFLICT (project_id, name) DO UPDATE SET
    ip_address = EXCLUDED.ip_address,
    port = EXCLUDED.port,
    slave_id = EXCLUDED.slave_id,
    rated_power_kva = EXCLUDED.rated_power_kva,
    updated_at = NOW();

-- DG-6
INSERT INTO project_devices (
    id,
    project_id,
    template_id,
    name,
    protocol,
    ip_address,
    port,
    slave_id,
    rated_power_kva,
    enabled
) VALUES (
    'c0000000-0000-0000-0000-000000000015'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid,
    (SELECT id FROM device_templates WHERE template_id = 'comap_ig500'),
    'DG-6',
    'tcp',
    '192.168.1.35',
    502,
    1,
    800.0,
    TRUE
) ON CONFLICT (project_id, name) DO UPDATE SET
    ip_address = EXCLUDED.ip_address,
    port = EXCLUDED.port,
    slave_id = EXCLUDED.slave_id,
    rated_power_kva = EXCLUDED.rated_power_kva,
    updated_at = NOW();

-- DG-7
INSERT INTO project_devices (
    id,
    project_id,
    template_id,
    name,
    protocol,
    ip_address,
    port,
    slave_id,
    rated_power_kva,
    enabled
) VALUES (
    'c0000000-0000-0000-0000-000000000016'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid,
    (SELECT id FROM device_templates WHERE template_id = 'comap_ig500'),
    'DG-7',
    'tcp',
    '192.168.1.36',
    502,
    1,
    800.0,
    TRUE
) ON CONFLICT (project_id, name) DO UPDATE SET
    ip_address = EXCLUDED.ip_address,
    port = EXCLUDED.port,
    slave_id = EXCLUDED.slave_id,
    rated_power_kva = EXCLUDED.rated_power_kva,
    updated_at = NOW();

-- DG-8
INSERT INTO project_devices (
    id,
    project_id,
    template_id,
    name,
    protocol,
    ip_address,
    port,
    slave_id,
    rated_power_kva,
    enabled
) VALUES (
    'c0000000-0000-0000-0000-000000000017'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid,
    (SELECT id FROM device_templates WHERE template_id = 'comap_ig500'),
    'DG-8',
    'tcp',
    '192.168.1.37',
    502,
    1,
    800.0,
    TRUE
) ON CONFLICT (project_id, name) DO UPDATE SET
    ip_address = EXCLUDED.ip_address,
    port = EXCLUDED.port,
    slave_id = EXCLUDED.slave_id,
    rated_power_kva = EXCLUDED.rated_power_kva,
    updated_at = NOW();

-- ============================================
-- 4. ASSIGN SUPER ADMIN TO PROJECT
-- ============================================

INSERT INTO user_projects (
    user_id,
    project_id,
    can_edit,
    can_control,
    assigned_by
) VALUES (
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid,
    TRUE,
    TRUE,
    'a0000000-0000-0000-0000-000000000001'::uuid
) ON CONFLICT (user_id, project_id) DO NOTHING;

-- ============================================
-- 5. VERIFICATION QUERIES
-- ============================================

-- Uncomment to verify the setup:

-- Show project with device counts
-- SELECT
--     p.name AS project_name,
--     p.location,
--     p.controller_serial_number,
--     p.dg_reserve_kw,
--     COUNT(pd.id) AS device_count
-- FROM projects p
-- LEFT JOIN project_devices pd ON p.id = pd.project_id
-- GROUP BY p.id;

-- Show all devices for the project
-- SELECT
--     pd.name AS device_name,
--     dt.device_type,
--     dt.brand,
--     dt.model,
--     pd.protocol,
--     COALESCE(pd.ip_address, pd.gateway_ip) AS connection_ip,
--     pd.slave_id
-- FROM project_devices pd
-- JOIN device_templates dt ON pd.template_id = dt.id
-- WHERE pd.project_id = 'b0000000-0000-0000-0000-000000000001'::uuid
-- ORDER BY dt.device_type, pd.name;

