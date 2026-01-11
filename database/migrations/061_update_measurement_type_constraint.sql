-- Migration: 061_update_measurement_type_constraint.sql
-- Purpose: Update constraints for new device/hardware types

-- =============================================================================
-- PART 1: Update project_devices.measurement_type constraint (site device types)
-- =============================================================================

-- Drop the existing constraint
ALTER TABLE project_devices
DROP CONSTRAINT IF EXISTS valid_measurement_type;

-- Add the updated constraint with all new device types for site-level devices
ALTER TABLE project_devices
ADD CONSTRAINT valid_measurement_type
CHECK (measurement_type IN (
    -- Generator types
    'diesel_generator',
    'gas_generator',
    -- Solar
    'inverter',
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

-- Update comment
COMMENT ON COLUMN project_devices.measurement_type IS 'Device type for control logic and calculated fields';

-- =============================================================================
-- PART 2: Update device_templates.device_type constraint (hardware types)
-- =============================================================================

-- Drop the existing constraint
ALTER TABLE device_templates
DROP CONSTRAINT IF EXISTS device_templates_device_type_check;

-- Add the updated constraint with all new hardware types for templates
ALTER TABLE device_templates
ADD CONSTRAINT device_templates_device_type_check
CHECK (device_type IN (
    -- Power generation
    'inverter',
    'wind_turbine',
    'bess',
    -- Generator controllers
    'gas_generator_controller',
    'diesel_generator_controller',
    -- Metering
    'energy_meter',
    'capacitor_bank',
    -- Sensors
    'fuel_level_sensor',
    'fuel_flow_meter',
    'temperature_humidity_sensor',
    'solar_radiation_sensor',
    'wind_sensor',
    -- Generic
    'other_hardware',
    -- Legacy (backward compatibility)
    'dg',
    'load_meter',
    'sensor'
));

-- Update comment
COMMENT ON COLUMN device_templates.device_type IS 'Hardware type for device templates';

-- =============================================================================
-- PART 3: Update device_templates.operation constraint
-- =============================================================================

-- Drop the existing constraint
ALTER TABLE device_templates
DROP CONSTRAINT IF EXISTS device_templates_operation_check;

-- Add the updated constraint with new operations
ALTER TABLE device_templates
ADD CONSTRAINT device_templates_operation_check
CHECK (operation IN ('solar', 'dg', 'meter', 'sensor', 'storage', 'other'));
