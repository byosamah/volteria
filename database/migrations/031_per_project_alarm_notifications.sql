-- Migration: 031_per_project_alarm_notifications.sql
-- Description: Add per-project alarm notification settings for users
-- Date: 2024-12-15

-- =============================================================================
-- STEP 1: Add 'major' severity level to alarms table
-- =============================================================================
-- New severity hierarchy: critical > major > warning > info

-- Drop existing constraint if it exists (safe operation)
ALTER TABLE alarms DROP CONSTRAINT IF EXISTS alarms_severity_check;

-- Add new constraint with 'major' severity
ALTER TABLE alarms ADD CONSTRAINT alarms_severity_check
  CHECK (severity IN ('info', 'warning', 'major', 'critical'));

-- =============================================================================
-- STEP 2: Create user_project_notifications table
-- =============================================================================
-- Stores per-user, per-project alarm notification preferences
-- Allows different notification settings for each project a user is assigned to

CREATE TABLE IF NOT EXISTS user_project_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- ============================================
  -- EMAIL NOTIFICATION SETTINGS
  -- ============================================
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  -- Minimum severity to trigger email notification
  -- 'major' means: notify for major + critical alarms
  email_min_severity TEXT NOT NULL DEFAULT 'major'
    CHECK (email_min_severity IN ('info', 'warning', 'major', 'critical')),
  -- Notify when alarm becomes active
  email_on_active BOOLEAN NOT NULL DEFAULT true,
  -- Notify when alarm is resolved
  email_on_resolved BOOLEAN NOT NULL DEFAULT false,

  -- ============================================
  -- SMS NOTIFICATION SETTINGS (pluggable for future)
  -- ============================================
  sms_enabled BOOLEAN NOT NULL DEFAULT false,
  -- Optional phone number override (if different from user's main phone)
  sms_phone_number TEXT,
  -- Minimum severity to trigger SMS notification
  -- Default to critical only for SMS (more intrusive)
  sms_min_severity TEXT NOT NULL DEFAULT 'critical'
    CHECK (sms_min_severity IN ('info', 'warning', 'major', 'critical')),
  -- Notify when alarm becomes active
  sms_on_active BOOLEAN NOT NULL DEFAULT true,
  -- Notify when alarm is resolved
  sms_on_resolved BOOLEAN NOT NULL DEFAULT false,

  -- ============================================
  -- TIMESTAMPS
  -- ============================================
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Each user can only have one notification settings record per project
  CONSTRAINT unique_user_project_notifications UNIQUE (user_id, project_id)
);

-- =============================================================================
-- STEP 3: Create indexes for performance
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_user_project_notifications_user
  ON user_project_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_user_project_notifications_project
  ON user_project_notifications(project_id);

-- =============================================================================
-- STEP 4: Create trigger for updated_at timestamp
-- =============================================================================
-- Uses existing update_updated_at_column() function from previous migrations

CREATE TRIGGER trigger_user_project_notifications_updated_at
  BEFORE UPDATE ON user_project_notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- STEP 5: Enable Row Level Security
-- =============================================================================
ALTER TABLE user_project_notifications ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to manage notification settings
-- (actual permission checks happen in application layer)
CREATE POLICY user_project_notifications_policy
  ON user_project_notifications
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- STEP 6: Add comments for documentation
-- =============================================================================
COMMENT ON TABLE user_project_notifications IS
  'Per-user, per-project alarm notification preferences. Allows different settings for each project assignment.';

COMMENT ON COLUMN user_project_notifications.email_min_severity IS
  'Minimum alarm severity to trigger email notification. "major" means Critical + Major alarms only.';

COMMENT ON COLUMN user_project_notifications.sms_enabled IS
  'SMS notifications toggle. SMS service integration is pluggable (Twilio, AWS SNS, etc.)';

COMMENT ON COLUMN user_project_notifications.sms_phone_number IS
  'Optional phone number override. If null, uses user profile phone number.';

COMMENT ON COLUMN user_project_notifications.email_on_active IS
  'Send notification when alarm becomes active (triggered).';

COMMENT ON COLUMN user_project_notifications.email_on_resolved IS
  'Send notification when alarm is resolved/cleared.';
