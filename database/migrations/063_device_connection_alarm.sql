-- ============================================
-- Migration: 063_device_connection_alarm.sql
-- Purpose: Add connection alarm settings to site_devices
--
-- This allows per-device connection alarm configuration:
-- - Enable/disable connection alarm for each device
-- - Configure timeout multiplier (timeout = logging_frequency × multiplier)
--
-- Default behavior:
-- - connection_alarm_enabled = true (alarms enabled by default)
-- - connection_timeout_multiplier = 3.0 (3x the logging frequency)
-- ============================================

-- Step 1: Add connection_alarm_enabled column
-- When true, controller will raise alarm if device stops reporting
ALTER TABLE site_devices
ADD COLUMN IF NOT EXISTS connection_alarm_enabled BOOLEAN DEFAULT true;

-- Step 2: Add connection_timeout_multiplier column
-- Timeout calculation: logging_frequency × multiplier
-- Example: 60s logging × 3.0 multiplier = 180s timeout (3 minutes)
ALTER TABLE site_devices
ADD COLUMN IF NOT EXISTS connection_timeout_multiplier NUMERIC(4,1) DEFAULT 3.0;

-- Step 3: Add comments for documentation
COMMENT ON COLUMN site_devices.connection_alarm_enabled IS 'Enable connection status alarm for this device (default: true)';
COMMENT ON COLUMN site_devices.connection_timeout_multiplier IS 'Timeout = logging_frequency × multiplier. Default 3.0 means alarm after 3x the logging interval without response.';
