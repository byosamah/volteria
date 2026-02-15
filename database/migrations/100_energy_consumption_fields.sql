-- Migration 100: Add delta calculation type + 6 energy consumption fields
-- Delta = (latest_counter - first_counter) per device per time window, summed across devices

-- 1. Add 'delta' to calculation_type CHECK constraint
ALTER TABLE public.calculated_field_definitions
  DROP CONSTRAINT IF EXISTS calculated_field_definitions_calculation_type_check;

ALTER TABLE public.calculated_field_definitions
  ADD CONSTRAINT calculated_field_definitions_calculation_type_check
  CHECK (calculation_type IN ('sum', 'difference', 'cumulative', 'average', 'max', 'min', 'delta'));

-- 2. Insert 6 energy consumption calculated field definitions
-- Hourly Load
INSERT INTO public.calculated_field_definitions (field_id, name, scope, calculation_type, time_window, unit, is_system, calculation_config)
VALUES (
  'hourly_load_energy_kwh',
  'Hourly Load Energy Consumption',
  'controller',
  'delta',
  'hour',
  'kWh',
  true,
  '{"register_role": "load_kwh_counter"}'::jsonb
) ON CONFLICT (field_id) DO NOTHING;

-- Daily Load
INSERT INTO public.calculated_field_definitions (field_id, name, scope, calculation_type, time_window, unit, is_system, calculation_config)
VALUES (
  'daily_load_energy_kwh',
  'Daily Load Energy Consumption',
  'controller',
  'delta',
  'day',
  'kWh',
  true,
  '{"register_role": "load_kwh_counter"}'::jsonb
) ON CONFLICT (field_id) DO NOTHING;

-- Hourly DG
INSERT INTO public.calculated_field_definitions (field_id, name, scope, calculation_type, time_window, unit, is_system, calculation_config)
VALUES (
  'hourly_dg_energy_kwh',
  'Hourly DG Energy Production',
  'controller',
  'delta',
  'hour',
  'kWh',
  true,
  '{"register_role": "diesel_generator_kwh_counter"}'::jsonb
) ON CONFLICT (field_id) DO NOTHING;

-- Daily DG
INSERT INTO public.calculated_field_definitions (field_id, name, scope, calculation_type, time_window, unit, is_system, calculation_config)
VALUES (
  'daily_dg_energy_kwh',
  'Daily DG Energy Production',
  'controller',
  'delta',
  'day',
  'kWh',
  true,
  '{"register_role": "diesel_generator_kwh_counter"}'::jsonb
) ON CONFLICT (field_id) DO NOTHING;

-- Hourly Solar
INSERT INTO public.calculated_field_definitions (field_id, name, scope, calculation_type, time_window, unit, is_system, calculation_config)
VALUES (
  'hourly_solar_energy_kwh',
  'Hourly Solar Energy Production',
  'controller',
  'delta',
  'hour',
  'kWh',
  true,
  '{"register_role": "solar_kwh_counter"}'::jsonb
) ON CONFLICT (field_id) DO NOTHING;

-- Daily Solar
INSERT INTO public.calculated_field_definitions (field_id, name, scope, calculation_type, time_window, unit, is_system, calculation_config)
VALUES (
  'daily_solar_energy_kwh',
  'Daily Solar Energy Production',
  'controller',
  'delta',
  'day',
  'kWh',
  true,
  '{"register_role": "solar_kwh_counter"}'::jsonb
) ON CONFLICT (field_id) DO NOTHING;
