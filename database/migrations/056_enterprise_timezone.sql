-- ============================================
-- Migration: 056_enterprise_timezone
-- Add timezone field to enterprises table
--
-- Purpose: Store enterprise-level timezone for analysis
-- Format: IANA timezone identifier (e.g., 'Asia/Dubai', 'America/New_York')
-- ============================================

-- Add timezone column to enterprises table
ALTER TABLE enterprises
ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) DEFAULT 'UTC';

-- Add comment for documentation
COMMENT ON COLUMN enterprises.timezone IS 'IANA timezone identifier for enterprise-level analysis (e.g., Asia/Dubai)';
