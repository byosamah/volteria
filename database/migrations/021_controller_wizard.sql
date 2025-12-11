-- Migration: 021_controller_wizard.sql
-- Purpose: Add wizard tracking columns to controllers table for step-by-step setup

-- Add wizard tracking columns
ALTER TABLE controllers
ADD COLUMN IF NOT EXISTS wizard_step INTEGER,
ADD COLUMN IF NOT EXISTS wizard_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS test_results JSONB;

-- Add comments for documentation
COMMENT ON COLUMN controllers.wizard_step IS
'Current wizard step (1-7), NULL if wizard complete or not started';

COMMENT ON COLUMN controllers.wizard_started_at IS
'Timestamp when wizard was first started for this controller';

COMMENT ON COLUMN controllers.test_results IS
'JSON object with test results: {communication: true, config_sync: true, load_meter: true, inverter: true, dg_controller: true, control_logic: true, passed: true, timestamp: "..."}';

-- Note: Status field is TEXT type, no enum constraint
-- Valid statuses now include: draft, ready, claimed, deployed, deactivated, eol, failed
-- 'failed' status is used when controller tests fail during wizard
