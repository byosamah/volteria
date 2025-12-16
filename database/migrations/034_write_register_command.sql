-- Migration 034: Add write_register command type
-- Extends control_commands table to support individual register writes
-- from the Remote Control page.
--
-- Command format:
-- {
--   "device_id": "uuid",
--   "device_name": "Inverter 1",
--   "register_address": 5008,
--   "register_name": "Power Limit",
--   "value": 75,
--   "unit": "%"
-- }

-- Drop and recreate the constraint to include write_register
ALTER TABLE control_commands
DROP CONSTRAINT IF EXISTS valid_command_type;

ALTER TABLE control_commands
ADD CONSTRAINT valid_command_type CHECK (
  command_type IN (
    'set_power_limit',
    'set_dg_reserve',
    'emergency_stop',
    'resume_operations',
    'write_register'
  )
);

-- Update the column comment to reflect new command type
COMMENT ON COLUMN control_commands.command_type IS
  'Type of command: set_power_limit, set_dg_reserve, emergency_stop, resume_operations, write_register';
