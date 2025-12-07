-- ============================================
-- Migration: 009_controllers_master
-- Creates the controllers table (Controller Master List)
--
-- Tracks all controller hardware units.
-- Backend admins register controllers here.
-- Enterprises claim controllers using passcodes.
-- ============================================

-- Create controllers table
CREATE TABLE IF NOT EXISTS controllers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Controller identification
    serial_number TEXT UNIQUE NOT NULL,  -- e.g., 'RPI5-2024-001'

    -- Hardware type reference
    hardware_type_id UUID NOT NULL REFERENCES approved_hardware(id),

    -- Controller status
    -- draft: Just created, not ready for deployment
    -- ready: Configured and ready to be claimed by an enterprise
    -- deployed: Claimed by an enterprise and assigned to a project
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'ready', 'deployed')),

    -- Firmware information
    firmware_version TEXT,
    firmware_updated_at TIMESTAMPTZ,

    -- Claim passcode (auto-generated, used by enterprise to claim)
    -- Should be secure and unique
    passcode TEXT UNIQUE,

    -- Enterprise assignment (null until claimed)
    enterprise_id UUID REFERENCES enterprises(id),
    claimed_at TIMESTAMPTZ,
    claimed_by UUID REFERENCES users(id),

    -- Project assignment (null until assigned to a project)
    -- This links to projects.controller_serial_number
    project_id UUID REFERENCES projects(id),
    assigned_to_project_at TIMESTAMPTZ,

    -- Manufacturing/provisioning info
    manufactured_at TIMESTAMPTZ,
    provisioned_at TIMESTAMPTZ,
    provisioned_by UUID REFERENCES users(id),

    -- Notes
    notes TEXT,

    -- Tracking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Status
    is_active BOOLEAN DEFAULT TRUE
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_controllers_serial ON controllers(serial_number);
CREATE INDEX IF NOT EXISTS idx_controllers_status ON controllers(status);
CREATE INDEX IF NOT EXISTS idx_controllers_enterprise ON controllers(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_controllers_passcode ON controllers(passcode) WHERE passcode IS NOT NULL;

-- Update trigger for updated_at
CREATE TRIGGER update_controllers_updated_at
    BEFORE UPDATE ON controllers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE controllers IS 'Master list of all controller hardware units';
COMMENT ON COLUMN controllers.serial_number IS 'Unique serial number for the controller';
COMMENT ON COLUMN controllers.status IS 'Controller lifecycle: draft -> ready -> deployed';
COMMENT ON COLUMN controllers.passcode IS 'Secure passcode for enterprise to claim the controller';
COMMENT ON COLUMN controllers.enterprise_id IS 'Enterprise that claimed this controller';
COMMENT ON COLUMN controllers.project_id IS 'Project this controller is assigned to';

-- ============================================
-- Function to generate secure passcode
-- Creates an 8-character alphanumeric passcode
-- ============================================

CREATE OR REPLACE FUNCTION generate_controller_passcode()
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- Excludes confusing chars (0, O, 1, I)
    result TEXT := '';
    i INTEGER;
BEGIN
    FOR i IN 1..8 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Trigger to auto-generate passcode when status changes to 'ready'
-- ============================================

CREATE OR REPLACE FUNCTION auto_generate_passcode()
RETURNS TRIGGER AS $$
BEGIN
    -- Generate passcode when status changes to 'ready' and passcode is null
    IF NEW.status = 'ready' AND NEW.passcode IS NULL THEN
        NEW.passcode := generate_controller_passcode();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER generate_passcode_on_ready
    BEFORE INSERT OR UPDATE ON controllers
    FOR EACH ROW EXECUTE FUNCTION auto_generate_passcode();
