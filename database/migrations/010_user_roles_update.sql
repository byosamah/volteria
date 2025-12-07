-- ============================================
-- Migration: 010_user_roles_update
-- Updates user roles to include new hierarchy
--
-- New Role Hierarchy:
-- super_admin (level 5) - Full system access
-- backend_admin (level 4) - Backend operations, hardware management
-- enterprise_admin (level 3) - Enterprise-scoped admin
-- configurator (level 2) - Project-level edit
-- viewer (level 1) - Read-only
-- ============================================

-- First, update the CHECK constraint on the role column
-- We need to drop and recreate it

-- Drop the existing constraint (if it exists)
DO $$
BEGIN
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
EXCEPTION
    WHEN undefined_object THEN
        NULL;  -- Constraint doesn't exist, continue
END $$;

-- Add the new constraint with additional roles
ALTER TABLE users
ADD CONSTRAINT users_role_check
CHECK (role IN ('super_admin', 'backend_admin', 'enterprise_admin', 'admin', 'configurator', 'viewer'));

-- Note: 'admin' is kept for backwards compatibility
-- New installations should use 'enterprise_admin' instead

-- ============================================
-- Role Descriptions:
--
-- super_admin:
--   - Full system access
--   - Can create any user
--   - Can manage all enterprises
--   - Can access all backend functions
--
-- backend_admin:
--   - Backend operations (no enterprise restrictions)
--   - Manages approved hardware list
--   - Manages controller master list
--   - Cannot create super_admins
--
-- enterprise_admin:
--   - Full access within their enterprise
--   - Can create users within enterprise
--   - Can manage all projects in enterprise
--   - Can claim controllers for enterprise
--
-- admin (legacy, same as enterprise_admin):
--   - Kept for backwards compatibility
--   - Treated as enterprise_admin
--
-- configurator:
--   - Can edit assigned projects
--   - Can send remote commands
--   - Cannot create users
--
-- viewer:
--   - Read-only access
--   - Can view logs and dashboards
--   - Can download data
-- ============================================

-- Comments
COMMENT ON COLUMN users.role IS 'User role: super_admin, backend_admin, enterprise_admin, admin (legacy), configurator, viewer';

-- ============================================
-- Create a view for role hierarchy
-- Useful for permission checks
-- ============================================

CREATE OR REPLACE VIEW user_role_levels AS
SELECT
    id,
    email,
    role,
    enterprise_id,
    CASE role
        WHEN 'super_admin' THEN 5
        WHEN 'backend_admin' THEN 4
        WHEN 'enterprise_admin' THEN 3
        WHEN 'admin' THEN 3  -- Legacy, same as enterprise_admin
        WHEN 'configurator' THEN 2
        WHEN 'viewer' THEN 1
        ELSE 0
    END AS role_level
FROM users;

COMMENT ON VIEW user_role_levels IS 'Users with their role hierarchy level (higher = more permissions)';
