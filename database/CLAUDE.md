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
├── migrations/     # 80 migration files (001-074)
├── schema.sql      # Consolidated schema reference
└── run_schema.py   # Schema runner utility
```

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
| 061-074 | Refinements | constraints, FK fixes, SSH |

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

## Creating New Migrations

```sql
-- File: database/migrations/NNN_description.sql
-- Always include:
-- 1. IF NOT EXISTS / IF EXISTS checks
-- 2. Comments explaining purpose
-- 3. Timestamp columns with defaults

CREATE TABLE IF NOT EXISTS new_table (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- columns...
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add RLS
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own data" ON new_table
    FOR SELECT USING (auth.uid() IS NOT NULL);
```
