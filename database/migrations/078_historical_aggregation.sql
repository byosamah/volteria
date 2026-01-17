-- Migration: Historical Data Aggregation RPC Function
-- Purpose: Server-side aggregation for large datasets (bypasses max_rows limit)
--
-- Date Range Limits:
--   Raw: Max 7 days (~10,000-20,000 points/device)
--   Hourly: Max 90 days (~2,160 points/device)
--   Daily: Max 2 years (~730 points/device)

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS get_historical_readings(UUID[], UUID[], TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

-- Create aggregation function
CREATE OR REPLACE FUNCTION get_historical_readings(
  p_site_ids UUID[],
  p_device_ids UUID[],
  p_registers TEXT[],
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_aggregation TEXT DEFAULT 'auto' -- 'raw', 'hourly', 'daily', 'auto'
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
) AS $$
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
    FROM device_readings dr
    WHERE dr.site_id = ANY(p_site_ids)
      AND dr.device_id = ANY(p_device_ids)
      AND (p_registers IS NULL OR dr.register_name = ANY(p_registers))
      AND dr.timestamp BETWEEN p_start AND p_end
    ORDER BY dr.timestamp
    LIMIT 50000; -- Safety limit

  ELSIF v_aggregation = 'hourly' THEN
    RETURN QUERY
    SELECT
      dr.site_id,
      dr.device_id,
      dr.register_name,
      date_trunc('hour', dr.timestamp) as bucket,
      AVG(dr.value)::NUMERIC as value,
      MIN(dr.value)::NUMERIC as min_value,
      MAX(dr.value)::NUMERIC as max_value,
      COUNT(*)::INTEGER as sample_count,
      MAX(dr.unit) as unit
    FROM device_readings dr
    WHERE dr.site_id = ANY(p_site_ids)
      AND dr.device_id = ANY(p_device_ids)
      AND (p_registers IS NULL OR dr.register_name = ANY(p_registers))
      AND dr.timestamp BETWEEN p_start AND p_end
    GROUP BY dr.site_id, dr.device_id, dr.register_name, date_trunc('hour', dr.timestamp)
    ORDER BY bucket
    LIMIT 50000;

  ELSE -- daily
    RETURN QUERY
    SELECT
      dr.site_id,
      dr.device_id,
      dr.register_name,
      date_trunc('day', dr.timestamp) as bucket,
      AVG(dr.value)::NUMERIC as value,
      MIN(dr.value)::NUMERIC as min_value,
      MAX(dr.value)::NUMERIC as max_value,
      COUNT(*)::INTEGER as sample_count,
      MAX(dr.unit) as unit
    FROM device_readings dr
    WHERE dr.site_id = ANY(p_site_ids)
      AND dr.device_id = ANY(p_device_ids)
      AND (p_registers IS NULL OR dr.register_name = ANY(p_registers))
      AND dr.timestamp BETWEEN p_start AND p_end
    GROUP BY dr.site_id, dr.device_id, dr.register_name, date_trunc('day', dr.timestamp)
    ORDER BY bucket
    LIMIT 50000;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Add comment
COMMENT ON FUNCTION get_historical_readings IS 'Server-side aggregation for historical data. Auto-selects aggregation level based on date range: raw (<24h), hourly (24h-7d), daily (>7d).';
