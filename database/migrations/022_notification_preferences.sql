-- Migration: 022_notification_preferences.sql
-- Description: Add notification preferences table for user alert settings
-- Date: 2024-12-11

-- =============================================================================
-- NOTIFICATION PREFERENCES TABLE
-- =============================================================================
-- Stores user preferences for how they want to receive notifications
-- Each user can configure their own notification settings

CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Email notification settings
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  email_critical BOOLEAN NOT NULL DEFAULT true,    -- Critical alarms (always recommended)
  email_warning BOOLEAN NOT NULL DEFAULT false,    -- Warning level alarms
  email_info BOOLEAN NOT NULL DEFAULT false,       -- Info level notifications
  email_daily_summary BOOLEAN NOT NULL DEFAULT false, -- Daily digest email

  -- In-app notification settings
  in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  in_app_sound BOOLEAN NOT NULL DEFAULT true,      -- Play sound for in-app notifications

  -- Quiet hours (don't send notifications during these times)
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_start TIME,                          -- e.g., '22:00'
  quiet_hours_end TIME,                            -- e.g., '07:00'

  -- Specific alarm types to notify (null = all types)
  -- Array of alarm types: 'communication_lost', 'control_error', 'safe_mode_triggered', etc.
  alarm_types_filter TEXT[],

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Each user can only have one preference record
  CONSTRAINT unique_user_preferences UNIQUE (user_id)
);

-- Index for quick lookup by user
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user
  ON notification_preferences(user_id);

-- =============================================================================
-- IN-APP NOTIFICATIONS TABLE
-- =============================================================================
-- Stores notifications to be displayed in the app (bell icon)

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Notification content
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'info',        -- 'info', 'warning', 'critical', 'success'

  -- Related resource (optional)
  resource_type VARCHAR(50),                       -- 'alarm', 'project', 'site', 'controller'
  resource_id UUID,

  -- Link to navigate when clicked (optional)
  action_url TEXT,

  -- Status
  read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Auto-expire old notifications (optional cleanup)
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_expires
  ON notifications(expires_at) WHERE expires_at IS NOT NULL;

-- =============================================================================
-- TRIGGER: Update updated_at on notification_preferences
-- =============================================================================
CREATE OR REPLACE FUNCTION update_notification_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists (for re-running migration)
DROP TRIGGER IF EXISTS trigger_notification_preferences_updated_at ON notification_preferences;

CREATE TRIGGER trigger_notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_notification_preferences_updated_at();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- Enable RLS on both tables
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for re-running migration)
DROP POLICY IF EXISTS notification_preferences_user_policy ON notification_preferences;
DROP POLICY IF EXISTS notifications_user_select_policy ON notifications;
DROP POLICY IF EXISTS notifications_user_update_policy ON notifications;
DROP POLICY IF EXISTS notifications_service_insert_policy ON notifications;

-- Users can only see/modify their own preferences
CREATE POLICY notification_preferences_user_policy ON notification_preferences
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can only see their own notifications
CREATE POLICY notifications_user_select_policy ON notifications
  FOR SELECT
  USING (user_id = auth.uid());

-- Users can only update (mark as read) their own notifications
CREATE POLICY notifications_user_update_policy ON notifications
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Service role can insert notifications for any user
CREATE POLICY notifications_service_insert_policy ON notifications
  FOR INSERT
  WITH CHECK (true);

-- =============================================================================
-- HELPER FUNCTION: Get or create notification preferences for a user
-- =============================================================================
CREATE OR REPLACE FUNCTION get_or_create_notification_preferences(p_user_id UUID)
RETURNS notification_preferences AS $$
DECLARE
  prefs notification_preferences;
BEGIN
  -- Try to get existing preferences
  SELECT * INTO prefs FROM notification_preferences WHERE user_id = p_user_id;

  -- If not found, create default preferences
  IF NOT FOUND THEN
    INSERT INTO notification_preferences (user_id)
    VALUES (p_user_id)
    RETURNING * INTO prefs;
  END IF;

  RETURN prefs;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- COMMENTS
-- =============================================================================
COMMENT ON TABLE notification_preferences IS 'User notification preferences for alarms and system events';
COMMENT ON TABLE notifications IS 'In-app notifications displayed in the notification bell';
COMMENT ON COLUMN notification_preferences.alarm_types_filter IS 'If set, only notify for these alarm types. Null means all types.';
COMMENT ON COLUMN notifications.expires_at IS 'Notifications older than this are eligible for cleanup';
