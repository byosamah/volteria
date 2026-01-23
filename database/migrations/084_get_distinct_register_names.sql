-- Migration: 084_get_distinct_register_names.sql
-- Purpose: Efficient DISTINCT query for historical register names
-- Fixes: PostgREST 1000-row limit silently truncating register discovery
--
-- Before: Frontend fetched ALL device_readings rows (91k+), got only first 1000
-- After: Database returns only unique (device_id, register_name) pairs (~10-50 rows)

CREATE OR REPLACE FUNCTION public.get_distinct_register_names(
  p_device_ids UUID[],
  p_since TIMESTAMPTZ
)
RETURNS TABLE(device_id UUID, register_name TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT DISTINCT dr.device_id, dr.register_name
  FROM public.device_readings dr
  WHERE dr.device_id = ANY(p_device_ids)
    AND dr.timestamp >= p_since
  ORDER BY dr.device_id, dr.register_name;
$$;

COMMENT ON FUNCTION public.get_distinct_register_names IS 'Returns unique register names per device from device_readings. Used by historical registers API to identify non-active (renamed/removed) registers.';
