-- ============================================
-- Migration: 007_enterprises
-- Creates the enterprises table for multi-tenant hierarchy
--
-- Enterprise is the top-level organizational unit.
-- Projects belong to enterprises.
-- Users can be assigned to enterprises.
-- ============================================

-- Create enterprises table
CREATE TABLE IF NOT EXISTS enterprises (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Enterprise identification
    -- Name cannot be changed once created (immutable)
    name TEXT NOT NULL,

    -- Unique enterprise identifier (like a slug)
    -- Example: "acme-corp", "solar-solutions-uae"
    enterprise_id TEXT UNIQUE NOT NULL,

    -- Contact information
    contact_email TEXT,
    contact_phone TEXT,

    -- Address
    address TEXT,
    city TEXT,
    country TEXT,

    -- Enterprise-specific settings (JSON)
    -- Can include: branding, default settings, feature flags
    settings JSONB DEFAULT '{}',

    -- Tracking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Status
    is_active BOOLEAN DEFAULT TRUE
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_enterprises_enterprise_id ON enterprises(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_enterprises_active ON enterprises(is_active) WHERE is_active = TRUE;

-- Update trigger for updated_at
CREATE TRIGGER update_enterprises_updated_at
    BEFORE UPDATE ON enterprises
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE enterprises IS 'Top-level organizational units for multi-tenant hierarchy';
COMMENT ON COLUMN enterprises.name IS 'Enterprise display name (immutable after creation)';
COMMENT ON COLUMN enterprises.enterprise_id IS 'Unique identifier/slug for the enterprise';
COMMENT ON COLUMN enterprises.settings IS 'Enterprise-specific configuration as JSON';

-- ============================================
-- Add enterprise_id to projects table
-- Projects now belong to an enterprise
-- ============================================

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id);

-- Index for faster enterprise-project lookups
CREATE INDEX IF NOT EXISTS idx_projects_enterprise ON projects(enterprise_id);

COMMENT ON COLUMN projects.enterprise_id IS 'The enterprise this project belongs to';

-- ============================================
-- Add enterprise_id to users table
-- Users can be associated with an enterprise
-- ============================================

ALTER TABLE users
ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id);

-- Index for faster enterprise-user lookups
CREATE INDEX IF NOT EXISTS idx_users_enterprise ON users(enterprise_id);

COMMENT ON COLUMN users.enterprise_id IS 'The enterprise this user belongs to (null for super/backend admins)';
