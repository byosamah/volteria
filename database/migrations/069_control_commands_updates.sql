-- Migration 069: Update control_commands table for sync and reboot commands
-- Adds missing columns and relaxes constraints for new command types

-- Add controller_id column (nullable, for reboot commands)
ALTER TABLE control_commands
ADD COLUMN IF NOT EXISTS controller_id UUID REFERENCES controllers_master(id) ON DELETE CASCADE;

-- Add parameters column (alias for command_value, more intuitive name)
ALTER TABLE control_commands
ADD COLUMN IF NOT EXISTS parameters JSONB DEFAULT '{}';

-- Add created_by column (who initiated the command)
ALTER TABLE control_commands
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Add error_message column if not exists
ALTER TABLE control_commands
ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Drop the restrictive command_type constraint
ALTER TABLE control_commands
DROP CONSTRAINT IF EXISTS valid_command_type;

-- Drop the restrictive status constraint
ALTER TABLE control_commands
DROP CONSTRAINT IF EXISTS valid_status;

-- Make project_id nullable (sync_config uses site_id only)
ALTER TABLE control_commands
ALTER COLUMN project_id DROP NOT NULL;

-- Make command_value nullable (we use parameters now)
ALTER TABLE control_commands
ALTER COLUMN command_value DROP NOT NULL;

-- Create index for controller_id lookups (reboot commands)
CREATE INDEX IF NOT EXISTS idx_control_commands_controller
ON control_commands(controller_id, created_at DESC) WHERE controller_id IS NOT NULL;

-- Create index for pending commands
CREATE INDEX IF NOT EXISTS idx_control_commands_pending
ON control_commands(site_id, status) WHERE status = 'pending';

COMMENT ON COLUMN control_commands.controller_id IS 'Controller for reboot commands (NULL for site-level commands)';
COMMENT ON COLUMN control_commands.parameters IS 'Command parameters as JSON (e.g., {manual_sync: true})';
COMMENT ON COLUMN control_commands.created_by IS 'User who initiated the command';
