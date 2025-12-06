-- ============================================
-- Volteria - Row Level Security Policies
-- Migration: 004_rls_policies
--
-- IMPORTANT: Run this AFTER 001_initial_schema.sql
-- This sets up working RLS policies that avoid infinite recursion.
--
-- Key principle: Don't reference the users table from within
-- RLS policies on the users table (causes infinite recursion).
-- ============================================

-- ============================================
-- 1. USERS TABLE - DISABLE RLS
-- Avoids infinite recursion issues
-- ============================================
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- Drop any existing problematic policies
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'users'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON users', pol.policyname);
    END LOOP;
END $$;

-- ============================================
-- 2. PROJECTS TABLE
-- ============================================
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'projects'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON projects', pol.policyname);
    END LOOP;
END $$;

-- Simple policy: authenticated users can do everything
CREATE POLICY "Allow all for authenticated"
    ON projects FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================
-- 3. PROJECT_DEVICES TABLE
-- ============================================
ALTER TABLE project_devices ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'project_devices'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON project_devices', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "Authenticated users can view devices"
    ON project_devices FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can manage devices"
    ON project_devices FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================
-- 4. DEVICE_TEMPLATES TABLE
-- ============================================
ALTER TABLE device_templates ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'device_templates'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON device_templates', pol.policyname);
    END LOOP;
END $$;

-- Anyone authenticated can read templates
CREATE POLICY "Anyone can read device templates"
    ON device_templates FOR SELECT
    TO authenticated
    USING (true);

-- Service role can manage templates
CREATE POLICY "Service role full access"
    ON device_templates FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================
-- 5. USER_PROJECTS TABLE
-- ============================================
ALTER TABLE user_projects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'user_projects'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON user_projects', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "Authenticated users can view assignments"
    ON user_projects FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can manage assignments"
    ON user_projects FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================
-- 6. CONTROL_LOGS TABLE
-- ============================================
ALTER TABLE control_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'control_logs'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON control_logs', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "Authenticated users can view logs"
    ON control_logs FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can insert logs"
    ON control_logs FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Service role full access logs"
    ON control_logs FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================
-- 7. ALARMS TABLE
-- ============================================
ALTER TABLE alarms ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'alarms'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON alarms', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "Authenticated users can view alarms"
    ON alarms FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can manage alarms"
    ON alarms FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================
-- 8. CONTROLLER_HEARTBEATS TABLE
-- ============================================
ALTER TABLE controller_heartbeats ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'controller_heartbeats'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON controller_heartbeats', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "Authenticated users can view heartbeats"
    ON controller_heartbeats FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated insert heartbeats"
    ON controller_heartbeats FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Service role full access heartbeats"
    ON controller_heartbeats FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================
-- VERIFICATION
-- ============================================
-- Run this to verify RLS status:
-- SELECT relname, relrowsecurity FROM pg_class
-- WHERE relnamespace = 'public'::regnamespace AND relkind = 'r';

-- Run this to see all policies:
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public';
