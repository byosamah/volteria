-- Migration: Fix SECURITY DEFINER views to use SECURITY INVOKER
-- Applied: 2026-01-21
-- Purpose: Address Supabase linter warnings for security definer views

-- Fix 1: audit_logs_summary view
DROP VIEW IF EXISTS audit_logs_summary;

CREATE VIEW audit_logs_summary WITH (security_invoker = true) AS
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

GRANT SELECT ON audit_logs_summary TO authenticated;

-- Fix 2: user_role_levels view
DROP VIEW IF EXISTS user_role_levels;

CREATE VIEW user_role_levels WITH (security_invoker = true) AS
SELECT
    id,
    email,
    role,
    enterprise_id,
    CASE role
        WHEN 'super_admin' THEN 5
        WHEN 'backend_admin' THEN 4
        WHEN 'enterprise_admin' THEN 3
        WHEN 'admin' THEN 3
        WHEN 'configurator' THEN 2
        WHEN 'viewer' THEN 1
        ELSE 0
    END AS role_level
FROM users;

GRANT SELECT ON user_role_levels TO authenticated;
