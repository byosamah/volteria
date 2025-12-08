-- Migration 014: UUID Passcodes
-- Changes controller passcodes from 8-character alphanumeric to UUID format
-- More secure: UUID has 122 bits of entropy vs ~41 bits for 8-char codes

-- Update the passcode generation function to use UUID
CREATE OR REPLACE FUNCTION generate_controller_passcode()
RETURNS TEXT AS $$
BEGIN
    -- Generate UUID format: c159d3d6-a778-4812-a688-0d7c5d0042ea
    RETURN gen_random_uuid()::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Note: Existing passcodes (8-char format) are preserved and will still work
-- Only newly generated passcodes will be UUIDs
