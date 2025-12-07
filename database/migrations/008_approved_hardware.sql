-- ============================================
-- Migration: 008_approved_hardware
-- Creates the approved_hardware table
--
-- Defines hardware types that can be used as controllers.
-- Backend admins manage this list.
-- Currently supports Raspberry Pi 5.
-- ============================================

-- Create approved_hardware table
CREATE TABLE IF NOT EXISTS approved_hardware (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Hardware identification
    hardware_type TEXT UNIQUE NOT NULL,  -- e.g., 'raspberry_pi_5'
    name TEXT NOT NULL,                   -- e.g., 'Raspberry Pi 5'
    manufacturer TEXT,                    -- e.g., 'Raspberry Pi Foundation'

    -- Hardware specifications
    description TEXT,

    -- Features as JSON
    -- Example: {"wifi": true, "ethernet": true, "tcp_ports": 4, "rs485_ports": 2}
    features JSONB DEFAULT '{}',

    -- Minimum firmware version supported
    min_firmware_version TEXT,

    -- Tracking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Status
    is_active BOOLEAN DEFAULT TRUE
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_approved_hardware_type ON approved_hardware(hardware_type);
CREATE INDEX IF NOT EXISTS idx_approved_hardware_active ON approved_hardware(is_active) WHERE is_active = TRUE;

-- Update trigger for updated_at
CREATE TRIGGER update_approved_hardware_updated_at
    BEFORE UPDATE ON approved_hardware
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE approved_hardware IS 'List of approved hardware types for controllers';
COMMENT ON COLUMN approved_hardware.hardware_type IS 'Unique identifier for the hardware type';
COMMENT ON COLUMN approved_hardware.features IS 'Hardware capabilities as JSON (wifi, ports, etc.)';

-- ============================================
-- Insert default hardware: Raspberry Pi 5
-- ============================================

INSERT INTO approved_hardware (
    hardware_type,
    name,
    manufacturer,
    description,
    features,
    min_firmware_version,
    is_active
) VALUES (
    'raspberry_pi_5',
    'Raspberry Pi 5',
    'Raspberry Pi Foundation',
    'Raspberry Pi 5 single-board computer with 4GB or 8GB RAM',
    '{
        "wifi": true,
        "ethernet": true,
        "usb_ports": 4,
        "gpio_pins": 40,
        "rs485_support": true,
        "recommended_ram_gb": 4
    }'::jsonb,
    '1.0.0',
    TRUE
) ON CONFLICT (hardware_type) DO NOTHING;
