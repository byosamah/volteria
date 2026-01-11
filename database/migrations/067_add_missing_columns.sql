-- Migration 067: Add Missing Columns
--
-- Purpose: Add columns that were in the original schema but missing from the database.
-- These columns are required by the backend API.

-- ============================================
-- STEP 1: Add missing columns to control_logs
-- ============================================

-- Available headroom for solar output
ALTER TABLE control_logs ADD COLUMN IF NOT EXISTS available_headroom_kw NUMERIC;

-- Device online counts
ALTER TABLE control_logs ADD COLUMN IF NOT EXISTS load_meters_online INTEGER DEFAULT 0;
ALTER TABLE control_logs ADD COLUMN IF NOT EXISTS inverters_online INTEGER DEFAULT 0;
ALTER TABLE control_logs ADD COLUMN IF NOT EXISTS generators_online INTEGER DEFAULT 0;

-- Raw data for debugging
ALTER TABLE control_logs ADD COLUMN IF NOT EXISTS raw_data JSONB;

-- ============================================
-- STEP 2: Add missing columns to alarms
-- ============================================

-- Resolution tracking
ALTER TABLE alarms ADD COLUMN IF NOT EXISTS resolved BOOLEAN DEFAULT FALSE;
ALTER TABLE alarms ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- ============================================
-- STEP 3: Reload PostgREST schema cache
-- ============================================
NOTIFY pgrst, 'reload schema';

-- ============================================
-- STEP 4: Verify columns exist
-- ============================================

-- Check control_logs columns
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'control_logs'
AND column_name IN ('available_headroom_kw', 'load_meters_online', 'inverters_online', 'generators_online', 'raw_data')
ORDER BY column_name;

-- Check alarms columns
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'alarms'
AND column_name IN ('resolved', 'resolved_at')
ORDER BY column_name;
