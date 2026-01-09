-- Migration 055: Add Modbus settings for master device controllers
-- This adds Modbus RS-485 configuration and calculated fields to site_master_devices

-- Add Modbus settings columns (for controller type master devices)
ALTER TABLE site_master_devices
ADD COLUMN IF NOT EXISTS modbus_physical TEXT DEFAULT 'RS-485',
ADD COLUMN IF NOT EXISTS modbus_baud_rate INTEGER DEFAULT 9600,
ADD COLUMN IF NOT EXISTS modbus_parity TEXT DEFAULT 'none',
ADD COLUMN IF NOT EXISTS modbus_stop_bits INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS modbus_frame_type TEXT DEFAULT 'RTU',
ADD COLUMN IF NOT EXISTS modbus_extra_delay INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS modbus_slave_timeout INTEGER DEFAULT 1000,
ADD COLUMN IF NOT EXISTS modbus_write_function TEXT DEFAULT 'auto',
ADD COLUMN IF NOT EXISTS calculated_fields JSONB DEFAULT '[]'::jsonb;

-- Add constraints for valid values
DO $$
BEGIN
  -- Drop existing constraints if they exist (safe to re-run)
  ALTER TABLE site_master_devices DROP CONSTRAINT IF EXISTS chk_modbus_physical;
  ALTER TABLE site_master_devices DROP CONSTRAINT IF EXISTS chk_modbus_parity;
  ALTER TABLE site_master_devices DROP CONSTRAINT IF EXISTS chk_modbus_stop_bits;
  ALTER TABLE site_master_devices DROP CONSTRAINT IF EXISTS chk_modbus_frame_type;
  ALTER TABLE site_master_devices DROP CONSTRAINT IF EXISTS chk_modbus_write_function;

  -- Add constraints
  ALTER TABLE site_master_devices
  ADD CONSTRAINT chk_modbus_physical CHECK (modbus_physical IN ('RS-485', 'RS-232', 'TCP'));

  ALTER TABLE site_master_devices
  ADD CONSTRAINT chk_modbus_parity CHECK (modbus_parity IN ('none', 'even', 'odd'));

  ALTER TABLE site_master_devices
  ADD CONSTRAINT chk_modbus_stop_bits CHECK (modbus_stop_bits IN (1, 2));

  ALTER TABLE site_master_devices
  ADD CONSTRAINT chk_modbus_frame_type CHECK (modbus_frame_type IN ('RTU', 'ASCII'));

  ALTER TABLE site_master_devices
  ADD CONSTRAINT chk_modbus_write_function CHECK (modbus_write_function IN ('auto', 'single', 'multiple'));
END $$;

-- Add comments for documentation
COMMENT ON COLUMN site_master_devices.modbus_physical IS 'Physical layer: RS-485, RS-232, or TCP';
COMMENT ON COLUMN site_master_devices.modbus_baud_rate IS 'Communication speed in bps (9600, 19200, 38400, 57600, 115200)';
COMMENT ON COLUMN site_master_devices.modbus_parity IS 'Parity bit: none, even, or odd';
COMMENT ON COLUMN site_master_devices.modbus_stop_bits IS 'Stop bits: 1 or 2';
COMMENT ON COLUMN site_master_devices.modbus_frame_type IS 'Frame type: RTU or ASCII';
COMMENT ON COLUMN site_master_devices.modbus_extra_delay IS 'Extra delay between frames in milliseconds';
COMMENT ON COLUMN site_master_devices.modbus_slave_timeout IS 'Slave response timeout in milliseconds';
COMMENT ON COLUMN site_master_devices.modbus_write_function IS 'Write function preference: auto, single (FC6), or multiple (FC16)';
COMMENT ON COLUMN site_master_devices.calculated_fields IS 'Selected calculated fields from controller template, can be customized per-site';
