-- Migration: 085_register_date_range.sql
-- Purpose: Update get_distinct_register_names to return first/last seen timestamps
-- Used by: Historical Data Non-Active registers to show date ranges

-- Drop old function (return type changed - cannot use CREATE OR REPLACE alone)
DROP FUNCTION IF EXISTS public.get_distinct_register_names(UUID[], TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.get_distinct_register_names(
  p_device_ids UUID[],
  p_since TIMESTAMPTZ
)
RETURNS TABLE(device_id UUID, register_name TEXT, first_seen TIMESTAMPTZ, last_seen TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT dr.device_id, dr.register_name, MIN(dr.timestamp), MAX(dr.timestamp)
  FROM public.device_readings dr
  WHERE dr.device_id = ANY(p_device_ids)
    AND dr.timestamp >= p_since
  GROUP BY dr.device_id, dr.register_name
  ORDER BY dr.device_id, dr.register_name;
$$;

COMMENT ON FUNCTION public.get_distinct_register_names IS 'Returns unique register names per device from device_readings with first/last seen timestamps. Used by historical registers API to identify non-active (renamed/removed) registers and their date ranges.';
