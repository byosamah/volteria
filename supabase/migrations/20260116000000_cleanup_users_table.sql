-- Migration 075: Cleanup unused columns from users table
-- These columns were never used in the application

-- Drop password_hash (auth handled by Supabase Auth)
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;

-- Drop phone (not used in current system)
ALTER TABLE users DROP COLUMN IF EXISTS phone;

-- Drop last_login_at (tracked by Supabase Auth)
ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;
