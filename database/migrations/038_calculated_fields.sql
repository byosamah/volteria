-- Migration: 038_calculated_fields.sql
-- Purpose: Create calculated_field_definitions table for computed metrics
-- Defines formulas for aggregating data (Total Solar, Total Load, DG Power, Energy counters)

-- =============================================================================
-- CALCULATED FIELD DEFINITIONS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS calculated_field_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Field identification
    field_id TEXT UNIQUE NOT NULL,              -- e.g., "total_solar_kw", "daily_energy_kwh"
    name TEXT NOT NULL,                          -- Display name
    description TEXT,                            -- Detailed description

    -- Scope: where this field is calculated
    scope TEXT NOT NULL CHECK (scope IN ('controller', 'device')),

    -- For device scope: which device types this applies to
    -- e.g., {'inverter', 'load_meter'}
    device_types TEXT[],

    -- Calculation type
    calculation_type TEXT NOT NULL CHECK (calculation_type IN (
        'sum',           -- Sum of values from multiple sources
        'difference',    -- A - B (e.g., Load - Solar = DG)
        'cumulative',    -- Rolling sum over time period (energy)
        'average',       -- Average of values
        'max',           -- Maximum value
        'min'            -- Minimum value
    )),

    -- Time window for cumulative calculations
    time_window TEXT CHECK (time_window IN ('hour', 'day', 'week', 'month', 'year')),

    -- Calculation configuration (depends on calculation_type)
    -- For sum: {"source_register": "active_power", "source_device_types": ["inverter"]}
    -- For difference: {"minuend": "total_load_kw", "subtrahend": "total_solar_kw"}
    -- For cumulative: {"source_register": "active_power", "unit_conversion": 0.001}
    calculation_config JSONB NOT NULL,

    -- Result unit
    unit TEXT,

    -- Logging settings
    log_enabled BOOLEAN DEFAULT TRUE,
    logging_frequency_seconds INTEGER DEFAULT 60,

    -- Is this a system-defined field (vs custom)?
    is_system BOOLEAN DEFAULT TRUE,

    -- Tracking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    is_active BOOLEAN DEFAULT TRUE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_calc_fields_field_id ON calculated_field_definitions(field_id);
CREATE INDEX IF NOT EXISTS idx_calc_fields_scope ON calculated_field_definitions(scope);
CREATE INDEX IF NOT EXISTS idx_calc_fields_type ON calculated_field_definitions(calculation_type);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_calc_fields_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_calc_fields_updated_at
    BEFORE UPDATE ON calculated_field_definitions
    FOR EACH ROW
    EXECUTE FUNCTION update_calc_fields_updated_at();

-- Comments
COMMENT ON TABLE calculated_field_definitions IS 'Definitions for calculated/computed fields from device readings';
COMMENT ON COLUMN calculated_field_definitions.scope IS 'controller = aggregates across all devices, device = per-device calculation';
COMMENT ON COLUMN calculated_field_definitions.calculation_config IS 'Configuration for the calculation (sources, formulas)';

-- =============================================================================
-- SEED DEFAULT CALCULATED FIELDS
-- =============================================================================

INSERT INTO calculated_field_definitions (
    field_id, name, description, scope, device_types, calculation_type, time_window, calculation_config, unit, is_system
) VALUES
-- ============================================================================
-- CONTROLLER-LEVEL FIELDS (aggregates across all devices)
-- ============================================================================

-- Total Solar Power (sum of all inverters)
(
    'total_solar_kw',
    'Total Solar Power',
    'Sum of active power output from all solar inverters',
    'controller',
    NULL,  -- applies to site level, not specific device types
    'sum',
    NULL,
    '{
        "source_register": "active_power",
        "source_device_types": ["inverter"],
        "source_measurement_types": ["solar"]
    }'::JSONB,
    'kW',
    TRUE
),

