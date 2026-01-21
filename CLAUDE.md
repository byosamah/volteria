# Volteria - Energy Management

> Industrial hybrid power management system for preventing reverse feeding to diesel generators

## Development Commands

```bash
# Frontend - Build & Test (run before deploying)
cd frontend && npm run build     # TypeScript/build verification
cd frontend && npm test          # Browser e2e tests

# Local Development
cd frontend && npm run dev       # Frontend at localhost:3000
cd backend && uvicorn app.main:app --reload  # Backend at localhost:8000
cd simulator && python run_simulation.py     # Virtual testing

# Controller (Raspberry Pi)
python main_v2.py --dry-run      # Validate config
python main_v2.py                # Start all 5 services
python main_v2.py -v             # Verbose/debug mode
```

**Test Account**: `mohkof1106@gmail.com` / `Solar@1996`

## Technology Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 16 (App Router) + React 19 + Tailwind 4 |
| Backend | FastAPI 0.109.0 (Python) |
| Database | Supabase (PostgreSQL) |
| Controller | Python 3.11+ pymodbus (Raspberry Pi 5) |
| Deployment | Docker Compose on DigitalOcean |

## Architecture Overview

### Cloud Infrastructure
```
DigitalOcean (159.223.224.203)
+-------------+    +---------------------------+
|   Nginx     |--->|  Next.js Frontend (:3000) |
|   (SSL)     |    +---------------------------+
|  Port 443   |    +---------------------------+
|             |--->|  FastAPI Backend (:8000)  |
+-------------+    +---------------------------+
         |
         v
  https://volteria.org
```

### Controller Architecture (5-Layer)
```
┌─────────────────────────────────────────────┐
│  Layer 5: LOGGING - Data logging, cloud sync│
├─────────────────────────────────────────────┤
│  Layer 4: CONTROL - Zero-feeding algorithm  │
├─────────────────────────────────────────────┤
│  Layer 3: DEVICE - Modbus I/O, polling      │
├─────────────────────────────────────────────┤
│  Layer 2: CONFIG - Sync, version management │
├─────────────────────────────────────────────┤
│  Layer 1: SYSTEM - Heartbeat, OTA, health   │
└─────────────────────────────────────────────┘
```

> **Deep Dive**: See [controller/CONTROL_MASTER.md](./controller/CONTROL_MASTER.md)

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Zero-feeding** | Limits solar output to prevent reverse power to DG (reserve min: 0 kW) |
| **Device Types** | Load Meters, Solar Inverters, DG Controllers, Temperature Sensors |
| **Config Modes** | `meter_inverter`, `dg_inverter`, `full_system` |
| **Heartbeat** | Controller → cloud every 30s; offline after 1 min silence |
| **Safe Mode** | Auto-limits solar when device communication fails |

### User Roles
| Role | Level | Access |
|------|-------|--------|
| Super Admin | 6 | Full system |
| Admin | 4 | All projects, create users |
| Configurator | 2 | Edit + remote control |
| Viewer | 1 | View only |

## Database Access (Supabase)

Claude has direct REST API access. **Never ask user to run migrations manually.**

```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/TABLE?select=*&limit=10" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzZ3hoemRjdHp0aGNxeHl4ZnhsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTAwOTQ2MywiZXhwIjoyMDgwNTg1NDYzfQ.4iKrB2pv7OVaKv_VY7QoyWQzSPuALcNPNJnD5S3Z74I" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzZ3hoemRjdHp0aGNxeHl4ZnhsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTAwOTQ2MywiZXhwIjoyMDgwNTg1NDYzfQ.4iKrB2pv7OVaKv_VY7QoyWQzSPuALcNPNJnD5S3Z74I"
```

**Run migrations** (Supabase CLI):
```bash
supabase db push --db-url "postgresql://postgres.usgxhzdctzthcqxyxfxl:$SUPABASE_DB_PASSWORD@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require"
```

