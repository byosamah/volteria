-- Migration: 060_controller_ssh_access.sql
-- Description: Add SSH access columns to controllers table for remote access
-- Created: 2026-01-10

-- ============================================================================
-- Controller SSH Access
-- Allows Claude Code and admins to SSH into controllers via reverse tunnel
-- ============================================================================

-- Add SSH tunnel port column
-- Each controller has a unique port on the central server (159.223.224.203)
-- The controller maintains a reverse SSH tunnel to this port
ALTER TABLE controllers
ADD COLUMN IF NOT EXISTS ssh_tunnel_port INTEGER;

-- Add SSH username column
ALTER TABLE controllers
ADD COLUMN IF NOT EXISTS ssh_username TEXT;

-- Add SSH password column
-- Note: In production, this should be encrypted or use key-based auth only
-- For now, storing plaintext for simplicity during development
ALTER TABLE controllers
ADD COLUMN IF NOT EXISTS ssh_password TEXT;

-- Add SSH tunnel status column
-- Indicates if the reverse tunnel is currently active
ALTER TABLE controllers
ADD COLUMN IF NOT EXISTS ssh_tunnel_active BOOLEAN DEFAULT FALSE;

-- Add SSH key fingerprint for verification
ALTER TABLE controllers
ADD COLUMN IF NOT EXISTS ssh_host_key_fingerprint TEXT;

-- Add last SSH connection timestamp
ALTER TABLE controllers
ADD COLUMN IF NOT EXISTS ssh_last_connected_at TIMESTAMPTZ;

-- Create unique constraint on ssh_tunnel_port to prevent conflicts
-- Each controller must have a unique port
CREATE UNIQUE INDEX IF NOT EXISTS idx_controllers_ssh_tunnel_port
ON controllers(ssh_tunnel_port)
WHERE ssh_tunnel_port IS NOT NULL;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON COLUMN controllers.ssh_tunnel_port IS 'Port on central server (159.223.224.203) that tunnels to this controller SSH';
COMMENT ON COLUMN controllers.ssh_username IS 'SSH username for controller access';
COMMENT ON COLUMN controllers.ssh_password IS 'SSH password (should be encrypted in production)';
COMMENT ON COLUMN controllers.ssh_tunnel_active IS 'Whether the reverse SSH tunnel is currently active';
COMMENT ON COLUMN controllers.ssh_host_key_fingerprint IS 'SSH host key fingerprint for verification';
COMMENT ON COLUMN controllers.ssh_last_connected_at IS 'Last time an SSH connection was established';