-- Total Load (sum of all load meters)
(
    'total_load_kw',
    'Total Load',
    'Sum of total active power from all load meters',
    'controller',
    NULL,
    'sum',
    NULL,
    '{
        "source_register": "total_active_power",
        "source_device_types": ["load_meter"],
        "source_measurement_types": ["load", "sub_load"]
    }'::JSONB,
    'kW',
    TRUE
),

-- DG Power (calculated as Load - Solar)
(
    'dg_power_kw',
    'DG Power',
    'Diesel generator power contribution (calculated as Total Load minus Total Solar)',
    'controller',
    NULL,
    'difference',
    NULL,
    '{
        "minuend": "total_load_kw",
        "subtrahend": "total_solar_kw",
        "min_result": 0
    }'::JSONB,
    'kW',
    TRUE
),

-- Total Generator Power (sum of all DG readings, if available)
(
    'total_generator_kw',
    'Total Generator Power',
    'Sum of active power from all diesel generators (from DG controller readings)',
    'controller',
    NULL,
    'sum',
    NULL,
    '{
        "source_register": "active_power",
        "source_device_types": ["dg"],
        "source_measurement_types": ["generator"]
    }'::JSONB,
    'kW',
    TRUE
),

-- ============================================================================
-- DEVICE-LEVEL FIELDS (per-device calculations)
-- ============================================================================

-- Daily Energy (cumulative today, resets at midnight)
(
    'daily_energy_kwh',
    'Daily Energy',
    'Cumulative energy output/consumption for the current day',
    'device',
    ARRAY['inverter', 'load_meter', 'dg'],
    'cumulative',
    'day',
    '{
        "source_register": "active_power",
        "unit_conversion": 0.000277778,
        "reset_at": "midnight"
    }'::JSONB,
    'kWh',
    TRUE
),

-- Monthly Energy (cumulative this month)
(
    'monthly_energy_kwh',
    'Monthly Energy',
    'Cumulative energy output/consumption for the current month',
    'device',
    ARRAY['inverter', 'load_meter', 'dg'],
    'cumulative',
    'month',
    '{
        "source_register": "active_power",
        "unit_conversion": 0.000277778,
        "reset_at": "first_of_month"
    }'::JSONB,
    'kWh',
    TRUE
),

-- Yearly Energy (cumulative this year)
(
    'yearly_energy_kwh',
    'Yearly Energy',
    'Cumulative energy output/consumption for the current year',
    'device',
    ARRAY['inverter', 'load_meter', 'dg'],
    'cumulative',
    'year',
    '{
        "source_register": "active_power",
        "unit_conversion": 0.000277778,
        "reset_at": "first_of_year"
    }'::JSONB,
    'kWh',
    TRUE
)

ON CONFLICT (field_id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    calculation_config = EXCLUDED.calculation_config,
    updated_at = NOW();

-- =============================================================================
-- ADD CALCULATED FIELD VALUES TO CONTROL LOGS
-- =============================================================================

-- These columns may already exist from the control_loop, but ensure they're present
-- The control loop already writes total_load_kw, solar_output_kw, dg_power_kw

-- Add daily energy counters to control_logs if needed
ALTER TABLE control_logs
ADD COLUMN IF NOT EXISTS total_daily_solar_kwh NUMERIC,
ADD COLUMN IF NOT EXISTS total_daily_load_kwh NUMERIC;

COMMENT ON COLUMN control_logs.total_daily_solar_kwh IS 'Cumulative solar energy today (kWh)';
COMMENT ON COLUMN control_logs.total_daily_load_kwh IS 'Cumulative load energy today (kWh)';

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE calculated_field_definitions ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view calculated field definitions
CREATE POLICY calc_fields_select ON calculated_field_definitions
    FOR SELECT
    TO authenticated
    USING (TRUE);

-- Only super_admin can modify system calculated fields
CREATE POLICY calc_fields_modify ON calculated_field_definitions
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role = 'super_admin'
        )
    );
