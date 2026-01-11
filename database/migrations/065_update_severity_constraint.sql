-- Migration 065: Update Severity CHECK Constraint
--
-- Purpose: Ensure alarms table uses the full severity scale including 'major'.
-- This aligns with the alarm_notifications table which already has all four levels.
--
-- Severity levels (ordered by priority):
-- - info: Informational messages (lowest)
-- - warning: Warning conditions
-- - major: Major issues requiring attention
-- - critical: Critical issues requiring immediate action (highest)

-- ============================================
-- STEP 1: Drop old constraint if it exists
-- ============================================
ALTER TABLE alarms DROP CONSTRAINT IF EXISTS alarms_severity_check;

-- ============================================
-- STEP 2: Add updated constraint with 'major'
-- ============================================
ALTER TABLE alarms ADD CONSTRAINT alarms_severity_check
    CHECK (severity IN ('info', 'warning', 'major', 'critical'));

-- ============================================
-- STEP 3: Add comments for documentation
-- ============================================
COMMENT ON COLUMN alarms.severity IS 'Alarm severity: info, warning, major, critical (in order of priority)';

-- ============================================
-- STEP 4: Verify constraint
-- ============================================
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'alarms'::regclass
AND contype = 'c';
