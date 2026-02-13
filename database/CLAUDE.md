# Database - CLAUDE.md

> Supabase (PostgreSQL) schema and migrations for Volteria platform

## Quick Reference

```bash
# Query via REST API (Claude has direct access)
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/TABLE?select=*" \
  -H "apikey: SERVICE_KEY" -H "Authorization: Bearer SERVICE_KEY"

# Schema changes: Use Supabase SQL Editor
# https://supabase.com/dashboard/project/usgxhzdctzthcqxyxfxl/sql
```

## Structure

```
database/
└── migrations/     # 80+ migration files
```

### Supabase CLI Commands

```bash
# Push migrations to remote database
supabase db push --db-url "postgresql://postgres.usgxhzdctzthcqxyxfxl:[PASSWORD]@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require"

# Dump schema from live DB
supabase db dump --linked -p [PASSWORD] > schema_dump.sql
```

> **Note**: Password stored in `.env` as `SUPABASE_DB_PASSWORD`

## Core Tables

| Table | Purpose | RLS |
|-------|---------|-----|
| `users` | User accounts + roles | **Disabled** |
| `enterprises` | Multi-tenant organizations | Enabled |
| `projects` | Project containers | Enabled |
| `sites` | Sites within projects (all settings here) | Enabled |
| `site_devices` | Device configurations per site | Enabled |
| `device_templates` | Reusable device definitions | Enabled |
| `controller_templates` | Controller alarm/field definitions | Enabled |

## Data Tables

| Table | Purpose |
|-------|---------|
| `control_logs` | Time-series power readings |
| `device_readings` | Per-device register readings |
| `alarms` | System and threshold alarms |
| `audit_logs` | User action history |
| `controller_heartbeats` | Controller online status |
| `controller_service_status` | 5-layer health tracking |

## Feature Tables

| Table | Purpose |
|-------|---------|
| `site_dashboards` + `dashboard_widgets` | Custom dashboards |
| `site_alarm_overrides` | Per-site threshold overrides |
| `cron.job` | Scheduled tasks (pg_cron extension) |
| `calculated_field_definitions` | Computed metrics formulas |
| `notification_preferences` + `notifications` | Alert system |
| `control_commands` | Remote control audit trail |
| `firmware_releases` + `controller_updates` | OTA updates |

## User Roles Hierarchy

| Role | Level | Access |
|------|-------|--------|
| `super_admin` | 6 | Full system |
| `backend_admin` | 5 | Backend management |
| `admin` | 4 | All projects, create users |
| `enterprise_admin` | 3 | Enterprise scope |
| `configurator` | 2 | Edit + remote control |
| `viewer` | 1 | Read-only |

## Migration Categories

| Range | Category | Examples |
|-------|----------|----------|
| 001-013 | Core schema | users, projects, sites, devices |
| 014-025 | Features | registers, notifications, audit |
| 026-040 | Alarms & fields | thresholds, calculated fields |
| 041-050 | Dashboards | widgets, retention policies |
| 051-060 | Enterprise | subscriptions, firmware/OTA |
| 061-077 | Refinements | constraints, FK fixes, cleanup |
| 078-079 | Historical | RPC functions, aggregation |
| 080-081 | Security | SECURITY DEFINER views, RLS policies |
| 082-083 | Connection alarms | not_reporting alarm infrastructure |
| 084-088 | Historical fixes | distinct register names RPC, source column, controllers RLS |
| 089-091 | Alarm severity | connection_alarm_severity, 'minor' level, device-specific severity |
| 092 | Alarm improvements | condition column for threshold display |
| 093 | Security fixes | SECURITY DEFINER functions search_path |
| 094 | Belt scale support | belt_scale device type for conveyor integrators |
| 095 | Controller offline alarm | pg_cron job for controller_offline alarm detection |
| 099 | Alarm device_id | Match alarms by device_id UUID instead of device_name TEXT |

## RPC Functions

