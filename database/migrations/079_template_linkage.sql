-- Migration: 079_template_linkage.sql
-- Purpose: Track source of registers (template vs manual) for proper template-device linkage
--
-- Problem: Template registers are copied to device at creation with no ongoing linkage.
-- Users edit template data inside device, and updating template doesn't propagate.
--
-- Solution: Track "source" field on each register entry:
-- - "template": Read-only at device level, synced from template
-- - "manual": Editable at device level, preserved across template sync
--
-- Applies to: logging_registers (registers), visualization_registers, alarm_registers
-- NOT tracked: calculated_fields (freely editable at device level)

-- ============================================
-- 1. HELPER FUNCTION TO ADD SOURCE FIELD
-- ============================================

-- Function to add source field to each register in a JSONB array
CREATE OR REPLACE FUNCTION add_source_to_registers(registers JSONB, source_value TEXT)
RETURNS JSONB AS $$
  SELECT COALESCE(
    jsonb_agg(
      CASE
        -- Only add source if not already present
        WHEN reg ? 'source' THEN reg
        ELSE reg || jsonb_build_object('source', source_value)
      END
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(registers) AS reg;
$$ LANGUAGE sql;

COMMENT ON FUNCTION add_source_to_registers IS
'Adds a source field to each register in a JSONB array. Used for template linkage tracking.';

-- ============================================
-- 2. BACKFILL EXISTING DEVICE REGISTERS
-- ============================================

-- Devices WITH template → mark all registers as "template"
-- (These were copied from a template, so they should be template-sourced)
UPDATE site_devices SET
  registers = add_source_to_registers(COALESCE(registers, '[]'), 'template'),
  visualization_registers = add_source_to_registers(COALESCE(visualization_registers, '[]'), 'template'),
  alarm_registers = add_source_to_registers(COALESCE(alarm_registers, '[]'), 'template')
WHERE template_id IS NOT NULL
  AND registers IS NOT NULL;

-- Update visualization registers separately for devices with templates
UPDATE site_devices SET
  visualization_registers = add_source_to_registers(COALESCE(visualization_registers, '[]'), 'template')
WHERE template_id IS NOT NULL
  AND visualization_registers IS NOT NULL;

-- Update alarm registers separately for devices with templates
UPDATE site_devices SET
  alarm_registers = add_source_to_registers(COALESCE(alarm_registers, '[]'), 'template')
WHERE template_id IS NOT NULL
  AND alarm_registers IS NOT NULL;

-- Devices WITHOUT template → mark all registers as "manual"
-- (These were manually added, so they should remain editable)
UPDATE site_devices SET
  registers = add_source_to_registers(COALESCE(registers, '[]'), 'manual')
WHERE template_id IS NULL
  AND registers IS NOT NULL;

UPDATE site_devices SET
  visualization_registers = add_source_to_registers(COALESCE(visualization_registers, '[]'), 'manual')
WHERE template_id IS NULL
  AND visualization_registers IS NOT NULL;

UPDATE site_devices SET
  alarm_registers = add_source_to_registers(COALESCE(alarm_registers, '[]'), 'manual')
WHERE template_id IS NULL
  AND alarm_registers IS NOT NULL;

-- ============================================
-- 3. TRIGGER: TEMPLATE UPDATE → MARK SITES UNSYNCED
-- ============================================

-- When a device template is updated, mark all connected sites as needing sync
-- This uses the existing config_changed_at column from migration 072
CREATE OR REPLACE FUNCTION notify_template_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Update config_changed_at on all sites that have devices using this template
  UPDATE sites SET config_changed_at = NOW()
  WHERE id IN (
    SELECT DISTINCT site_id
    FROM site_devices
    WHERE template_id = NEW.id
      AND enabled = true
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION notify_template_update IS
'Marks sites as needing config sync when their device templates are updated.';

-- Create trigger on device_templates table
DROP TRIGGER IF EXISTS trigger_template_update ON device_templates;
CREATE TRIGGER trigger_template_update
  AFTER UPDATE ON device_templates
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION notify_template_update();

-- ============================================
-- 4. HELPER FUNCTION FOR TEMPLATE USAGE COUNT
-- ============================================

-- Function to get count of devices using a template
-- Used by frontend to show warning when editing templates
CREATE OR REPLACE FUNCTION get_template_usage(p_template_id UUID)
RETURNS TABLE (
  device_count BIGINT,
  site_count BIGINT,
  site_names TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(DISTINCT sd.id)::BIGINT as device_count,
    COUNT(DISTINCT sd.site_id)::BIGINT as site_count,
    ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL) as site_names
  FROM site_devices sd
  JOIN sites s ON sd.site_id = s.id
  WHERE sd.template_id = p_template_id
    AND sd.enabled = true
    AND s.is_active = true;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_template_usage IS
'Returns count of devices and sites using a template. Used for edit warnings.';

-- ============================================
-- 5. VERIFICATION QUERIES
-- ============================================

-- Verify source field was added (run manually to check)
-- SELECT id, name,
--   jsonb_array_length(registers) as reg_count,
--   (SELECT COUNT(*) FROM jsonb_array_elements(registers) r WHERE r.value ? 'source') as with_source
-- FROM site_devices
-- WHERE registers IS NOT NULL AND jsonb_array_length(registers) > 0
-- LIMIT 10;

-- Test template usage function
-- SELECT * FROM get_template_usage('some-template-uuid-here');
