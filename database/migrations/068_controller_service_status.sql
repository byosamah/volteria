-- Migration: 068_controller_service_status.sql
-- Description: Per-service health tracking for 5-layer controller architecture
-- Created: 2026-01-11

-- ============================================================================
-- Controller Service Status Table
-- Tracks health status of each service layer on controllers
-- ============================================================================

CREATE TABLE IF NOT EXISTS controller_service_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    controller_id UUID NOT NULL REFERENCES controllers_master(id) ON DELETE CASCADE,
    service_name TEXT NOT NULL CHECK (service_name IN (
        'system',   -- Layer 1: Heartbeat, OTA, health monitoring
        'config',   -- Layer 2: Sync, caching, versioning
        'device',   -- Layer 3: Modbus I/O, polling, writes
        'control',  -- Layer 4: Zero-feeding algorithm
        'logging'   -- Layer 5: Data logging, cloud sync, alarms
    )),
    status TEXT NOT NULL DEFAULT 'stopped' CHECK (status IN (
        'running',   -- Service is running normally
        'stopped',   -- Service is stopped
        'starting',  -- Service is starting up
        'error',     -- Service encountered an error
        'restarting' -- Service is restarting after failure
    )),
    uptime_seconds INTEGER DEFAULT 0,
    restart_count INTEGER DEFAULT 0,
    last_error TEXT,
    last_error_at TIMESTAMPTZ,
    health_check_url TEXT,
    pid INTEGER,
    memory_mb NUMERIC(10, 2),
    cpu_pct NUMERIC(5, 2),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Each controller can only have one entry per service
    UNIQUE(controller_id, service_name)
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Fast lookup by controller
CREATE INDEX idx_controller_service_status_controller
    ON controller_service_status(controller_id);

-- Fast lookup for error states
CREATE INDEX idx_controller_service_status_errors
    ON controller_service_status(controller_id, status)
    WHERE status = 'error';

-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE controller_service_status ENABLE ROW LEVEL SECURITY;

-- Super admins and backend admins can manage all service statuses
CREATE POLICY "Super/backend admins can manage all service statuses"
    ON controller_service_status
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('super_admin', 'backend_admin')
        )
    );

-- Users can view service status for controllers in their projects
CREATE POLICY "Users can view service status for their controllers"
    ON controller_service_status
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM controllers_master cm
            JOIN site_master_devices smd ON smd.controller_id = cm.id
            JOIN sites s ON s.id = smd.site_id
            JOIN user_projects up ON up.project_id = s.project_id
            WHERE cm.id = controller_service_status.controller_id
            AND up.user_id = auth.uid()
        )
    );

-- Service key can upsert status for its own controller
CREATE POLICY "Service key can update controller status"
    ON controller_service_status
    FOR ALL
    USING (
        -- Allow service role (used by controller) full access
        auth.jwt() ->> 'role' = 'service_role'
    );

-- ============================================================================
-- Triggers
-- ============================================================================

-- Update updated_at timestamp on changes
CREATE OR REPLACE FUNCTION update_controller_service_status_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_controller_service_status_updated_at
    BEFORE UPDATE ON controller_service_status
    FOR EACH ROW
    EXECUTE FUNCTION update_controller_service_status_updated_at();

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to get all service statuses for a controller
CREATE OR REPLACE FUNCTION get_controller_services(p_controller_id UUID)
RETURNS TABLE (
    service_name TEXT,
    status TEXT,
    uptime_seconds INTEGER,
    restart_count INTEGER,
    last_error TEXT,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        css.service_name,
        css.status,
        css.uptime_seconds,
        css.restart_count,
        css.last_error,
        css.updated_at
    FROM controller_service_status css
    WHERE css.controller_id = p_controller_id
    ORDER BY
        CASE css.service_name
            WHEN 'system' THEN 1
            WHEN 'config' THEN 2
            WHEN 'device' THEN 3
            WHEN 'control' THEN 4
            WHEN 'logging' THEN 5
        END;
END;
$$ LANGUAGE plpgsql;

-- Function to check if any service is in error state
CREATE OR REPLACE FUNCTION controller_has_service_error(p_controller_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM controller_service_status
        WHERE controller_id = p_controller_id
        AND status = 'error'
    );
END;
$$ LANGUAGE plpgsql;

-- Function to upsert service status (used by controller heartbeat)
CREATE OR REPLACE FUNCTION upsert_service_status(
    p_controller_id UUID,
    p_service_name TEXT,
    p_status TEXT,
    p_uptime_seconds INTEGER DEFAULT 0,
    p_restart_count INTEGER DEFAULT 0,
    p_last_error TEXT DEFAULT NULL,
    p_pid INTEGER DEFAULT NULL,
    p_memory_mb NUMERIC DEFAULT NULL,
    p_cpu_pct NUMERIC DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO controller_service_status (
        controller_id, service_name, status, uptime_seconds,
        restart_count, last_error, last_error_at, pid, memory_mb, cpu_pct
    )
    VALUES (
        p_controller_id, p_service_name, p_status, p_uptime_seconds,
        p_restart_count, p_last_error,
        CASE WHEN p_last_error IS NOT NULL THEN NOW() ELSE NULL END,
        p_pid, p_memory_mb, p_cpu_pct
    )
    ON CONFLICT (controller_id, service_name)
    DO UPDATE SET
        status = EXCLUDED.status,
        uptime_seconds = EXCLUDED.uptime_seconds,
        restart_count = EXCLUDED.restart_count,
        last_error = COALESCE(EXCLUDED.last_error, controller_service_status.last_error),
        last_error_at = CASE
            WHEN EXCLUDED.last_error IS NOT NULL AND EXCLUDED.last_error != controller_service_status.last_error
            THEN NOW()
            ELSE controller_service_status.last_error_at
        END,
        pid = EXCLUDED.pid,
        memory_mb = EXCLUDED.memory_mb,
        cpu_pct = EXCLUDED.cpu_pct,
        updated_at = NOW()
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE controller_service_status IS 'Per-service health status for 5-layer controller architecture';
COMMENT ON COLUMN controller_service_status.service_name IS 'Service layer: system, config, device, control, logging';
COMMENT ON COLUMN controller_service_status.status IS 'Current service status: running, stopped, starting, error, restarting';
COMMENT ON COLUMN controller_service_status.uptime_seconds IS 'How long service has been running';
COMMENT ON COLUMN controller_service_status.restart_count IS 'Number of restarts since last deployment';
COMMENT ON COLUMN controller_service_status.last_error IS 'Most recent error message';
COMMENT ON COLUMN controller_service_status.pid IS 'Process ID on the controller';
COMMENT ON COLUMN controller_service_status.memory_mb IS 'Memory usage in MB';
COMMENT ON COLUMN controller_service_status.cpu_pct IS 'CPU usage percentage';
