-- Migration: 094_add_belt_scale_type.sql
-- Purpose: Add belt_scale device type for conveyor belt scale integrators

-- =============================================================================
-- Update device_templates.device_type constraint to include belt_scale
-- =============================================================================

ALTER TABLE device_templates
DROP CONSTRAINT IF EXISTS device_templates_device_type_check;

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
    -- Industrial equipment
    'belt_scale',
    -- Generic
    'other_hardware',
    -- Legacy (backward compatibility)
    'dg',
    'load_meter',
    'sensor'
));

COMMENT ON COLUMN device_templates.device_type IS 'Hardware type for device templates (includes belt_scale for conveyor scales)';
