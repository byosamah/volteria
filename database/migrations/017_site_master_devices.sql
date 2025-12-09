-- Migration 017: Site Master Devices
-- Adds table for controllers and gateways assigned to sites
-- Controllers: One per site, selected from enterprise's claimed controllers
-- Gateways: Multiple per site, includes Netbiter API credentials

-- ============================================
-- CREATE TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS site_master_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,

    -- Device type: 'controller' or 'gateway'
    device_type TEXT NOT NULL CHECK (device_type IN ('controller', 'gateway')),

    -- Common fields
    name TEXT NOT NULL,
    ip_address TEXT,
    port INTEGER,

    -- Controller-specific: links to claimed controller
    controller_id UUID REFERENCES controllers(id),

    -- Gateway-specific fields
    gateway_type TEXT CHECK (gateway_type IN ('netbiter', 'other')),

    -- Netbiter API credentials
    netbiter_account_id TEXT,
    netbiter_username TEXT,
    netbiter_password TEXT,
    netbiter_system_id TEXT,

    -- Other gateway credentials (generic)
    gateway_api_url TEXT,
    gateway_api_key TEXT,
    gateway_api_secret TEXT,

    -- Status tracking
    is_online BOOLEAN DEFAULT FALSE,
    last_seen TIMESTAMPTZ,
    last_error TEXT,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,

    -- Check constraints
    CONSTRAINT controller_requires_controller_id
        CHECK (device_type != 'controller' OR controller_id IS NOT NULL),
    CONSTRAINT gateway_requires_gateway_type
        CHECK (device_type != 'gateway' OR gateway_type IS NOT NULL)
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_site_master_devices_site ON site_master_devices(site_id);
CREATE INDEX IF NOT EXISTS idx_site_master_devices_controller ON site_master_devices(controller_id);
CREATE INDEX IF NOT EXISTS idx_site_master_devices_type ON site_master_devices(device_type);

-- Partial unique index: Only one controller per site
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_controller_per_site
    ON site_master_devices(site_id)
    WHERE device_type = 'controller';

-- ============================================
-- TRIGGERS: Sync controller.site_id
-- ============================================

-- When a controller is assigned to a site master device, update controllers.site_id
CREATE OR REPLACE FUNCTION sync_controller_site_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.device_type = 'controller' AND NEW.controller_id IS NOT NULL THEN
        UPDATE controllers SET site_id = NEW.site_id WHERE id = NEW.controller_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_controller_site ON site_master_devices;
CREATE TRIGGER trigger_sync_controller_site
AFTER INSERT OR UPDATE ON site_master_devices
FOR EACH ROW EXECUTE FUNCTION sync_controller_site_id();

-- When a master device is deleted, clear the controller.site_id
CREATE OR REPLACE FUNCTION clear_controller_site_id()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.device_type = 'controller' AND OLD.controller_id IS NOT NULL THEN
        UPDATE controllers SET site_id = NULL WHERE id = OLD.controller_id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_clear_controller_site ON site_master_devices;
CREATE TRIGGER trigger_clear_controller_site
AFTER DELETE ON site_master_devices
FOR EACH ROW EXECUTE FUNCTION clear_controller_site_id();

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_site_master_devices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_site_master_devices_updated_at ON site_master_devices;
CREATE TRIGGER trigger_update_site_master_devices_updated_at
BEFORE UPDATE ON site_master_devices
FOR EACH ROW EXECUTE FUNCTION update_site_master_devices_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE site_master_devices ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view all master devices
DROP POLICY IF EXISTS "Users can view site master devices" ON site_master_devices;
CREATE POLICY "Users can view site master devices" ON site_master_devices
    FOR SELECT TO authenticated USING (true);

-- Allow authenticated users to insert master devices
DROP POLICY IF EXISTS "Users can insert site master devices" ON site_master_devices;
CREATE POLICY "Users can insert site master devices" ON site_master_devices
    FOR INSERT TO authenticated WITH CHECK (true);

-- Allow authenticated users to update master devices
DROP POLICY IF EXISTS "Users can update site master devices" ON site_master_devices;
CREATE POLICY "Users can update site master devices" ON site_master_devices
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Allow authenticated users to delete master devices
DROP POLICY IF EXISTS "Users can delete site master devices" ON site_master_devices;
CREATE POLICY "Users can delete site master devices" ON site_master_devices
    FOR DELETE TO authenticated USING (true);

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE site_master_devices IS 'Controllers and gateways assigned to sites';
COMMENT ON COLUMN site_master_devices.device_type IS 'Type of master device: controller or gateway';
COMMENT ON COLUMN site_master_devices.controller_id IS 'Reference to controllers table (only for device_type=controller)';
COMMENT ON COLUMN site_master_devices.gateway_type IS 'Gateway vendor: netbiter or other';
COMMENT ON COLUMN site_master_devices.netbiter_account_id IS 'Netbiter API account ID';
COMMENT ON COLUMN site_master_devices.netbiter_system_id IS 'Netbiter system/device ID';
