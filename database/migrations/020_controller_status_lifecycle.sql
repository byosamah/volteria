-- ============================================
-- Migration: 020_controller_status_lifecycle
--
-- Expands controller status from 3 to 5 states:
-- draft -> ready -> claimed -> deployed -> eol
--
-- New statuses:
-- - claimed: Enterprise owns it, but NOT yet assigned to a site
-- - eol: End of life / decommissioned
--
-- Also adds automatic status updates when site_id changes.
-- ============================================

-- ============================================
-- STEP 1: Update CHECK constraint to allow 5 statuses
-- ============================================

-- Drop the existing constraint
ALTER TABLE controllers DROP CONSTRAINT IF EXISTS controllers_status_check;

-- Add new constraint with all 5 statuses
ALTER TABLE controllers ADD CONSTRAINT controllers_status_check
    CHECK (status IN ('draft', 'ready', 'claimed', 'deployed', 'eol'));

-- Update comment to reflect new lifecycle
COMMENT ON COLUMN controllers.status IS 'Controller lifecycle: draft -> ready -> claimed -> deployed -> eol';

-- ============================================
-- STEP 2: Migrate existing data
-- Controllers that are 'deployed' but not actually on a site
-- should become 'claimed' (owned but not on a site)
-- ============================================

-- First: Update controllers with site_id IS NULL
UPDATE controllers
SET status = 'claimed'
WHERE status = 'deployed'
  AND site_id IS NULL;

-- Second: Update controllers that have site_id but aren't in site_master_devices
-- These are "orphaned" deployed controllers that should be "claimed"
-- (site_id may have been populated by migration 013 from project_id)
UPDATE controllers c
SET status = 'claimed'
WHERE c.status = 'deployed'
  AND NOT EXISTS (
    SELECT 1 FROM site_master_devices smd
    WHERE smd.controller_id = c.id
      AND smd.device_type = 'controller'
  );

-- ============================================
-- STEP 3: Create trigger to auto-update status based on site_id
--
-- When site_id changes:
-- - NULL -> value: status becomes 'deployed' (added to site)
-- - value -> NULL: status becomes 'claimed' (removed from site)
-- ============================================

CREATE OR REPLACE FUNCTION update_controller_status_on_site_change()
RETURNS TRIGGER AS $$
BEGIN
    -- When a controller is assigned to a site (site_id goes from NULL to a value)
    IF OLD.site_id IS NULL AND NEW.site_id IS NOT NULL THEN
        -- Only update if current status allows it (claimed -> deployed)
        IF NEW.status = 'claimed' THEN
            NEW.status := 'deployed';
        END IF;
    END IF;

    -- When a controller is removed from a site (site_id goes from a value to NULL)
    IF OLD.site_id IS NOT NULL AND NEW.site_id IS NULL THEN
        -- Only revert to 'claimed' if it was 'deployed'
        IF OLD.status = 'deployed' THEN
            NEW.status := 'claimed';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic status updates
DROP TRIGGER IF EXISTS trigger_update_controller_status ON controllers;
CREATE TRIGGER trigger_update_controller_status
    BEFORE UPDATE ON controllers
    FOR EACH ROW
    WHEN (OLD.site_id IS DISTINCT FROM NEW.site_id)
    EXECUTE FUNCTION update_controller_status_on_site_change();

-- ============================================
-- STEP 4: Add comments for documentation
-- ============================================

COMMENT ON FUNCTION update_controller_status_on_site_change() IS
    'Automatically updates controller status when site_id changes: claimed <-> deployed';

COMMENT ON TRIGGER trigger_update_controller_status ON controllers IS
    'Trigger that updates controller status when assigned to or removed from a site';
