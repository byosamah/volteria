-- ============================================
-- Migration 018: Fix users updated_at column
-- ============================================
--
-- Bug: Account settings update fails with error:
--   "record 'new' has no field 'updated_at'"
--
-- Root cause: The trigger update_users_updated_at exists
-- and tries to set NEW.updated_at, but the column is
-- missing from the production users table.
--
-- Fix: Add the missing column.
-- ============================================

ALTER TABLE users
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Comment
COMMENT ON COLUMN users.updated_at IS 'Last modification timestamp';
