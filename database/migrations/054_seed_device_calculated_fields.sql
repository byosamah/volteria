-- Migration 054: Seed Device-Type Specific Calculated Fields
-- Adds calculated field definitions for each device type to the calculated_field_definitions table.
-- These can be selected when configuring a device or device template.

-- ============================================
-- LOAD METER FIELDS
-- ============================================

INSERT INTO calculated_field_definitions (
    field_id, name, description, scope, device_types,
    calculation_type, time_window, calculation_config, unit,
    log_enabled, logging_frequency_seconds, is_system, is_active
) VALUES
(
    'daily_kwh_consumption',
    'Daily kWh Consumption',
    'Cumulative energy consumption today, resets at midnight',
    'device',
    ARRAY['load_meter'],
    'cumulative',
    'day',
    '{"source_register": "total_active_power", "unit_conversion": 0.000277778}'::JSONB,
    'kWh',
    true,
    300,
    true,
    true
),
(
    'daily_peak_load',
    'Daily Peak Load',
    'Maximum load power recorded today',
    'device',
    ARRAY['load_meter'],
    'max',
    'day',
    '{"source_register": "total_active_power"}'::JSONB,
    'kW',
    true,
    300,
    true,
    true
),
(
    'daily_avg_load',
    'Daily Average Load',
    'Average load power today',
    'device',
    ARRAY['load_meter'],
    'average',
    'day',
    '{"source_register": "total_active_power"}'::JSONB,
    'kW',
    true,
    300,
    true,
    true
),
(
    'phase_imbalance_pct',
    'Phase Imbalance',
    'Current imbalance percentage between phases',
    'device',
    ARRAY['load_meter'],
    'difference',
    NULL,
    '{"formula": "max(phase_a, phase_b, phase_c) - min(phase_a, phase_b, phase_c)"}'::JSONB,
    '%',
    false,
    60,
    true,
    true
)
ON CONFLICT (field_id) DO NOTHING;

-- ============================================
-- INVERTER FIELDS
-- ============================================

INSERT INTO calculated_field_definitions (
    field_id, name, description, scope, device_types,
    calculation_type, time_window, calculation_config, unit,
    log_enabled, logging_frequency_seconds, is_system, is_active
) VALUES
(
    'daily_kwh_production',
    'Daily kWh Production',
    'Solar energy produced today, resets at midnight',
    'device',
    ARRAY['inverter'],
    'cumulative',
    'day',
    '{"source_register": "active_power", "unit_conversion": 0.000277778}'::JSONB,
    'kWh',
    true,
    300,
    true,
    true
),
(
    'daily_peak_solar',
    'Daily Peak Solar',
    'Maximum solar power recorded today',
    'device',
    ARRAY['inverter'],
    'max',
    'day',
    '{"source_register": "active_power"}'::JSONB,
    'kW',
    true,
    300,
    true,
    true
),
(
    'daily_avg_solar',
    'Daily Average Solar',
    'Average solar power today (during daylight)',
    'device',
    ARRAY['inverter'],
    'average',
    'day',
    '{"source_register": "active_power", "filter_zero": true}'::JSONB,
    'kW',
    true,
    300,
    true,
    true
),
(
    'monthly_kwh_production',
    'Monthly kWh Production',
    'Solar energy produced this month',
    'device',
    ARRAY['inverter'],
    'cumulative',
    'month',
    '{"source_register": "active_power", "unit_conversion": 0.000277778}'::JSONB,
    'kWh',
    true,
    3600,
    true,
    true
)
ON CONFLICT (field_id) DO NOTHING;

-- ============================================
-- GENERATOR (DG) FIELDS
-- ============================================

INSERT INTO calculated_field_definitions (
    field_id, name, description, scope, device_types,
    calculation_type, time_window, calculation_config, unit,
    log_enabled, logging_frequency_seconds, is_system, is_active
) VALUES
(
    'daily_kwh_dg',
    'Daily kWh Generator',
    'Generator energy produced today',
    'device',
    ARRAY['dg'],
    'cumulative',
    'day',
    '{"source_register": "active_power", "unit_conversion": 0.000277778}'::JSONB,
    'kWh',
    true,
    300,
    true,
    true
),
(
    'daily_peak_dg',
    'Daily Peak Generator',
    'Maximum generator power today',
    'device',
    ARRAY['dg'],
    'max',
    'day',
    '{"source_register": "active_power"}'::JSONB,
    'kW',
    true,
    300,
    true,
    true
),
(
    'daily_runtime_hours',
    'Daily Runtime Hours',
    'Generator runtime hours today',
    'device',
    ARRAY['dg'],
    'cumulative',
    'day',
    '{"source_register": "running_status", "count_when_true": true, "unit_conversion": 0.000277778}'::JSONB,
    'hours',
    true,
    300,
    true,
    true
),
(
    'total_runtime_hours',
    'Total Runtime Hours',
    'Total generator runtime since installation',
    'device',
    ARRAY['dg'],
    'cumulative',
    NULL,
    '{"source_register": "running_status", "count_when_true": true, "unit_conversion": 0.000277778}'::JSONB,
    'hours',
    true,
    3600,
    true,
    true
),
(
    'daily_fuel_consumption_dg',
    'Daily Fuel Consumption',
    'Estimated fuel consumption today based on load',
    'device',
    ARRAY['dg'],
    'cumulative',
    'day',
    '{"source_register": "fuel_rate", "unit_conversion": 0.000277778}'::JSONB,
    'L',
    true,
    300,
    true,
    true
)
ON CONFLICT (field_id) DO NOTHING;

-- ============================================
-- SENSOR FIELDS
-- ============================================

INSERT INTO calculated_field_definitions (
    field_id, name, description, scope, device_types,
    calculation_type, time_window, calculation_config, unit,
    log_enabled, logging_frequency_seconds, is_system, is_active
) VALUES
(
    'daily_fuel_consumption',
    'Daily Fuel Consumption',
    'Fuel consumed today (from fuel level sensor)',
    'device',
    ARRAY['sensor'],
    'difference',
    'day',
    '{"source_register": "fuel_level", "start_minus_end": true}'::JSONB,
    'L',
    true,
    300,
    true,
    true
),
(
    'daily_avg_temp',
    'Daily Avg Temperature',
    'Average temperature today',
    'device',
    ARRAY['sensor'],
    'average',
    'day',
    '{"source_register": "temperature"}'::JSONB,
    '°C',
    true,
    300,
    true,
    true
),
(
    'daily_peak_temp',
    'Daily Peak Temperature',
    'Maximum temperature today',
    'device',
    ARRAY['sensor'],
    'max',
    'day',
    '{"source_register": "temperature"}'::JSONB,
    '°C',
    true,
    300,
    true,
    true
),
(
    'daily_min_temp',
    'Daily Min Temperature',
    'Minimum temperature today',
    'device',
    ARRAY['sensor'],
    'min',
    'day',
    '{"source_register": "temperature"}'::JSONB,
    '°C',
    true,
    300,
    true,
    true
),
(
    'daily_avg_humidity',
    'Daily Avg Humidity',
    'Average humidity today',
    'device',
    ARRAY['sensor'],
    'average',
    'day',
    '{"source_register": "humidity"}'::JSONB,
    '%',
    true,
    300,
    true,
    true
)
ON CONFLICT (field_id) DO NOTHING;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE calculated_field_definitions IS
'System-defined and custom calculated fields that can be assigned to devices or controllers.
Device-type specific fields (scope=device) are filtered by device_types array.
Controller-level fields (scope=controller) aggregate across multiple devices.';
