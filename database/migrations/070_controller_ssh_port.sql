-- ============================================
-- Migration: 070_controller_ssh_port
-- Adds SSH port column for reverse SSH tunnel
--
-- Each controller gets a unique SSH port for remote access via
-- the central server (159.223.224.203). Port range: 10000-20000
-- ============================================

-- Add ssh_port column
ALTER TABLE controllers
ADD COLUMN IF NOT EXISTS ssh_port INTEGER;

-- Add unique constraint to prevent port conflicts
ALTER TABLE controllers
ADD CONSTRAINT controllers_ssh_port_unique UNIQUE (ssh_port);

-- Add check constraint for valid port range
ALTER TABLE controllers
ADD CONSTRAINT controllers_ssh_port_range CHECK (ssh_port IS NULL OR (ssh_port >= 10000 AND ssh_port <= 20000));

-- Add comment explaining the field
COMMENT ON COLUMN controllers.ssh_port IS 'Unique SSH tunnel port for remote access via central server (159.223.224.203). Range: 10000-20000. Set by setup script.';
