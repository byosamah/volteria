-- Migration: 074_rename_measurement_type.sql
-- Purpose: Rename measurement_type column to device_type in site_devices table for clarity
-- The column defines what type of device it is (inverter, load, generator, sensor, etc.)

-- =============================================================================
-- PART 1: Rename the column from measurement_type to device_type
-- =============================================================================

-- Drop the existing constraint first
ALTER TABLE site_devices
DROP CONSTRAINT IF EXISTS valid_measurement_type;

-- Rename the column
ALTER TABLE site_devices
RENAME COLUMN measurement_type TO device_type;

-- =============================================================================
-- PART 2: Recreate the constraint with the new column name
-- =============================================================================

ALTER TABLE site_devices
ADD CONSTRAINT valid_device_type
CHECK (device_type IN (
    -- Generator types
    'diesel_generator',
    'gas_generator',
    -- Solar
    'inverter',
    'solar_meter',
    -- Load types
    'load',
    'subload',
    -- Sensor types
    'solar_sensor',
    'temperature_humidity_sensor',
    'wind_sensor',
    -- Power generation
    'wind_turbine',
    -- Storage and compensation
    'bess',
    'capacitor_bank',
    -- Generic
    'other',
    -- Legacy values (for backward compatibility with existing data)
    'sub_load',
    'solar',
    'generator',
    'fuel',
    'unknown'
));

-- =============================================================================
-- PART 3: Update column comment
-- =============================================================================

COMMENT ON COLUMN site_devices.device_type IS 'Device type for control logic, logging, and calculated fields';
