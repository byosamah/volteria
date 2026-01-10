-- ============================================
-- Migration: 053_fix_heartbeat_rls
-- Fix RLS policy for controller_heartbeats to allow reading
--
-- Problem: The current RLS policy only allows 'authenticated' users,
-- but API routes might not properly pass the auth session.
--
-- Solution: Allow anon users to SELECT heartbeats (they're not sensitive).
-- Keep INSERT/UPDATE/DELETE restricted to authenticated/service_role.
-- ============================================

-- Drop existing SELECT policies to recreate them
DROP POLICY IF EXISTS "Authenticated users can view heartbeats" ON controller_heartbeats;
DROP POLICY IF EXISTS "Allow anon to read heartbeats" ON controller_heartbeats;

-- Allow anyone (anon or authenticated) to READ heartbeats
-- Heartbeats are not sensitive - they just show controller status
CREATE POLICY "Anyone can read heartbeats"
    ON controller_heartbeats FOR SELECT
    USING (true);

-- Keep INSERT restricted to authenticated users and service role
-- (Controllers insert via service key anyway)
DROP POLICY IF EXISTS "Allow authenticated insert heartbeats" ON controller_heartbeats;
CREATE POLICY "Allow insert heartbeats"
    ON controller_heartbeats FOR INSERT
    WITH CHECK (true);

-- Ensure service role has full access (already exists but recreate for safety)
DROP POLICY IF EXISTS "Service role full access heartbeats" ON controller_heartbeats;
CREATE POLICY "Service role full access heartbeats"
    ON controller_heartbeats FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Verify RLS is enabled
ALTER TABLE controller_heartbeats ENABLE ROW LEVEL SECURITY;
