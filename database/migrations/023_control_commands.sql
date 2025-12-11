-- Migration 023: Control Commands Table
-- ⚠️ PHASE 3 - Remote Control UI
--
-- Creates a table to track all remote control commands sent to sites.
-- This provides an audit trail of who did what and when.
--
-- Commands include:
-- - set_power_limit: Adjust inverter power limit (0-100%)
-- - set_dg_reserve: Adjust DG reserve in kW
-- - emergency_stop: Set all inverters to 0%
-- - resume_operations: Restore normal operation (100%)

-- Create control_commands table
CREATE TABLE IF NOT EXISTS control_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which site this command is for
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Command details
  command_type VARCHAR(50) NOT NULL,  -- set_power_limit, set_dg_reserve, emergency_stop, resume_operations
  command_value JSONB NOT NULL,        -- { power_limit_pct: 50 } or { dg_reserve_kw: 10 }

  -- Command status lifecycle
  status VARCHAR(20) NOT NULL DEFAULT 'queued',  -- queued, sent, executed, failed
  error_message TEXT,                            -- Error message if failed

  -- Who executed this command (references users table)
  executed_by UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at TIMESTAMPTZ,  -- When the controller confirmed execution

  -- Constraint: valid command types
  CONSTRAINT valid_command_type CHECK (
    command_type IN ('set_power_limit', 'set_dg_reserve', 'emergency_stop', 'resume_operations')
  ),

  -- Constraint: valid status values
  CONSTRAINT valid_status CHECK (
    status IN ('queued', 'sent', 'executed', 'failed')
  )
);

-- Index for fast lookups by site (most common query)
CREATE INDEX IF NOT EXISTS idx_control_commands_site
  ON control_commands(site_id, created_at DESC);

-- Index for lookups by project
CREATE INDEX IF NOT EXISTS idx_control_commands_project
  ON control_commands(project_id, created_at DESC);

-- Index for lookups by user (audit trail)
CREATE INDEX IF NOT EXISTS idx_control_commands_user
  ON control_commands(executed_by, created_at DESC);

-- Index for filtering by status (find queued commands)
CREATE INDEX IF NOT EXISTS idx_control_commands_status
  ON control_commands(status) WHERE status IN ('queued', 'sent');

-- Enable Row Level Security
ALTER TABLE control_commands ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for re-running migration)
DROP POLICY IF EXISTS "Users can view commands for their projects" ON control_commands;
DROP POLICY IF EXISTS "Users can create commands if they have control permission" ON control_commands;
DROP POLICY IF EXISTS "System can update command status" ON control_commands;

-- RLS Policy: Users can view commands for sites they have access to
-- This policy allows viewing if:
-- 1. User is a super_admin or backend_admin (full access)
-- 2. User has project assignment for this command's project
CREATE POLICY "Users can view commands for their projects"
  ON control_commands
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND (
        u.role IN ('super_admin', 'backend_admin')
        OR EXISTS (
          SELECT 1 FROM user_projects up
          WHERE up.user_id = auth.uid()
          AND up.project_id = control_commands.project_id
        )
      )
    )
  );

-- RLS Policy: Users can insert commands if they have can_control permission
-- This policy allows inserting if:
-- 1. User is a super_admin, backend_admin, or admin (full control)
-- 2. User has project assignment with can_control = true
CREATE POLICY "Users can create commands if they have control permission"
  ON control_commands
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND (
        u.role IN ('super_admin', 'backend_admin', 'admin')
        OR EXISTS (
          SELECT 1 FROM user_projects up
          WHERE up.user_id = auth.uid()
          AND up.project_id = control_commands.project_id
          AND up.can_control = true
        )
      )
    )
  );

-- RLS Policy: Only system can update commands (for status changes from controller)
-- In practice, status updates come from the backend with service role key
CREATE POLICY "System can update command status"
  ON control_commands
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('super_admin', 'backend_admin')
    )
  );

-- Function to automatically set executed_by from auth context
CREATE OR REPLACE FUNCTION set_command_executed_by()
RETURNS TRIGGER AS $$
BEGIN
  -- Set executed_by to current authenticated user if not already set
  IF NEW.executed_by IS NULL THEN
    NEW.executed_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to set executed_by on insert
DROP TRIGGER IF EXISTS set_command_executed_by_trigger ON control_commands;
CREATE TRIGGER set_command_executed_by_trigger
  BEFORE INSERT ON control_commands
  FOR EACH ROW
  EXECUTE FUNCTION set_command_executed_by();

-- Enable real-time for this table (for command history component)
-- Note: Use DO block to avoid error if already added
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE control_commands;
EXCEPTION
  WHEN duplicate_object THEN
    -- Table already in publication, ignore
    NULL;
END $$;

COMMENT ON TABLE control_commands IS 'Audit trail of all remote control commands sent to site controllers';
COMMENT ON COLUMN control_commands.command_type IS 'Type of command: set_power_limit, set_dg_reserve, emergency_stop, resume_operations';
COMMENT ON COLUMN control_commands.command_value IS 'JSON object with command parameters, e.g., { power_limit_pct: 50 }';
COMMENT ON COLUMN control_commands.status IS 'Command lifecycle: queued → sent → executed (or failed)';
