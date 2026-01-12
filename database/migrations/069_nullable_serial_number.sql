-- ============================================
-- Migration: 069_nullable_serial_number
-- Makes serial_number nullable in controllers table
--
-- Reason: Serial number is now optional in wizard Step 1.
-- The Pi self-registers via setup script which provides the real serial.
-- ============================================

-- Make serial_number nullable
ALTER TABLE controllers
ALTER COLUMN serial_number DROP NOT NULL;

-- Add comment explaining the change
COMMENT ON COLUMN controllers.serial_number IS 'Unique serial number. Optional at creation - Pi self-registers via setup script';
