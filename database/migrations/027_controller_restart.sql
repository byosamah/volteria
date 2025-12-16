-- Migration 027: Controller Restart Command Support
--
-- Adds columns to track pending restart requests for controllers.
-- The controller software will check pending_restart and execute
-- a system restart when true.

-- Add restart tracking columns
ALTER TABLE controllers
ADD COLUMN IF NOT EXISTS pending_restart BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS restart_requested_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS restart_requested_by UUID REFERENCES users(id);

-- Index for finding controllers with pending restarts
CREATE INDEX IF NOT EXISTS idx_controllers_pending_restart
  ON controllers(pending_restart) WHERE pending_restart = TRUE;

-- Comments
COMMENT ON COLUMN controllers.pending_restart IS 'Flag set by admin to request controller restart';
COMMENT ON COLUMN controllers.restart_requested_at IS 'When the restart was requested';
COMMENT ON COLUMN controllers.restart_requested_by IS 'User who requested the restart';
