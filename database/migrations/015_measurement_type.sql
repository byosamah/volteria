-- Migration 015: Add measurement_type to project_devices
-- This column defines what the device is measuring for control logic:
-- - load: Main site load meter
-- - sub_load: Secondary/partial load measurement
-- - solar: Solar inverter output
-- - generator: Diesel generator output
-- - fuel: Fuel consumption or level

-- Step 1: Add the measurement_type column with a default value
ALTER TABLE project_devices
ADD COLUMN IF NOT EXISTS measurement_type TEXT DEFAULT 'unknown';

-- Step 2: Update existing devices based on their template's device_type
-- This auto-migrates existing data to sensible defaults
UPDATE project_devices pd
SET measurement_type = CASE
    WHEN dt.device_type = 'load_meter' THEN 'load'
    WHEN dt.device_type = 'inverter' THEN 'solar'
    WHEN dt.device_type = 'dg' THEN 'generator'
    ELSE 'unknown'
END
FROM device_templates dt
WHERE pd.template_id = dt.id
  AND (pd.measurement_type IS NULL OR pd.measurement_type = 'unknown');

-- Step 3: Add check constraint for valid measurement types
-- Note: PostgreSQL allows adding constraint even if some values don't match
-- We've already updated existing values above
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'valid_measurement_type'
    ) THEN
        ALTER TABLE project_devices
        ADD CONSTRAINT valid_measurement_type
        CHECK (measurement_type IN ('load', 'sub_load', 'solar', 'generator', 'fuel', 'unknown'));
    END IF;
END $$;

-- Step 4: Add comment for documentation
COMMENT ON COLUMN project_devices.measurement_type IS
'Defines what this device measures for control logic: load, sub_load, solar, generator, fuel';
