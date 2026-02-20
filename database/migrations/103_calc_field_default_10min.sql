-- Change default logging frequency for calculated fields to 10 min (600s)
-- Delta fields keep their locked frequencies (3600s hourly, 86400s daily)
-- Applied: 2026-02-20

UPDATE public.calculated_field_definitions
SET logging_frequency_seconds = 600
WHERE calculation_type != 'delta';
