-- ============================================
-- Migration: 025_add_sol564_nvme_hardware
--
-- Adds the SOL564-NVME16-128 hardware type
-- (Raspberry Pi 5 with 16GB RAM + 128GB NVMe SSD)
--
-- Also deactivates the old raspberry_pi_5 entry
-- ============================================

-- Deactivate the old raspberry_pi_5 hardware entry
-- (Keep it in DB for historical reference, just hide from selection)
UPDATE approved_hardware
SET is_active = FALSE,
    updated_at = NOW()
WHERE hardware_type = 'raspberry_pi_5';

-- Insert the new SOL564-NVME16-128 hardware entry
INSERT INTO approved_hardware (
    -- Core identification
    hardware_type,
    name,
    manufacturer,
    description,

    -- General / Identification (from migration 019)
    model,
    brand,
    base_hardware,

    -- Power specs
    power_supply,
    power_input,
    max_power_consumption,

    -- Processor / Computing
    processor,
    gpu,
    memory_ram,
    storage_spec,

    -- Connectivity / Interfaces
    wifi_spec,
    bluetooth_spec,
    ethernet_spec,
    usb_ports_spec,
    interfaces,

    -- Expansion
    pcie,

    -- Display
    display_output,
    video_decode,
    camera_interfaces,

    -- Environmental
    operating_temp_range,

    -- Features JSON (for flexible capability flags)
    features,

    -- Firmware
    min_firmware_version,

    -- Status
    is_active
) VALUES (
    -- Core identification
    'SOL564-NVME16-128',
    'Raspberry Pi 5 - 16GB RAM + 128GB NVMe',
    'Raspberry Pi Foundation',
    'Raspberry Pi 5 with 16GB RAM and 128GB NVMe M.2 SSD for high-performance controller deployment',

    -- General / Identification
    'Raspberry Pi 5',
    'Raspberry Pi Foundation',
    'BCM2712',

    -- Power specs
    'Official USB-C 27W',
    'USB-C 5V/5A (27W)',
    '27W',

    -- Processor / Computing
    'Broadcom BCM2712 2.4GHz quad-core Cortex-A76',
    'VideoCore VII, OpenGL ES 3.1, Vulkan 1.2',
    '16GB LPDDR4X-4267',
    '128GB NVMe M.2 SSD + 64GB microSD',

    -- Connectivity / Interfaces
    '802.11ac dual-band (2.4GHz/5GHz)',
    'Bluetooth 5.0, BLE',
    'Gigabit Ethernet (RJ45)',
    '2x USB 3.0, 2x USB 2.0',
    '40-pin GPIO, UART, SPI, I2C',

    -- Expansion
    'PCIe 2.0 x1 (M.2 NVMe HAT)',

    -- Display
    '2x Micro HDMI (4K@60Hz)',
    '4Kp60 HEVC decode',
    'MIPI CSI-2 (2-lane, 4-lane)',

    -- Environmental
    '0C to 50C',

    -- Features JSON
    '{
        "wifi": true,
        "ethernet": true,
        "bluetooth": true,
        "usb_ports": 4,
        "gpio_pins": 40,
        "rs485_support": true,
        "nvme_support": true,
        "nvme_boot": true,
        "ssd_size_gb": 128,
        "ram_gb": 16,
        "recommended_ram_gb": 16
    }'::jsonb,

    -- Firmware
    '1.0.0',

    -- Status
    TRUE
) ON CONFLICT (hardware_type) DO UPDATE SET
    name = EXCLUDED.name,
    manufacturer = EXCLUDED.manufacturer,
    description = EXCLUDED.description,
    model = EXCLUDED.model,
    brand = EXCLUDED.brand,
    base_hardware = EXCLUDED.base_hardware,
    power_supply = EXCLUDED.power_supply,
    power_input = EXCLUDED.power_input,
    max_power_consumption = EXCLUDED.max_power_consumption,
    processor = EXCLUDED.processor,
    gpu = EXCLUDED.gpu,
    memory_ram = EXCLUDED.memory_ram,
    storage_spec = EXCLUDED.storage_spec,
    wifi_spec = EXCLUDED.wifi_spec,
    bluetooth_spec = EXCLUDED.bluetooth_spec,
    ethernet_spec = EXCLUDED.ethernet_spec,
    usb_ports_spec = EXCLUDED.usb_ports_spec,
    interfaces = EXCLUDED.interfaces,
    pcie = EXCLUDED.pcie,
    display_output = EXCLUDED.display_output,
    video_decode = EXCLUDED.video_decode,
    camera_interfaces = EXCLUDED.camera_interfaces,
    operating_temp_range = EXCLUDED.operating_temp_range,
    features = EXCLUDED.features,
    min_firmware_version = EXCLUDED.min_firmware_version,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

-- Add a comment for documentation
COMMENT ON TABLE approved_hardware IS 'List of approved hardware types for controllers. SOL564-NVME16-128 is the primary hardware type.';
