-- ============================================
-- Migration: 057_project_timezone
-- Add timezone field to projects table
--
-- Purpose: Store project-level timezone for data logging and analysis
-- Format: IANA timezone identifier (e.g., 'Asia/Dubai', 'America/New_York')
-- ============================================

-- Add timezone column to projects table
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) DEFAULT 'UTC';

-- Add comment for documentation
COMMENT ON COLUMN projects.timezone IS 'IANA timezone identifier for project data logging and analysis (e.g., Asia/Dubai)';