### Device Connection Alarm Functions (Migration 082)
Automated alarm system for devices that stop reporting data.

```sql
-- Check all devices and create/resolve alarms (runs via cron every 5 min)
SELECT * FROM check_device_connection_status(600);  -- 600s = 10 min timeout

-- Create alarm for non-reporting device
SELECT create_not_reporting_alarm(site_id, device_id, device_name);

-- Resolve alarm when device comes back online
SELECT resolve_not_reporting_alarm(site_id, device_id, device_name);

-- Get list of non-reporting devices
SELECT * FROM get_non_reporting_devices(600);

-- Check if site controller is online
SELECT is_site_controller_online(site_id);
```

**Cron Job**: `check-device-alarms` runs every 5 minutes (`*/5 * * * *`)

### Controller Offline Alarm Functions (Migration 095)
Automated alarm system for controllers that stop sending heartbeats.

```sql
-- Check all controllers and create/resolve alarms (runs via cron every 5 min)
SELECT * FROM check_controller_connection_status(120);  -- 120s = 2 min timeout (4 missed heartbeats)

-- Create alarm for offline controller
SELECT create_controller_offline_alarm(site_id, controller_name, severity);

-- Resolve alarm when heartbeat resumes
SELECT resolve_controller_offline_alarm(site_id);

-- Get list of offline controllers
SELECT * FROM get_offline_controllers(120);

-- Get list of online controllers (for auto-resolve)
SELECT * FROM get_online_controllers(120);
```

**Cron Job**: `check-controller-alarms` runs every 5 minutes (`*/5 * * * *`)

**Settings**: Stored in `site_master_devices` table:
- `controller_alarm_enabled` (boolean, default true)
- `controller_alarm_severity` (text: warning/minor/major/critical, default 'critical')

### get_historical_readings (Migration 078)
Server-side aggregation for historical data visualization. Bypasses max_rows limit by aggregating in database.

```sql
SELECT * FROM get_historical_readings(
  p_site_ids := ARRAY['uuid-1', 'uuid-2']::UUID[],
  p_device_ids := ARRAY['uuid-1']::UUID[],
  p_registers := ARRAY['Total Active Power']::TEXT[],
  p_start := '2026-01-10T00:00:00Z'::TIMESTAMPTZ,
  p_end := '2026-01-17T00:00:00Z'::TIMESTAMPTZ,
  p_aggregation := 'auto'  -- 'raw', 'hourly', 'daily', 'auto'
);
```

**Returns**: `site_id, device_id, register_name, bucket, value, min_value, max_value, sample_count, unit`

**Auto-selection logic**:
- < 24h → raw
- 24h - 7d → hourly
- > 7d → daily

## Key Patterns

### Device Type Constraint
```sql
-- Modern types (see frontend/src/lib/device-constants.ts for canonical list)
CHECK (device_type IN (
    'inverter', 'wind_turbine', 'bess',
    'gas_generator_controller', 'diesel_generator_controller',
    'energy_meter', 'capacitor_bank',
    'fuel_level_sensor', 'fuel_flow_meter',
    'temperature_humidity_sensor', 'solar_radiation_sensor', 'wind_sensor',
    'belt_scale',  -- Conveyor belt scale integrators
    'other_hardware',
    -- Legacy types (still valid for backwards compatibility)
    'load_meter', 'dg', 'sensor'
))
```

> **Source of Truth**: `frontend/src/lib/device-constants.ts` defines canonical device types used across the platform.

### Severity Levels
```sql
-- 5 levels: info < warning < minor < major < critical
CHECK (severity IN ('info', 'warning', 'minor', 'major', 'critical'))
```

## Row Level Security (RLS)

- **All tables have RLS enabled** except `users`
- `users` table disabled to prevent infinite recursion
- Policies use `auth.uid()` for user identification
- Service role key bypasses RLS

## Important Notes

