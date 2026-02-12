-- Migration 097: Add UPDATE policy for authenticated users on sites table
--
-- Root cause: sites table (migration 081) only had SELECT for authenticated.
-- UPDATE silently failed with {data: null, error: null} from Supabase client.
-- This matches the projects table pattern (migration 004: FOR ALL TO authenticated).
-- Single-tenant, trusted users — same risk level. Documented in database/CLAUDE.md.

CREATE POLICY "Authenticated write access"
ON sites FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);
