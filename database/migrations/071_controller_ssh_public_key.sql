-- Migration: Add SSH public key column for controller tunnel authorization
-- This stores the Pi's public SSH key so we can authorize it on the central server

ALTER TABLE controllers ADD COLUMN IF NOT EXISTS ssh_public_key TEXT;

-- Add comment
COMMENT ON COLUMN controllers.ssh_public_key IS 'SSH public key from the controller for reverse tunnel authorization';
