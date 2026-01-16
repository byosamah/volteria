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
│  Layer 5: LOGGING SERVICE                   │
│  Data logging, cloud sync, alarms           │
├─────────────────────────────────────────────┤
│  Layer 4: CONTROL SERVICE                   │
│  Zero-feeding algorithm, operation modes    │
├─────────────────────────────────────────────┤
│  Layer 3: DEVICE SERVICE                    │
│  Modbus I/O, polling, register writes       │
├─────────────────────────────────────────────┤
│  Layer 2: CONFIG SERVICE                    │
│  Sync, caching, version management          │
├─────────────────────────────────────────────┤
│  Layer 1: SYSTEM SERVICE (always alive)     │
│  Heartbeat, OTA updates, health monitoring  │
└─────────────────────────────────────────────┘
```

> **Deep Dive**: See [controller/CONTROL_MASTER.md](./controller/CONTROL_MASTER.md) for architecture decisions, design patterns, and troubleshooting.

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Zero-feeding** | Limits solar output to prevent reverse power to DG (reserve min: 0 kW) |
| **Device Types** | Load Meters, Solar Inverters, DG Controllers |
| **Config Modes** | `meter_inverter`, `dg_inverter`, `full_system` |
| **Sites** | Projects contain Sites; each Site has own devices + settings |
| **Heartbeat** | Controller → cloud every 30s; offline after 1 min silence |
| **Safe Mode** | Auto-limits solar when device communication fails |

### User Roles
| Role | Level | Access |
|------|-------|--------|
| Super Admin | 6 | Full system |
| Backend Admin | 5 | Backend management |
| Admin | 4 | All projects, create users |
| Enterprise Admin | 3 | Enterprise scope |
| Configurator | 2 | Edit + remote control |
| Viewer | 1 | View only |

## Database Access (Supabase)

Claude has direct REST API access. **Never ask user to run migrations manually.**

```bash
# Query
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/TABLE?select=*&limit=10" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzZ3hoemRjdHp0aGNxeHl4ZnhsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTAwOTQ2MywiZXhwIjoyMDgwNTg1NDYzfQ.4iKrB2pv7OVaKv_VY7QoyWQzSPuALcNPNJnD5S3Z74I" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzZ3hoemRjdHp0aGNxeHl4ZnhsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTAwOTQ2MywiZXhwIjoyMDgwNTg1NDYzfQ.4iKrB2pv7OVaKv_VY7QoyWQzSPuALcNPNJnD5S3Z74I"
```

**Credentials**: URL `https://usgxhzdctzthcqxyxfxl.supabase.co` | DB Password in `.env`

**Run migrations** (Supabase CLI):
```bash
# From project root
supabase db push --db-url "postgresql://postgres.usgxhzdctzthcqxyxfxl:$SUPABASE_DB_PASSWORD@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require"
```

**Schema changes**: Use Supabase CLI (`supabase db push`) or [SQL Editor](https://supabase.com/dashboard/project/usgxhzdctzthcqxyxfxl/sql)

### Key Tables
| Table | Purpose |
|-------|---------|
| `users` | Accounts (RLS disabled) |
| `projects`, `sites` | Project/site hierarchy |
| `site_devices` | Device configs per site |
| `device_templates` | Reusable device definitions |
| `control_logs`, `alarms` | Time-series data |
| `controller_heartbeats` | Controller status |
| `controller_service_status` | 5-layer health tracking |

> **Full schema**: See `database/migrations/` (77+ migration files)

## Deployment

```bash
# Pre-deploy (always run first)
cd frontend && npm run build && npm test

# Deploy to production
git add . && git commit -m "message" && git push origin main
ssh volteria "cd /opt/solar-diesel-controller && git pull && docker-compose up -d --build"

# If 502 errors after deploy
ssh volteria "docker restart sdc-nginx"

# Check status
ssh volteria "docker-compose -f /opt/solar-diesel-controller/docker-compose.yml ps"

# View logs
ssh volteria "docker logs sdc-backend --tail=50"
ssh volteria "docker logs sdc-frontend --tail=50"
```

**Live URL**: https://volteria.org | **Server**: 159.223.224.203 | **GitHub**: github.com/byosamah/volteria

## Component References

| Component | Documentation |
|-----------|---------------|
| Controller | [controller/CLAUDE.md](./controller/CLAUDE.md) + [CONTROL_MASTER.md](./controller/CONTROL_MASTER.md) |
| Backend API | [backend/CLAUDE.md](./backend/CLAUDE.md) |
| Frontend | [frontend/CLAUDE.md](./frontend/CLAUDE.md) |
| Database | [database/CLAUDE.md](./database/CLAUDE.md) |
| Deploy | [deploy/CLAUDE.md](./deploy/CLAUDE.md) |
| Simulator | [simulator/CLAUDE.md](./simulator/CLAUDE.md) |
| Documentation | [docs/CLAUDE.md](./docs/CLAUDE.md) |

## Environment Variables

```bash
# Next.js (baked at BUILD time - pass as Docker build args)
NEXT_PUBLIC_SUPABASE_URL=https://usgxhzdctzthcqxyxfxl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Backend/API routes (runtime)
SUPABASE_URL=https://usgxhzdctzthcqxyxfxl.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
```

## Important Notes

1. **Controller entry point**: Use `main_v2.py` (5-layer architecture), not legacy `main.py`

2. **RLS**: `users` table has RLS **disabled** (prevents recursion); all other tables enabled

3. **Offline operation**: Controller works independently; SQLite buffers data, syncs on reconnect

4. **httpx version**: Backend requires `httpx==0.24.1` (newer breaks Supabase)

5. **Heartbeats**: Tied to `controller_id`, not sites. Deleting site/project sets FK to NULL, preserves history

6. **DG reserve**: Minimum is 0 kW (never negative)

7. **Invite flow**: Uses URL fragments (`#access_token=...`), handled by login page

## Recent Updates (2026-01-17)

### Logging System Improvements
- **Local vs Cloud Logging Separation**: Local logging writes ALL readings at site interval; cloud sync filters by per-register `logging_frequency`
- **New Toggle**: Site settings now has "Local Logging" checkbox (migration 077: `logging_local_enabled` column)
- **Data Flow**:
  ```
  Device Service → SharedState
       ↓
  LOCAL (if enabled): Every logging_local_interval_ms → Write ALL to SQLite
       ↓
  CLOUD (if enabled): Every logging_cloud_interval_ms → Filter by register frequency → Supabase
  ```

### Reboot API Authentication
- **Controller Self-Auth**: Reboot endpoint now accepts `controller_secret` (SSH password) for authentication
- **Use Case**: OTA updates, wizard automation, maintenance scripts
- **Example**: `curl -X POST ".../reboot" -d '{"controller_secret": "..."}'`

### Config Sync Fix
- Controller config service uses SharedState consistently for caching
- Config syncs to `/run/volteria/state/config.json`

## Never Do

- NEVER over-engineer
- NEVER hardcode values
- NEVER use fallback systems
- NEVER use caching
- NEVER deploy without running `npm run build` first
