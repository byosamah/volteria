-- Migration: Increase Historical Data Query Limit
-- Purpose: Increase LIMIT from 50,000 to 500,000 rows to support high-frequency logging
--
-- Problem: 50k limit caps data at ~10 hours for 4 params at 3-second logging
-- Math: 50000 / 4 params = 12,500 points/param. At 3-sec logging = 10.4 hours
--
-- Solution: 500k limit supports:
-- - 30 days x 4 params at 30-sec logging (~345k rows)
-- - 7 days x 4 params at 3-sec logging (~806k rows - will still hit limit but gets full week)
-- - Leaves headroom for faster logging rates
--
-- Performance: 500k rows = ~50MB response, 5-15 seconds query time (acceptable for historical analysis)

-- Drop existing function
DROP FUNCTION IF EXISTS get_historical_readings(UUID[], UUID[], TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

-- Create aggregation function with increased limit
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
    LIMIT 500000; -- Increased from 50000

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
    LIMIT 500000; -- Increased from 50000

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
    LIMIT 500000; -- Increased from 50000
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Update comment
COMMENT ON FUNCTION get_historical_readings IS 'Server-side aggregation for historical data. Auto-selects aggregation level based on date range: raw (<24h), hourly (24h-7d), daily (>7d). Limit: 500k rows.';
