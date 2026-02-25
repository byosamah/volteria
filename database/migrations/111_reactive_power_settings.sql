-- Migration 111: Reactive Power Compensation Settings
-- Add reactive power / power factor correction settings to sites table.
-- Reactive power is an independent feature layer on top of the active power control (Zero Generator Feed).
-- Three modes: dynamic_pf (recommended), fixed_pf, fixed_kvar

ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS reactive_power_enabled boolean DEFAULT false;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS reactive_power_mode text DEFAULT 'dynamic_pf';
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS target_power_factor numeric DEFAULT 0.95;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS target_reactive_kvar numeric DEFAULT 0;

-- Add check constraints
ALTER TABLE public.sites ADD CONSTRAINT chk_reactive_power_mode
  CHECK (reactive_power_mode IN ('dynamic_pf', 'fixed_pf', 'fixed_kvar'));

ALTER TABLE public.sites ADD CONSTRAINT chk_target_power_factor
  CHECK (target_power_factor >= 0.8 AND target_power_factor <= 1.0);

ALTER TABLE public.sites ADD CONSTRAINT chk_target_reactive_kvar
  CHECK (target_reactive_kvar >= 0);
