-- ============================================
-- Migration 019: Hardware Detailed Specifications
-- ============================================
--
-- Expands the approved_hardware table with detailed
-- specification fields organized into 8 categories:
-- 1. General / Identification
-- 2. Physical / Housing
-- 3. Environmental / Power
-- 4. Processor / Computing
-- 5. Connectivity / Interfaces
-- 6. Expansion / Modules
-- 7. Display / Camera
-- 8. Control / Miscellaneous
-- ============================================

-- Section 1: General / Identification (5 new columns)
-- name, manufacturer, description already exist
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS base_hardware TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS country_of_origin TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS conformity TEXT;

-- Section 2: Physical / Housing (4 columns)
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS housing_material TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS housing_dimensions TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS weight TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS ip_rating TEXT;

-- Section 3: Environmental / Power (7 columns)
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS operating_temp_range TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS storage_temp TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS max_humidity TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS power_input TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS power_supply TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS max_power_consumption TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS battery TEXT;

-- Section 4: Processor / Computing (5 columns)
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS processor TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS cooling TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS gpu TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS memory_ram TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS storage_spec TEXT;

-- Section 5: Connectivity / Interfaces (9 columns)
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS wifi_spec TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS bluetooth_spec TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS cellular TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS antenna TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS interfaces TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS usb_ports_spec TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS ethernet_spec TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS rs485_spec TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS can_bus TEXT;

-- Section 6: Expansion / Modules (2 columns)
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS pcie TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS compatible_modules TEXT;

-- Section 7: Display / Camera (4 columns)
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS display_output TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS video_decode TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS optical_display TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS camera_interfaces TEXT;

-- Section 8: Control / Miscellaneous (4 columns)
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS rtc TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS power_button TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS mtbf TEXT;
ALTER TABLE approved_hardware ADD COLUMN IF NOT EXISTS emc_spec TEXT;

-- Add comments for documentation
COMMENT ON COLUMN approved_hardware.model IS 'Hardware model number';
COMMENT ON COLUMN approved_hardware.brand IS 'Brand name';
COMMENT ON COLUMN approved_hardware.base_hardware IS 'Base hardware platform';
COMMENT ON COLUMN approved_hardware.country_of_origin IS 'Country of manufacture';
COMMENT ON COLUMN approved_hardware.conformity IS 'Certifications and conformity standards';
COMMENT ON COLUMN approved_hardware.housing_material IS 'Case/housing material';
COMMENT ON COLUMN approved_hardware.housing_dimensions IS 'Physical dimensions';
COMMENT ON COLUMN approved_hardware.weight IS 'Weight specification';
COMMENT ON COLUMN approved_hardware.ip_rating IS 'IP rating / protection class';
COMMENT ON COLUMN approved_hardware.operating_temp_range IS 'Operating temperature range';
COMMENT ON COLUMN approved_hardware.storage_temp IS 'Storage temperature range';
COMMENT ON COLUMN approved_hardware.max_humidity IS 'Maximum relative humidity';
COMMENT ON COLUMN approved_hardware.power_input IS 'Power input specification';
COMMENT ON COLUMN approved_hardware.power_supply IS 'Power supply type';
COMMENT ON COLUMN approved_hardware.max_power_consumption IS 'Maximum power consumption';
COMMENT ON COLUMN approved_hardware.battery IS 'Battery specification';
COMMENT ON COLUMN approved_hardware.processor IS 'Processor/CPU specification';
COMMENT ON COLUMN approved_hardware.cooling IS 'Cooling system';
COMMENT ON COLUMN approved_hardware.gpu IS 'Graphics processing unit';
COMMENT ON COLUMN approved_hardware.memory_ram IS 'Memory/RAM specification';
COMMENT ON COLUMN approved_hardware.storage_spec IS 'Storage size and compatibility';
COMMENT ON COLUMN approved_hardware.wifi_spec IS 'Wi-Fi specification';
COMMENT ON COLUMN approved_hardware.bluetooth_spec IS 'Bluetooth specification';
COMMENT ON COLUMN approved_hardware.cellular IS 'Cellular connectivity';
COMMENT ON COLUMN approved_hardware.antenna IS 'Antenna specification';
COMMENT ON COLUMN approved_hardware.interfaces IS 'Interfaces and connectors';
COMMENT ON COLUMN approved_hardware.usb_ports_spec IS 'USB ports specification';
COMMENT ON COLUMN approved_hardware.ethernet_spec IS 'Ethernet specification';
COMMENT ON COLUMN approved_hardware.rs485_spec IS 'RS485 specification';
COMMENT ON COLUMN approved_hardware.can_bus IS 'CAN bus specification';
COMMENT ON COLUMN approved_hardware.pcie IS 'PCIe specification';
COMMENT ON COLUMN approved_hardware.compatible_modules IS 'Compatible expansion modules';
COMMENT ON COLUMN approved_hardware.display_output IS 'Display output specification';
COMMENT ON COLUMN approved_hardware.video_decode IS 'Video decode capability';
COMMENT ON COLUMN approved_hardware.optical_display IS 'Optical display specification';
COMMENT ON COLUMN approved_hardware.camera_interfaces IS 'Camera interface specification';
COMMENT ON COLUMN approved_hardware.rtc IS 'Real-time clock specification';
COMMENT ON COLUMN approved_hardware.power_button IS 'Power button specification';
COMMENT ON COLUMN approved_hardware.mtbf IS 'Mean time between failures';
COMMENT ON COLUMN approved_hardware.emc_spec IS 'EMC interference emission/immunity';
