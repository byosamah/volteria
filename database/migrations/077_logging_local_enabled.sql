-- Migration: Add logging_local_enabled column to sites table
-- This allows users to enable/disable local SQLite logging independently of cloud logging

ALTER TABLE sites ADD COLUMN logging_local_enabled BOOLEAN DEFAULT true;

-- Add comment
COMMENT ON COLUMN sites.logging_local_enabled IS 'Enable/disable local SQLite logging on controller';