1. **Always use TIMESTAMPTZ** - All timestamps stored in UTC
2. **CASCADE deletes** - Sites cascade to devices, logs, alarms
3. **Soft deletes** - Use `is_active` flags, not DELETE
4. **JSONB for flexibility** - registers, alarm_definitions, metadata
5. **Run migrations in order** - Dependencies exist between files

## Supabase Best Practices (REQUIRED)

**All new database code MUST pass Supabase security advisors with zero warnings.**

### Functions
```sql
-- ALWAYS include SET search_path = '' to prevent search path injection
CREATE OR REPLACE FUNCTION public.my_function()
RETURNS void LANGUAGE plpgsql
SET search_path = ''  -- REQUIRED
AS $function$
BEGIN
    -- Use fully qualified table names: public.table_name
    SELECT * FROM public.my_table;
END;
$function$;
```

### Tables
```sql
-- ALWAYS enable RLS on new tables
ALTER TABLE public.new_table ENABLE ROW LEVEL SECURITY;

-- Create specific policies (avoid USING (true) for INSERT/UPDATE/DELETE)
CREATE POLICY "Users can view own project data" ON public.new_table
    FOR SELECT USING (
        project_id IN (SELECT project_id FROM public.user_projects WHERE user_id = auth.uid())
    );
```

### Pre-commit Checklist
1. Run Security Advisor after migrations
2. Zero `function_search_path_mutable` warnings ✅ (fixed in migration 093)
3. `rls_policy_always_true` warnings documented below as accepted exceptions
4. Use `public.table_name` in all function bodies

### Known Exceptions (documented)

**RLS Disabled:**
| Table | Reason |
|-------|--------|
| `users` | Prevents infinite recursion in RLS policies |

**Permissive System INSERT Policies** (intentional - system/controller writes):
| Table | Policy | Reason |
|-------|--------|--------|
| `controller_heartbeats` | INSERT `WITH CHECK (true)` | Controller auth via service key |
| `device_readings` | INSERT `TO service_role` | Controller cloud sync |
| `control_logs` | INSERT `WITH CHECK (true)` | Controller auth |
| `alarms` | INSERT/UPDATE `WITH CHECK (true)` | Controller creates, users resolve |
| `audit_logs` | INSERT `WITH CHECK (true)` | System writes, immutable |
| `api_request_logs` | INSERT `WITH CHECK (true)` | System writes only |
| `enterprise_usage_snapshots` | INSERT `WITH CHECK (true)` | System writes only |
| `notifications` | INSERT `WITH CHECK (true)` | System creates notifications |

**Permissive User Policies** (accepted for single-tenant, revisit for multi-tenant):
| Table | Policy | Risk | Reason |
|-------|--------|------|--------|
| `projects` | ALL `USING (true)` | Medium | Single enterprise, trusted users |
| `site_devices` | ALL/INSERT/UPDATE/DELETE | Medium | Same |
| `site_master_devices` | INSERT/UPDATE/DELETE | Medium | Same |
| `user_projects` | ALL `USING (true)` | Medium | Same |
| `site_test_results` | INSERT/UPDATE | Low | Test data only |
| `user_project_notifications` | ALL `USING (true)` | Low | User preferences |

**Other:**
| Item | Reason |
|------|--------|
| Service key to controllers | Controllers are trusted physical devices on customer sites |

---

## Creating New Migrations

```sql
-- File: database/migrations/NNN_description.sql
-- Always include:
-- 1. IF NOT EXISTS / IF EXISTS checks
-- 2. Comments explaining purpose
-- 3. Timestamp columns with defaults
-- 4. SET search_path = '' for functions

CREATE TABLE IF NOT EXISTS public.new_table (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- columns...
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add RLS
ALTER TABLE public.new_table ENABLE ROW LEVEL SECURITY;

-- Specific policy (not USING (true))
CREATE POLICY "Users can view own data" ON public.new_table
    FOR SELECT USING (
        auth.uid() IS NOT NULL
        AND user_id = auth.uid()
    );
```
