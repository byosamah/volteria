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

## Diagnostic Skills

| Skill | Command | Use When |
|-------|---------|----------|
| Controller | `/check-controller` | Service health, SSH access, safe mode, architecture, SharedState |
| Setup | `/check-setup` | Wizard flow, provisioning, registration, SSH tunnel setup, tests |
| Logging | `/check-logging` | Data flow, SQLite, cloud sync, downsampling, drift, alarms |

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
7. **Controller deploy order**: `POST /api/controllers/{id}/update` pulls from git — commit and push BEFORE deploying
8. **Setup script auto-updates**: Controller setup clones from main — code fixes are automatically available to new controllers after push
9. **Config readers use SharedState**: All code reading device settings (services, CLI scripts) must use `get_config()` from `common.state` — never hardcode paths
10. **Debug HTTP errors by tracing full path**: Browser → Nginx → Frontend API → Backend → Database. Don't assume error source — check each hop.
11. **Device types must be synced**: When adding new device types to frontend/database, also add to `controller/common/config.py` DeviceType enum — controller skips devices with unrecognized types

## Key Architecture Decisions

### Logging System
- **RAM Buffer** → **SQLite** (every 60s) → **Cloud** (every 180s)
- Per-register `logging_frequency` controls cloud data density
- Clock-aligned timestamps for easy cross-device correlation
- **Config-filtered sampling**: Logging service only logs registers present in current config (source of truth)
- **Register rename**: Old name stops logging immediately after config sync; old data preserved as "Non-Active" in Historical Data
- **SQLite in thread pool**: All `local_db` calls run via `run_in_executor` — never block asyncio event loop
- **Smart backfill**: After offline recovery, syncs newest first (dashboard current), then fills gaps chronologically

### Historical Data
- Server-side aggregation via `get_historical_readings()` RPC
- Raw (30d max), Hourly (90d), Daily (2y)
- Local source available via SSH for super admins

### Device Config
- Devices dict structure: `{load_meters: [], inverters: [], generators: [], sensors: [], other: []}`
- Config uses merged template + manual registers

### Device Polling
- Exponential backoff on offline devices: 5s → 10s → 20s → 40s → 60s max
- Resets immediately on first successful read

### Deletion Cascade
```
Project → checks active sites only
Site → checks active devices (enabled = true)
Template → checks active devices in active sites
FK: site_devices.site_id CASCADE, site_devices.template_id SET NULL
```

### Nginx Routing (Frontend vs Backend API)
- Frontend Next.js API routes: `/api/controllers/[id]/test`, `/api/dashboards/*`, `/api/sites/*`, `/api/projects/*`
- Backend FastAPI routes: `/api/ssh-test/*`, `/api/controllers/[id]/(update|reboot|ssh|config|logs)`
- **If frontend API returns 404**: Check nginx regex patterns aren't routing to backend first
- Config file: `/opt/solar-diesel-controller/deploy/nginx.conf`
- After nginx config changes: `docker-compose restart nginx` (container has volume mount)

## Controller SSH Access

**Always read credentials from the `controllers` table** — never ask the user for passwords.

```sql
SELECT id, serial_number, ssh_port, ssh_username, ssh_password FROM controllers WHERE serial_number = 'SERIAL';
```

**SSH path** (from Windows, through DO server):
```bash
ssh root@159.223.224.203 "sshpass -p '<ssh_password>' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p <ssh_port> <ssh_username>@localhost '<command>'"
```

- Identify controller by serial number (user may provide serial or controller ID)
- Multiple controllers will exist in the future — always query the right one
- **SSH username varies** — query `ssh_username` from controllers table (voltadmin vs volteria)
- Pi WiFi connection name varies by OS image — never hardcode, detect with `nmcli`

**DO Server Requirements** (for tunnel auto-recovery):
- Sudoers entry: `volteria ALL=(root) NOPASSWD: /usr/bin/fuser` in `/etc/sudoers.d/volteria`
- TCP keepalives: `ClientAliveInterval 30`, `ClientAliveCountMax 3` in `/etc/ssh/sshd_config`

## Never Do

- NEVER over-engineer
- NEVER hardcode values
- NEVER use fallback systems
- NEVER use caching
- NEVER deploy without running `npm run build` first
- NEVER create DB functions without `SET search_path = ''`
- NEVER create tables without enabling RLS
- NEVER leave Supabase security advisor warnings unaddressed
- NEVER ask user for controller SSH passwords — read from controllers table
- NEVER add device types to frontend/database without also adding to `controller/common/config.py` DeviceType enum
- NEVER use `>= N` for consecutive-check auto-resolve guards — use `== N` (fire once on transition)

## Documentation Convention

- **CLAUDE.md** = Reference only (architecture, rules, commands, decisions)
- **CHANGELOG.md** = Timestamped history (bug fixes, feature launches)
- **Skills** = Diagnostic knowledge (self-contained, don't duplicate in CLAUDE.md)
- After every fix: promote the **rule** to CLAUDE.md, not the story
