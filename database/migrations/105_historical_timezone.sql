-- Migration: Timezone-Aware Historical Data Bucketing
-- Purpose: Add p_timezone parameter to get_historical_readings so hourly/daily
--          buckets align with project timezone instead of UTC.
--
-- Problem: date_trunc('day', timestamp) uses UTC boundaries. For Dubai (UTC+4),
--          a reading at 20:00 UTC (= midnight Dubai, next day) gets bucketed into
--          the wrong UTC day. Daily DG energy for Feb 21 shows as "22 Feb".
--
-- Solution: date_trunc('day', timestamp AT TIME ZONE tz) truncates in local time.
--          The result is cast back to TIMESTAMPTZ via AT TIME ZONE tz.
--          Default 'UTC' preserves backward compatibility.

-- Drop existing function (old signature without p_timezone)
DROP FUNCTION IF EXISTS public.get_historical_readings(UUID[], UUID[], TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

-- Recreate with timezone parameter
CREATE OR REPLACE FUNCTION public.get_historical_readings(
  p_site_ids UUID[],
  p_device_ids UUID[],
  p_registers TEXT[],
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_aggregation TEXT DEFAULT 'auto',
  p_timezone TEXT DEFAULT 'UTC'
)
RETURNS TABLE (
  site_id UUID,
  device_id UUID,
  register_name TEXT,
  bucket TIMESTAMPTZ,
  value NUMERIC,
  min_value NUMERIC,
  max_value NUMERIC,
  sample_count INTEGER,
  unit TEXT
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_hours NUMERIC;
  v_aggregation TEXT;
BEGIN
  -- Calculate time range in hours
  v_hours := EXTRACT(EPOCH FROM (p_end - p_start)) / 3600;

  -- Auto-select aggregation based on range
  IF p_aggregation = 'auto' THEN
    IF v_hours <= 24 THEN
      v_aggregation := 'raw';
    ELSIF v_hours <= 168 THEN -- 7 days
      v_aggregation := 'hourly';
    ELSE
      v_aggregation := 'daily';
    END IF;
  ELSE
    v_aggregation := p_aggregation;
  END IF;

  -- Execute appropriate query
  IF v_aggregation = 'raw' THEN
    RETURN QUERY
    SELECT
      dr.site_id,
      dr.device_id,
      dr.register_name,
      dr.timestamp as bucket,
      dr.value::NUMERIC,
      dr.value::NUMERIC as min_value,
      dr.value::NUMERIC as max_value,
      1 as sample_count,
      dr.unit
    FROM public.device_readings dr
    WHERE dr.site_id = ANY(p_site_ids)
      AND dr.device_id = ANY(p_device_ids)
      AND (p_registers IS NULL OR dr.register_name = ANY(p_registers))
      AND dr.timestamp BETWEEN p_start AND p_end
    ORDER BY dr.timestamp
    LIMIT 500000;

  ELSIF v_aggregation = 'hourly' THEN
    RETURN QUERY
    SELECT
      dr.site_id,
      dr.device_id,
      dr.register_name,
      (date_trunc('hour', dr.timestamp AT TIME ZONE p_timezone) AT TIME ZONE p_timezone) as bucket,
      AVG(dr.value)::NUMERIC as value,
      MIN(dr.value)::NUMERIC as min_value,
      MAX(dr.value)::NUMERIC as max_value,
      COUNT(*)::INTEGER as sample_count,
      MAX(dr.unit) as unit
    FROM public.device_readings dr
    WHERE dr.site_id = ANY(p_site_ids)
      AND dr.device_id = ANY(p_device_ids)
      AND (p_registers IS NULL OR dr.register_name = ANY(p_registers))
      AND dr.timestamp BETWEEN p_start AND p_end
    GROUP BY dr.site_id, dr.device_id, dr.register_name,
             date_trunc('hour', dr.timestamp AT TIME ZONE p_timezone)
    ORDER BY bucket
    LIMIT 500000;

  ELSE -- daily
    RETURN QUERY
    SELECT
      dr.site_id,
      dr.device_id,
      dr.register_name,
      (date_trunc('day', dr.timestamp AT TIME ZONE p_timezone) AT TIME ZONE p_timezone) as bucket,
      AVG(dr.value)::NUMERIC as value,
      MIN(dr.value)::NUMERIC as min_value,
      MAX(dr.value)::NUMERIC as max_value,
      COUNT(*)::INTEGER as sample_count,
      MAX(dr.unit) as unit
    FROM public.device_readings dr
    WHERE dr.site_id = ANY(p_site_ids)
      AND dr.device_id = ANY(p_device_ids)
      AND (p_registers IS NULL OR dr.register_name = ANY(p_registers))
      AND dr.timestamp BETWEEN p_start AND p_end
    GROUP BY dr.site_id, dr.device_id, dr.register_name,
             date_trunc('day', dr.timestamp AT TIME ZONE p_timezone)
    ORDER BY bucket
    LIMIT 500000;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.get_historical_readings IS 'Server-side aggregation for historical data. Timezone-aware bucketing for hourly/daily. Auto-selects aggregation: raw (<24h), hourly (24h-7d), daily (>7d). Limit: 500k rows.';
