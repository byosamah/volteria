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
| 082+ | Connection alarms | not_reporting alarm infrastructure |

## RPC Functions

### Device Connection Alarm Functions (Migration 082)
Automated alarm system for devices that stop reporting data.

```sql
-- Check all devices and create/resolve alarms (runs via cron every 5 min)
SELECT * FROM check_device_connection_status(600);  -- 600s = 10 min timeout

-- Create alarm for non-reporting device
SELECT create_not_reporting_alarm(site_id, device_id, device_name);

-- Resolve alarm when device comes back online
SELECT resolve_not_reporting_alarm(site_id, device_name);

-- Get list of non-reporting devices
SELECT * FROM get_non_reporting_devices(600);

-- Check if site controller is online
SELECT is_site_controller_online(site_id);
```

**Cron Job**: `check-device-alarms` runs every 5 minutes (`*/5 * * * *`)

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
CHECK (device_type IN ('inverter', 'load_meter', 'dg', 'sensor'))
```

### Measurement Type Constraint
```sql
CHECK (measurement_type IN ('load', 'sub_load', 'solar', 'generator', 'fuel', 'sensor'))
```

### Severity Levels
```sql
CHECK (severity IN ('info', 'warning', 'major', 'critical'))
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
1. Run `get_advisors(type: 'security')` after migrations
2. Zero `function_search_path_mutable` warnings
3. Avoid `rls_policy_always_true` for write operations
4. Use `public.table_name` in all function bodies

### Known Exceptions (documented)
| Item | Reason |
|------|--------|
| `users` RLS disabled | Prevents infinite recursion |
| Permissive INSERT on `controller_heartbeats`, `device_readings` | Controller auth via secret, not JWT |

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
