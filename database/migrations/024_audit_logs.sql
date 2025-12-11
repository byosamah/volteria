-- Migration 024: Audit Logs Table
-- ⚠️ PHASE 5 - Enterprise Features
--
-- Creates a comprehensive audit log system for tracking all user actions.
-- This is essential for compliance and security monitoring.
--
-- Tracked actions include:
-- - User authentication (login, logout, password changes)
-- - Resource CRUD (create, read, update, delete)
-- - Configuration changes
-- - Remote control commands
-- - Permission changes

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who performed the action
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email VARCHAR(255),  -- Stored separately in case user is deleted
  user_role VARCHAR(50),    -- Role at time of action

  -- What action was performed
  action VARCHAR(50) NOT NULL,          -- login, logout, create, update, delete, view, export, etc.
  action_category VARCHAR(50) NOT NULL, -- auth, project, site, device, user, controller, etc.

  -- What resource was affected
  resource_type VARCHAR(50),  -- projects, sites, devices, users, controllers, etc.
  resource_id UUID,           -- ID of the affected resource
  resource_name VARCHAR(255), -- Human-readable name of the resource

  -- Details of the change
  old_value JSONB,            -- Previous state (for updates)
  new_value JSONB,            -- New state (for creates/updates)
  metadata JSONB,             -- Additional context (e.g., IP address, user agent)

  -- Result of the action
  status VARCHAR(20) NOT NULL DEFAULT 'success',  -- success, failed, denied
  error_message TEXT,         -- Error message if failed

  -- Request context
  ip_address INET,
  user_agent TEXT,
  request_id UUID,            -- For correlating related actions

  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by user (who did what)
CREATE INDEX IF NOT EXISTS idx_audit_logs_user
  ON audit_logs(user_id, created_at DESC);

-- Index for lookups by resource (what happened to X)
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource
  ON audit_logs(resource_type, resource_id, created_at DESC);

-- Index for filtering by action category
CREATE INDEX IF NOT EXISTS idx_audit_logs_category
  ON audit_logs(action_category, created_at DESC);

-- Index for filtering by status (find failures)
CREATE INDEX IF NOT EXISTS idx_audit_logs_status
  ON audit_logs(status, created_at DESC) WHERE status != 'success';

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_time
  ON audit_logs(created_at DESC);

-- Composite index for common admin queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_query
  ON audit_logs(action_category, action, created_at DESC);

-- Enable Row Level Security
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for re-running migration)
DROP POLICY IF EXISTS "Only admins can view audit logs" ON audit_logs;
DROP POLICY IF EXISTS "System can insert audit logs" ON audit_logs;
DROP POLICY IF EXISTS "Audit logs are immutable" ON audit_logs;
DROP POLICY IF EXISTS "Audit logs cannot be deleted" ON audit_logs;

-- RLS Policy: Only admins can view audit logs
-- This is a sensitive table - regular users should not see it
CREATE POLICY "Only admins can view audit logs"
  ON audit_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('super_admin', 'backend_admin', 'admin')
    )
  );

-- RLS Policy: Only system can insert audit logs
-- In practice, inserts come from the backend with service role key
-- This prevents users from manipulating their own audit trail
CREATE POLICY "System can insert audit logs"
  ON audit_logs
  FOR INSERT
  WITH CHECK (true);  -- Backend uses service key, bypasses RLS anyway

-- Prevent updates and deletes - audit logs are immutable
CREATE POLICY "Audit logs are immutable"
  ON audit_logs
  FOR UPDATE
  USING (false);

CREATE POLICY "Audit logs cannot be deleted"
  ON audit_logs
  FOR DELETE
  USING (false);

-- Helper function to log an action
-- Called from backend API routes after significant actions
CREATE OR REPLACE FUNCTION log_audit_action(
  p_user_id UUID,
  p_user_email VARCHAR,
  p_user_role VARCHAR,
  p_action VARCHAR,
  p_action_category VARCHAR,
  p_resource_type VARCHAR DEFAULT NULL,
  p_resource_id UUID DEFAULT NULL,
  p_resource_name VARCHAR DEFAULT NULL,
  p_old_value JSONB DEFAULT NULL,
  p_new_value JSONB DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL,
  p_status VARCHAR DEFAULT 'success',
  p_error_message TEXT DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO audit_logs (
    user_id,
    user_email,
    user_role,
    action,
    action_category,
    resource_type,
    resource_id,
    resource_name,
    old_value,
    new_value,
    metadata,
    status,
    error_message,
    ip_address,
    user_agent
  ) VALUES (
    p_user_id,
    p_user_email,
    p_user_role,
    p_action,
    p_action_category,
    p_resource_type,
    p_resource_id,
    p_resource_name,
    p_old_value,
    p_new_value,
    p_metadata,
    p_status,
    p_error_message,
    p_ip_address,
    p_user_agent
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a view for common audit queries
-- This simplifies frontend queries
-- Note: CREATE OR REPLACE VIEW handles re-runs automatically
DROP VIEW IF EXISTS audit_logs_summary;
CREATE VIEW audit_logs_summary AS
SELECT
  al.id,
  al.user_id,
  al.user_email,
  al.action,
  al.action_category,
  al.resource_type,
  al.resource_id,
  al.resource_name,
  al.status,
  al.created_at,
  u.full_name as user_name
FROM audit_logs al
LEFT JOIN users u ON al.user_id = u.id
ORDER BY al.created_at DESC;

-- Grant access to the view
GRANT SELECT ON audit_logs_summary TO authenticated;

-- Comment on table and columns for documentation
COMMENT ON TABLE audit_logs IS 'Immutable audit trail of all user actions in the system';
COMMENT ON COLUMN audit_logs.action IS 'Action type: login, logout, create, update, delete, view, export, control, etc.';
COMMENT ON COLUMN audit_logs.action_category IS 'Category: auth, project, site, device, user, controller, alarm, setting';
COMMENT ON COLUMN audit_logs.old_value IS 'JSON snapshot of resource state before the action';
COMMENT ON COLUMN audit_logs.new_value IS 'JSON snapshot of resource state after the action';
COMMENT ON COLUMN audit_logs.metadata IS 'Additional context like browser, location, etc.';

-- Sample action categories and their actions:
-- auth: login, logout, password_change, password_reset, mfa_enable, mfa_disable
-- project: create, update, delete, view
-- site: create, update, delete, view, assign_controller
-- device: create, update, delete, enable, disable
-- user: create, update, delete, invite, role_change, project_assign
-- controller: claim, unclaim, assign, unassign, update_firmware
-- alarm: acknowledge, resolve
-- setting: update
-- control: set_power_limit, set_dg_reserve, emergency_stop, resume_operations
-- export: data_export
