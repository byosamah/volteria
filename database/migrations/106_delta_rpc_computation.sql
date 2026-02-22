-- Migration: Compute delta fields from raw counter readings in RPC
-- Purpose: Instead of reading pre-computed delta values (which have wrong timestamps
--          due to DeltaTracker's completed-window-totals pattern), compute deltas
--          on-the-fly from source kWh counter registers with correct timezone alignment.
--
-- How it works:
--   1. Detect if requested registers are delta calculated fields
--   2. For delta fields: find source devices/registers via register_role,
--      compute MAX(value)-MIN(value) per device per timezone-aligned bucket,
--      SUM across devices
--   3. Non-delta registers: normal query path (unchanged)
--   4. UNION ALL both result sets

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
  -- Bucket size per field: logging_frequency_seconds determines natural granularity
  -- (3600=hourly, 86400=daily). Only aggregate UP (hourly→daily), never down.
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
  device_deltas AS (
    SELECT
      sr.field_name,
      sr.field_unit,
      sr.src_site_id,
      sr.src_device_id,
      -- Hourly fields (<=3600s) use hourly buckets unless daily aggregation requested
      -- Daily fields (>3600s) always use daily buckets
      CASE
        WHEN sr.field_frequency <= 3600 AND v_aggregation <> 'daily'
          THEN date_trunc('hour', dr.timestamp AT TIME ZONE p_timezone)
        ELSE date_trunc('day', dr.timestamp AT TIME ZONE p_timezone)
      END AS bucket_key,
      MAX(dr.value) - MIN(dr.value) AS delta_value
    FROM source_registers sr
    JOIN public.device_readings dr
      ON dr.device_id = sr.src_device_id
      AND dr.register_name = sr.src_register_name
      AND dr.timestamp BETWEEN p_start AND p_end
    GROUP BY sr.field_name, sr.field_unit, sr.src_site_id, sr.src_device_id, bucket_key
    HAVING COUNT(*) >= 2
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
  GROUP BY md.site_id, md.master_id, dd.field_name, dd.bucket_key
  ORDER BY bucket
  LIMIT 500000;
END;
$$;

COMMENT ON FUNCTION public.get_historical_readings IS 'Server-side aggregation for historical data. Timezone-aware bucketing for hourly/daily. Delta calculated fields computed on-the-fly from source counter readings (not pre-computed values). Auto-selects aggregation: raw (<24h), hourly (24h-7d), daily (>7d). Limit: 500k rows.';
