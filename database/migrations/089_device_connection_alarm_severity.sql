-- Migration 089: Add connection_alarm_severity column to site_devices
-- Purpose: Allow per-device severity configuration for not_reporting alarms
-- Default: 'warning' to match previous hardcoded behavior

-- =============================================================================
-- 1. Add connection_alarm_severity column
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'site_devices' AND column_name = 'connection_alarm_severity') THEN
        ALTER TABLE site_devices ADD COLUMN connection_alarm_severity TEXT DEFAULT 'warning';
    END IF;
END $$;

-- =============================================================================
-- 2. Add check constraint for valid severity values
-- Note: Using 'minor' between warning and major (Warning < Minor < Major < Critical)
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE table_name = 'site_devices' AND constraint_name = 'site_devices_connection_alarm_severity_check'
    ) THEN
        ALTER TABLE site_devices ADD CONSTRAINT site_devices_connection_alarm_severity_check
            CHECK (connection_alarm_severity IN ('warning', 'minor', 'major', 'critical'));
    END IF;
END $$;

-- =============================================================================
-- 3. Add comment for documentation
-- =============================================================================
COMMENT ON COLUMN site_devices.connection_alarm_severity IS 'Severity level for not_reporting alarm: warning, minor, major, critical';
