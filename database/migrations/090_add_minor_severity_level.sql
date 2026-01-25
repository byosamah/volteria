-- Migration 090: Add 'minor' severity level to alarms
-- Purpose: Add 'minor' severity between 'warning' and 'major'
-- Order: info < warning < minor < major < critical

-- =============================================================================
-- 1. Update alarms table severity constraint
-- =============================================================================
ALTER TABLE alarms DROP CONSTRAINT IF EXISTS alarms_severity_check;

ALTER TABLE alarms ADD CONSTRAINT alarms_severity_check
    CHECK (severity IN ('info', 'warning', 'minor', 'major', 'critical'));

-- =============================================================================
-- 2. Update user_project_notifications email_min_severity constraint
-- =============================================================================
ALTER TABLE user_project_notifications DROP CONSTRAINT IF EXISTS user_project_notifications_email_min_severity_check;

ALTER TABLE user_project_notifications ADD CONSTRAINT user_project_notifications_email_min_severity_check
    CHECK (email_min_severity IN ('info', 'warning', 'minor', 'major', 'critical'));

-- =============================================================================
-- 3. Update user_project_notifications sms_min_severity constraint
-- =============================================================================
ALTER TABLE user_project_notifications DROP CONSTRAINT IF EXISTS user_project_notifications_sms_min_severity_check;

ALTER TABLE user_project_notifications ADD CONSTRAINT user_project_notifications_sms_min_severity_check
    CHECK (sms_min_severity IN ('info', 'warning', 'minor', 'major', 'critical'));

-- =============================================================================
-- 4. Update comments for documentation
-- =============================================================================
COMMENT ON COLUMN alarms.severity IS 'Alarm severity: info, warning, minor, major, critical (in order of priority)';
