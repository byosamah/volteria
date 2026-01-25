-- Add condition column to alarms table
-- Stores the threshold condition separately from the message
-- Example: "Ambient Temperature > 25"

ALTER TABLE alarms
ADD COLUMN IF NOT EXISTS condition TEXT;

-- Add comment
COMMENT ON COLUMN alarms.condition IS 'Threshold condition that triggered the alarm (e.g., "Ambient Temperature > 25")';
