-- Migration: Fix delta field boundary computation + meter reset handling
-- Problem 1: MAX(value)-MIN(value) within a bucket misses the last logging interval.
--   e.g., daily bucket reads 00:00→23:50 (10min freq), missing 23:50→00:00 energy.
-- Problem 2: Meter resets (counter drops) caused entire period to show 0 energy.
-- Fix: Sum all consecutive reading pairs at logging frequency resolution.
--   Each pair: GREATEST(0, next - current). Negative = reset → skip only that gap.
--   Bucket of each pair = bucket of first reading → boundary-to-boundary naturally.
--   Captures pre-reset + post-reset energy; only the unmeasurable reset gap is lost.

-- Drop existing function
DROP FUNCTION IF EXISTS public.get_historical_readings(UUID[], UUID[], TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT);

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
  v_delta_registers TEXT[];
  v_normal_registers TEXT[];
  v_has_deltas BOOLEAN := FALSE;
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

  -- Detect delta calculated fields among requested registers
  -- Only when specific registers are requested and device_ids include a master device
  IF p_registers IS NOT NULL THEN
    SELECT ARRAY_AGG(cfd.name)
    INTO v_delta_registers
    FROM public.calculated_field_definitions cfd
    WHERE cfd.calculation_type = 'delta'
      AND cfd.name = ANY(p_registers);

    IF v_delta_registers IS NOT NULL AND array_length(v_delta_registers, 1) > 0 THEN
      v_has_deltas := TRUE;
      -- Build the non-delta register list
      SELECT ARRAY_AGG(r)
      INTO v_normal_registers
      FROM unnest(p_registers) r
      WHERE r <> ALL(v_delta_registers);
    END IF;
  END IF;

  -- If no delta fields detected, use the normal path for everything
  IF NOT v_has_deltas THEN
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

    RETURN;
  END IF;

  -- === HYBRID PATH: delta fields computed from raw counters + normal registers ===

  -- 1. Return normal (non-delta) registers if any
  IF v_normal_registers IS NOT NULL AND array_length(v_normal_registers, 1) > 0 THEN
    IF v_aggregation = 'raw' THEN
      RETURN QUERY
      SELECT dr.site_id, dr.device_id, dr.register_name, dr.timestamp as bucket,
             dr.value::NUMERIC, dr.value::NUMERIC, dr.value::NUMERIC, 1, dr.unit
      FROM public.device_readings dr
      WHERE dr.site_id = ANY(p_site_ids) AND dr.device_id = ANY(p_device_ids)
        AND dr.register_name = ANY(v_normal_registers)
        AND dr.timestamp BETWEEN p_start AND p_end
      ORDER BY dr.timestamp LIMIT 500000;
    ELSIF v_aggregation = 'hourly' THEN
      RETURN QUERY
      SELECT dr.site_id, dr.device_id, dr.register_name,
             (date_trunc('hour', dr.timestamp AT TIME ZONE p_timezone) AT TIME ZONE p_timezone),
             AVG(dr.value)::NUMERIC, MIN(dr.value)::NUMERIC, MAX(dr.value)::NUMERIC,
             COUNT(*)::INTEGER, MAX(dr.unit)
      FROM public.device_readings dr
      WHERE dr.site_id = ANY(p_site_ids) AND dr.device_id = ANY(p_device_ids)
        AND dr.register_name = ANY(v_normal_registers)
        AND dr.timestamp BETWEEN p_start AND p_end
      GROUP BY dr.site_id, dr.device_id, dr.register_name,
               date_trunc('hour', dr.timestamp AT TIME ZONE p_timezone)
      ORDER BY 4 LIMIT 500000;
    ELSE
      RETURN QUERY
      SELECT dr.site_id, dr.device_id, dr.register_name,
             (date_trunc('day', dr.timestamp AT TIME ZONE p_timezone) AT TIME ZONE p_timezone),
             AVG(dr.value)::NUMERIC, MIN(dr.value)::NUMERIC, MAX(dr.value)::NUMERIC,
             COUNT(*)::INTEGER, MAX(dr.unit)
      FROM public.device_readings dr
      WHERE dr.site_id = ANY(p_site_ids) AND dr.device_id = ANY(p_device_ids)
        AND dr.register_name = ANY(v_normal_registers)
        AND dr.timestamp BETWEEN p_start AND p_end
      GROUP BY dr.site_id, dr.device_id, dr.register_name,
               date_trunc('day', dr.timestamp AT TIME ZONE p_timezone)
      ORDER BY 4 LIMIT 500000;
    END IF;
  END IF;

  -- 2. Compute delta fields from raw counter readings
  -- Strategy: Sum all consecutive reading pairs at logging frequency resolution.
  -- Reset detection: if next < current, that pair = 0 (reset gap). All other pairs contribute.
  -- Bucket assignment: each pair's energy goes to the bucket of its FIRST reading.
  -- The last pair in a bucket naturally crosses into next bucket's first reading (boundary-to-boundary).
  -- Extended range: fetch up to 1 day past p_end to capture cross-boundary pairs.
  RETURN QUERY
  WITH delta_config AS (
    SELECT
      cfd.name AS field_name,
      cfd.unit AS field_unit,
      cfd.calculation_config->>'register_role' AS register_role,
      COALESCE(cfd.logging_frequency_seconds, 86400) AS field_frequency
    FROM public.calculated_field_definitions cfd
    WHERE cfd.calculation_type = 'delta'
      AND cfd.name = ANY(v_delta_registers)
  ),
  source_registers AS (
    SELECT
      dc.field_name,
      dc.field_unit,
      dc.field_frequency,
      sd.id AS src_device_id,
      sd.site_id AS src_site_id,
      reg->>'name' AS src_register_name
    FROM delta_config dc
    CROSS JOIN public.site_devices sd
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(sd.registers, '[]'::jsonb)
    ) AS reg
    WHERE sd.site_id = ANY(p_site_ids)
      AND sd.enabled = true
      AND reg->>'register_role' = dc.register_role
  ),
  master_device AS (
    SELECT smd.id AS master_id, smd.site_id
    FROM public.site_master_devices smd
    WHERE smd.id = ANY(p_device_ids)
      AND smd.site_id = ANY(p_site_ids)
    LIMIT 1
  ),
  -- All consecutive reading pairs at logging frequency resolution.
  -- LEAD gives next reading's value. Bucket = date_trunc of THIS reading's timestamp.
  -- Extended range: +1 day past p_end so last pair in the query range crosses into next period.
  ordered_readings AS (
    SELECT
      sr.field_name,
      sr.field_unit,
      sr.src_site_id,
      sr.src_device_id,
      dr.value AS reading_value,
      LEAD(dr.value) OVER (
        PARTITION BY sr.field_name, sr.src_device_id
        ORDER BY dr.timestamp
      ) AS next_value,
      CASE
        WHEN sr.field_frequency <= 3600 AND v_aggregation <> 'daily'
          THEN date_trunc('hour', dr.timestamp AT TIME ZONE p_timezone)
        ELSE date_trunc('day', dr.timestamp AT TIME ZONE p_timezone)
      END AS bucket_key
    FROM source_registers sr
    JOIN public.device_readings dr
      ON dr.device_id = sr.src_device_id
      AND dr.register_name = sr.src_register_name
      AND dr.timestamp >= p_start
      AND dr.timestamp < (p_end + INTERVAL '1 day')
  ),
  -- Sum positive pair deltas per bucket per device.
  -- Negative pair (next < current) = meter reset → contributes 0, not the whole period.
  -- Only the unmeasurable reset gap is lost; pre-reset and post-reset energy is captured.
  device_deltas AS (
    SELECT
      field_name,
      field_unit,
      src_site_id,
      src_device_id,
      bucket_key,
      SUM(GREATEST(0, next_value - reading_value)) AS delta_value
    FROM ordered_readings
    WHERE next_value IS NOT NULL
    GROUP BY field_name, field_unit, src_site_id, src_device_id, bucket_key
  )
  SELECT
    md.site_id,
    md.master_id AS device_id,
    dd.field_name AS register_name,
    (dd.bucket_key AT TIME ZONE p_timezone) AS bucket,
    SUM(dd.delta_value)::NUMERIC AS value,
    SUM(dd.delta_value)::NUMERIC AS min_value,
    SUM(dd.delta_value)::NUMERIC AS max_value,
    1 AS sample_count,
    MAX(dd.field_unit) AS unit
  FROM device_deltas dd
  CROSS JOIN master_device md
  WHERE dd.delta_value IS NOT NULL
    AND (dd.bucket_key AT TIME ZONE p_timezone) >= p_start
    AND (dd.bucket_key AT TIME ZONE p_timezone) < p_end
  GROUP BY md.site_id, md.master_id, dd.field_name, dd.bucket_key
  ORDER BY bucket
  LIMIT 500000;
END;
$$;

COMMENT ON FUNCTION public.get_historical_readings IS 'Server-side aggregation for historical data. Timezone-aware bucketing for hourly/daily. Delta fields computed on-the-fly by summing consecutive reading pairs (GREATEST(0, next-current)) — handles meter resets by skipping only the reset gap. Auto-selects aggregation: raw (<24h), hourly (24h-7d), daily (>7d). Limit: 500k rows.';
