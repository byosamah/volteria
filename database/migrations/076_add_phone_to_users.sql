-- Migration 076: Add phone column to users table
-- For future use: user contact information

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
