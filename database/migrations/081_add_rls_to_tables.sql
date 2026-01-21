-- Migration: Enable RLS on tables missing it
-- Applied: 2026-01-21
-- Purpose: Address Supabase linter warnings for tables without RLS
-- Note: users table intentionally excluded (RLS disabled to prevent recursion)

-- ============================================
-- approved_hardware
-- ============================================
ALTER TABLE approved_hardware ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
ON approved_hardware FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated read access"
ON approved_hardware FOR SELECT
TO authenticated
USING (true);

-- ============================================
-- controllers
-- ============================================
ALTER TABLE controllers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
ON controllers FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated read access"
ON controllers FOR SELECT
TO authenticated
USING (true);

-- ============================================
-- enterprises
-- ============================================
ALTER TABLE enterprises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
ON enterprises FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated read access"
ON enterprises FOR SELECT
TO authenticated
USING (true);

-- ============================================
-- sites
-- ============================================
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
ON sites FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated read access"
ON sites FOR SELECT
TO authenticated
USING (true);

-- ============================================
-- user_sites (unused table, service_role only)
-- ============================================
ALTER TABLE user_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
ON user_sites FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
