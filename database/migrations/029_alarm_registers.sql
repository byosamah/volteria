-- Migration: 029_alarm_registers.sql
-- Purpose: Add alarm_registers column to device_templates table
-- This stores alarm register definitions separately from standard Modbus registers

-- Add alarm_registers JSONB column (same structure as registers)
ALTER TABLE device_templates
ADD COLUMN IF NOT EXISTS alarm_registers JSONB DEFAULT '[]';

-- Add comment explaining the column
COMMENT ON COLUMN device_templates.alarm_registers IS
'Array of alarm register definitions. Same structure as registers column but for alarm-specific registers.';
