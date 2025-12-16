-- Migration: 030_device_alarm_registers.sql
-- Purpose: Add alarm_registers column to project_devices table
-- This stores device-specific alarm register definitions (copied from template)

-- Add alarm_registers JSONB column (same structure as registers)
ALTER TABLE project_devices
ADD COLUMN IF NOT EXISTS alarm_registers JSONB DEFAULT '[]';

-- Add comment explaining the column
COMMENT ON COLUMN project_devices.alarm_registers IS
'Array of alarm register definitions for this device. Same structure as registers column but for alarm-specific registers.';
