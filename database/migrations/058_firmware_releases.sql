-- Migration: 058_firmware_releases.sql
-- Description: OTA firmware releases table for controller updates
-- Created: 2026-01-10

-- ============================================================================
-- Firmware Releases Table
-- Stores available firmware versions for OTA updates
-- ============================================================================

CREATE TABLE IF NOT EXISTS firmware_releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version TEXT NOT NULL,
    hardware_type_id UUID REFERENCES approved_hardware(id) ON DELETE SET NULL,
    release_type TEXT NOT NULL DEFAULT 'stable' CHECK (release_type IN ('stable', 'beta', 'hotfix')),
    download_url TEXT NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    file_size_bytes INTEGER,
    release_notes TEXT,
    min_version TEXT,  -- Minimum version that can upgrade to this release
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for quick lookup by hardware type and active status
CREATE INDEX idx_firmware_releases_hardware_active
    ON firmware_releases(hardware_type_id, is_active)
    WHERE is_active = TRUE;

-- Create index for version lookup
CREATE INDEX idx_firmware_releases_version
    ON firmware_releases(version);

-- Create unique constraint for version per hardware type
CREATE UNIQUE INDEX idx_firmware_releases_unique_version
    ON firmware_releases(hardware_type_id, version);

-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE firmware_releases ENABLE ROW LEVEL SECURITY;

-- Super admins and backend admins can manage firmware releases
CREATE POLICY "Super/backend admins can manage firmware releases"
    ON firmware_releases
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('super_admin', 'backend_admin')
        )
    );

-- All authenticated users can view active firmware releases
CREATE POLICY "Authenticated users can view active firmware releases"
    ON firmware_releases
    FOR SELECT
    USING (
        auth.uid() IS NOT NULL
        AND is_active = TRUE
    );

-- ============================================================================
-- Triggers
-- ============================================================================

-- Update updated_at timestamp on changes
CREATE OR REPLACE FUNCTION update_firmware_releases_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_firmware_releases_updated_at
    BEFORE UPDATE ON firmware_releases
    FOR EACH ROW
    EXECUTE FUNCTION update_firmware_releases_updated_at();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE firmware_releases IS 'Available firmware versions for OTA controller updates';
COMMENT ON COLUMN firmware_releases.version IS 'Semantic version string (e.g., 1.2.0)';
COMMENT ON COLUMN firmware_releases.hardware_type_id IS 'Target hardware type (NULL = all hardware)';
COMMENT ON COLUMN firmware_releases.release_type IS 'Release channel: stable, beta, or hotfix';
COMMENT ON COLUMN firmware_releases.download_url IS 'URL to download the firmware package';
COMMENT ON COLUMN firmware_releases.checksum_sha256 IS 'SHA256 hash for integrity verification';
COMMENT ON COLUMN firmware_releases.min_version IS 'Minimum version required to upgrade (NULL = any)';
COMMENT ON COLUMN firmware_releases.is_active IS 'Whether this release is available for download';
