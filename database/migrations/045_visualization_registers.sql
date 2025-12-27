-- ============================================
-- Migration: 045_visualization_registers
--
-- Adds visualization registers and expands sensor device types.
--
-- Changes:
-- 1. Expand device types to include specific sensor types
-- 2. Rename registers → logging_registers (preserves data)
-- 3. Add visualization_registers column
-- 4. Add calculated_fields column for device templates
-- 5. Apply same changes to project_devices table
-- ============================================

-- ============================================
-- 1. EXPAND DEVICE TYPES
-- Replace generic 'sensor' with specific sensor types
-- ============================================

-- Update device_templates device_type constraint
ALTER TABLE device_templates
DROP CONSTRAINT IF EXISTS device_templates_device_type_check;

ALTER TABLE device_templates
ADD CONSTRAINT device_templates_device_type_check
CHECK (device_type IN (
  'inverter',
  'dg',
  'load_meter',
  'sensor',  -- Keep generic sensor for backward compatibility
  'fuel_level_sensor',
  'temperature_humidity_sensor',
  'solar_radiation_sensor',
  'wind_sensor'
));

-- Update operation constraint to allow sensor operation for all sensor types
ALTER TABLE device_templates
DROP CONSTRAINT IF EXISTS device_templates_operation_check;

ALTER TABLE device_templates
ADD CONSTRAINT device_templates_operation_check
CHECK (operation IN ('solar', 'dg', 'meter', 'sensor'));

-- ============================================
-- 2. RENAME registers → logging_registers (device_templates)
-- Using DO block to handle idempotency
-- ============================================

DO $$
BEGIN
  -- Check if 'registers' column exists and 'logging_registers' does not
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'device_templates' AND column_name = 'registers'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'device_templates' AND column_name = 'logging_registers'
  ) THEN
    EXECUTE 'ALTER TABLE device_templates RENAME COLUMN registers TO logging_registers';
  END IF;
END $$;

-- ============================================
-- 3. ADD visualization_registers COLUMN (device_templates)
-- For registers that are read live but NOT stored in database
-- ============================================

ALTER TABLE device_templates
ADD COLUMN IF NOT EXISTS visualization_registers JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN device_templates.visualization_registers IS
'Modbus registers for live visualization only. NOT logged to database.
Format: Same as logging_registers but without logging_frequency.';

-- ============================================
-- 4. ADD calculated_fields COLUMN (device_templates)
-- For selecting which calculated fields to enable per template
-- ============================================

ALTER TABLE device_templates
ADD COLUMN IF NOT EXISTS calculated_fields JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN device_templates.calculated_fields IS
'Selected calculated fields for this device type. Format:
[{
  "field_id": "daily_kwh_consumption",
  "name": "Daily kWh Consumption",
  "storage_mode": "log" | "viz_only"
}]
Available fields depend on device_type:
- load_meter: daily_kwh_consumption, daily_peak_load, daily_avg_load, daily_phase_imbalance
- inverter: daily_kwh_production, daily_peak_kw, daily_avg_kw
- dg: daily_kwh_production, daily_peak_kw, daily_avg_kw
- fuel_level_sensor: daily_level_difference
- temperature_humidity_sensor: daily_peak_temp, daily_avg_temp, daily_peak_humidity, daily_avg_humidity';

-- ============================================
-- 5. RENAME registers → logging_registers (project_devices)
-- Using DO block to handle idempotency
-- ============================================

DO $$
BEGIN
  -- Check if 'registers' column exists and 'logging_registers' does not
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_devices' AND column_name = 'registers'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_devices' AND column_name = 'logging_registers'
  ) THEN
    EXECUTE 'ALTER TABLE project_devices RENAME COLUMN registers TO logging_registers';
  END IF;
END $$;

-- ============================================
-- 6. ADD visualization_registers COLUMN (project_devices)
-- ============================================

ALTER TABLE project_devices
ADD COLUMN IF NOT EXISTS visualization_registers JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN project_devices.visualization_registers IS
'Device-specific visualization registers (copied from template, can be customized). NOT logged to database.';

-- ============================================
-- 7. UPDATE COLUMN COMMENTS FOR CLARITY
-- ============================================

-- Update comment on logging_registers to clarify its purpose
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'device_templates' AND column_name = 'logging_registers'
  ) THEN
    COMMENT ON COLUMN device_templates.logging_registers IS
    'Modbus registers for logging AND control. Stored in database AND used by control logic.
    Add registers needed for control decisions (active_power, dg_power, etc.) here.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_devices' AND column_name = 'logging_registers'
  ) THEN
    COMMENT ON COLUMN project_devices.logging_registers IS
    'Device-specific logging registers (copied from template, can be customized).
    Used for logging AND control logic.';
  END IF;
END $$;
