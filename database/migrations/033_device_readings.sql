-- Migration: 033_device_readings.sql
-- Purpose: Per-device time-series readings for Historical Data visualization
--
-- This table stores individual device register readings (NOT aggregated).
-- Used by the Historical Data page to show device-level data.
-- Works alongside control_logs which stores aggregate metrics.

-- Create device_readings table
CREATE TABLE IF NOT EXISTS device_readings (
  id BIGSERIAL PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES project_devices(id) ON DELETE CASCADE,
  register_name TEXT NOT NULL,        -- e.g., "active_power", "power_limit_pct"
  value NUMERIC NOT NULL,
  unit TEXT,                          -- e.g., "kW", "%", "A"
  timestamp TIMESTAMPTZ NOT NULL,
  synced BOOLEAN DEFAULT FALSE,       -- Cloud sync status (for controller local db)
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate readings for same device/register/timestamp
  UNIQUE(device_id, register_name, timestamp)
);

-- Indexes for efficient time-range queries
-- Primary query pattern: by site and time range
CREATE INDEX IF NOT EXISTS idx_device_readings_site_time
  ON device_readings(site_id, timestamp DESC);

-- Secondary query pattern: by specific device and time range
CREATE INDEX IF NOT EXISTS idx_device_readings_device_time
  ON device_readings(device_id, timestamp DESC);

-- For cloud sync: find unsynced records efficiently
CREATE INDEX IF NOT EXISTS idx_device_readings_sync
  ON device_readings(synced) WHERE synced = FALSE;

-- Composite index for common query: site + device + time
CREATE INDEX IF NOT EXISTS idx_device_readings_site_device_time
  ON device_readings(site_id, device_id, timestamp DESC);

-- Enable Row Level Security
ALTER TABLE device_readings ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read device_readings for sites they have project access to
CREATE POLICY "Users can read device_readings for their projects"
ON device_readings FOR SELECT
TO authenticated
USING (
  site_id IN (
    SELECT s.id FROM sites s
    JOIN user_projects up ON s.project_id = up.project_id
    WHERE up.user_id = auth.uid()
  )
);

-- Policy: Service role can insert device_readings (for controller cloud sync)
CREATE POLICY "Service role can insert device_readings"
ON device_readings FOR INSERT
TO service_role
WITH CHECK (true);

-- Policy: Service role can update device_readings (for sync status updates)
CREATE POLICY "Service role can update device_readings"
ON device_readings FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

-- Policy: Service role can delete device_readings (for retention cleanup)
CREATE POLICY "Service role can delete device_readings"
ON device_readings FOR DELETE
TO service_role
USING (true);

-- Add helpful comments
COMMENT ON TABLE device_readings IS 'Per-device time-series register readings for Historical Data visualization';
COMMENT ON COLUMN device_readings.register_name IS 'Register identifier from device template, e.g., active_power, power_limit_pct';
COMMENT ON COLUMN device_readings.synced IS 'TRUE if uploaded to cloud from controller local SQLite';
COMMENT ON COLUMN device_readings.unit IS 'Measurement unit: kW, %, A, V, Hz, etc.';