### Key Tables
| Table | Purpose |
|-------|---------|
| `users` | Accounts (RLS disabled) |
| `projects`, `sites` | Project/site hierarchy |
| `site_devices` | Device configs per site |
| `device_templates` | Reusable device definitions |
| `control_logs`, `device_readings` | Time-series data |
| `alarms` | System alarms with auto-resolve |
| `controller_heartbeats` | Controller status |

## Deployment

```bash
# Pre-deploy (always run first)
cd frontend && npm run build && npm test

# Deploy to production
git add . && git commit -m "message" && git push origin main
ssh volteria "cd /opt/solar-diesel-controller && git pull && docker-compose up -d --build"

# If 502 errors after deploy
ssh volteria "docker restart sdc-nginx"

# View logs
ssh volteria "docker logs sdc-backend --tail=50"
ssh volteria "docker logs sdc-frontend --tail=50"
```

**Live URL**: https://volteria.org | **Server**: 159.223.224.203

## Component References

| Component | Documentation |
|-----------|---------------|
| Controller | [controller/CLAUDE.md](./controller/CLAUDE.md) |
| Backend API | [backend/CLAUDE.md](./backend/CLAUDE.md) |
| Frontend | [frontend/CLAUDE.md](./frontend/CLAUDE.md) |
| Database | [database/CLAUDE.md](./database/CLAUDE.md) |

## Environment Variables

```bash
# Next.js (baked at BUILD time)
NEXT_PUBLIC_SUPABASE_URL=https://usgxhzdctzthcqxyxfxl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Backend (runtime)
SUPABASE_URL=https://usgxhzdctzthcqxyxfxl.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
```

## Critical Notes

1. **Controller entry point**: Use `main_v2.py`, not legacy `main.py`
2. **RLS**: `users` table has RLS **disabled** (prevents recursion)
3. **Offline operation**: Controller buffers to SQLite, syncs on reconnect
4. **httpx version**: Backend requires `httpx==0.24.1`
5. **DG reserve**: Minimum is 0 kW (never negative)
6. **Template linkage**: Template registers are live references, not copies

## Key Architecture Decisions

### Logging System
- **RAM Buffer** → **SQLite** (every 60s) → **Cloud** (every 180s)
- Per-register `logging_frequency` controls cloud data density
- Clock-aligned timestamps for easy cross-device correlation

### Historical Data
- Server-side aggregation via `get_historical_readings()` RPC
- Raw (30d max), Hourly (90d), Daily (2y)
- Local source available via SSH for super admins

### Device Config
- Devices dict structure: `{load_meters: [], inverters: [], generators: [], sensors: [], other: []}`
- Config uses merged template + manual registers

## Never Do

- NEVER over-engineer
- NEVER hardcode values
- NEVER use fallback systems
- NEVER use caching
- NEVER deploy without running `npm run build` first
- NEVER create DB functions without `SET search_path = ''`
- NEVER create tables without enabling RLS
- NEVER leave Supabase security advisor warnings unaddressed

## Recent Updates (2026-01-21)

### Device Connection Alarms
- **`not_reporting` alarm**: Auto-created when device stops sending data (10 min timeout)
- **Auto-resolve**: Cron job runs every 5 min, resolves alarm when device reconnects
- **DB functions**: `check_device_connection_status()`, `create_not_reporting_alarm()`, `resolve_not_reporting_alarm()`
- **Toggle**: Per-device `connection_alarm_enabled` controls alarm creation (device still goes offline)
- **Migration 083**: Device status (`is_online`) updates regardless of alarm toggle

### Config Sync Fix
- **Trigger fix**: `site_devices.updated_at` no longer updates for operational fields (`is_online`, `last_seen`, `last_error`)
- **Prevents**: False "sync needed" warnings when controller updates device status

### Controller Fixes
- **Stale readings**: Device manager deletes old readings when device read fails
- **Logger fix**: Fixed `logger._logger` AttributeError in register_reader

### Frontend Fixes
- **connection_alarm_enabled**: Site page query now includes field for correct toggle state
- **Master device physical**: Removed TCP from dropdown (RTU settings only: RS-485, RS-232)

### Alarms Table Enhancement
- Shows site and project info for each alarm
- Removed deprecated `timeout_multiplier` field from UI
