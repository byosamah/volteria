-- Migration: Add source column to device_readings
-- Tracks how readings were obtained: 'live' (real-time) or 'backfill' (synced after offline recovery)
-- This enables observability of offline recovery events

ALTER TABLE device_readings ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'live';

COMMENT ON COLUMN device_readings.source IS 'How this reading was obtained: live (real-time sync) or backfill (recovered after offline period)';
