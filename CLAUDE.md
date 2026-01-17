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
| **Device Types** | Load Meters, Solar Inverters, DG Controllers, Temperature Sensors |
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

> **Full schema**: See `database/migrations/` (78+ migration files)

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

### Historical Data V2 - Server-Side Aggregation (NEW)
Large dataset support with database-level aggregation:

**Problem**: Client fetching 100,000+ rows is slow and hits Supabase max_rows limits.

**Solution**: PostgreSQL RPC function aggregates data server-side:
```
┌─────────────────────────────────────────────┐
│  Frontend: Select date range + aggregation  │
│              ↓                              │
│  API Route: /api/historical                 │
│              ↓                              │
│  RPC: get_historical_readings()             │
│  - Raw: Returns all points (LIMIT 50k)      │
│  - Hourly: AVG/MIN/MAX per hour             │
│  - Daily: AVG/MIN/MAX per day               │
│              ↓                              │
│  Response: Pre-aggregated data + metadata   │
└─────────────────────────────────────────────┘
```

**Date Range Limits** (enforced by UI and auto-switch):
| Aggregation | Max Range | Points/Device |
|-------------|-----------|---------------|
| Raw | 7 days | ~10,000-20,000 |
| Hourly | 90 days | ~2,160 |
| Daily | 2 years | ~730 |

**Auto-Selection** (when aggregation="auto"):
- < 24h → Raw data
- 24h - 7d → Hourly aggregation
- > 7d → Daily aggregation

**Key Files**:
- `database/migrations/078_historical_aggregation.sql` - RPC function
- `frontend/src/app/api/historical/route.ts` - Uses RPC instead of direct query
- `frontend/src/components/historical/v2/constants.ts` - MAX_DATE_RANGE limits
- `frontend/src/components/historical/v2/AggregationSelector.tsx` - Raw/Hourly/Daily + Avg/Min/Max

**Aggregation UI**:
- Time period: Raw | Hourly | Daily (unavailable periods disabled + strikethrough)
- Method (for Hourly/Daily): Avg | Min | Max
- Auto badge when system auto-selected
- Changes date range → auto-switches to available aggregation

### Historical Data Chart V2 - Multi-Site Support
Compare parameters from multiple projects/sites on the same chart:

**Features**:
- Add parameters from different projects, sites, and devices to same chart
- Site and device name shown in parameter cards, tooltips, and legend
- Format: `RegisterName` with `SiteName › DeviceName` below
- Parameters persist when changing project/site browser selection
- Date preset buttons (24h, 3d, 7d) highlight correctly when selected

**Parameter Sources**:
- **Master Device (Site Level)**: Site controller calculated fields (Total Load, Solar Generation, etc.)
- **Device**: Individual Modbus devices (inverters, meters, sensors)

**Key Files**:
- `frontend/src/components/historical/v2/ParameterSelector.tsx` - Multi-site parameter selection
- `frontend/src/components/historical/v2/ParameterCard.tsx` - Card with site/device info
- `frontend/src/components/historical/v2/OverlayTooltip.tsx` - Tooltip with site/device hierarchy
- `frontend/src/components/historical/v2/types.ts` - AxisParameter includes siteId, siteName, deviceName

### Historical Data Chart V2 - DOM Overlay Pattern
Performance-optimized chart for 500+ data points using DOM overlay instead of Recharts event handlers:

**Problem**: Recharts re-renders entire SVG on every mouse event (hover/drag), causing lag with large datasets.

**Solution**: DOM overlay layer that captures mouse events and manipulates elements directly:
```
┌─────────────────────────────────────────────┐
│  ChartContainer (relative positioning)      │
│  ┌───────────────────────────────────────┐  │
│  │  Recharts SVG (data visualization)    │  │
│  │  - No mouse handlers on chart         │  │
│  │  - Animations disabled for >100 pts   │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  ChartOverlay (absolute, z-10)        │  │
│  │  - Vertical cursor line (DOM div)     │  │
│  │  - Selection rectangle (DOM div)      │  │
│  │  - Tooltip (React state, minimal)     │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**Key Techniques**:
- Use `useRef` for drag state (no re-renders during interaction)
- Direct DOM manipulation: `cursorLineRef.current.style.transform = ...`
- Callback ref with ResizeObserver for reliable dimension tracking
- Pixel-to-index mapping: `Math.round((relativeX / plotWidth) * (data.length - 1))`
- Dynamic X-axis formatting based on zoom level (time/date/both)

**Files**:
- `frontend/src/components/historical/v2/ChartOverlay.tsx` - DOM overlay component
- `frontend/src/components/historical/v2/OverlayTooltip.tsx` - Positioned tooltip
- `frontend/src/components/historical/v2/HistoricalChart.tsx` - Main chart (no mouse handlers)

**When to Use**: Any Recharts visualization with 100+ data points that needs hover/zoom interaction.

### Historical Data - Next Steps
- **Local Data Source**: Query controller's SQLite via SSH/API (super admin only)
- **Pre-Aggregated Tables**: Materialized hourly/daily summaries for sub-second 1-year queries

### Live Registers Feature (NEW)
Real-time Modbus register read/write through web UI:
- **URL**: `/projects/[id]/sites/[siteId]/devices/[deviceId]/live-registers`
- **Flow**: Frontend → Next.js API → FastAPI → SSH to controller → `register_cli.py` → Modbus device
- **Features**:
  - Read registers grouped by section (Logging/Visualization/Alarms)
  - Write to holding registers with verification
  - Sequential write queue (500ms delay) prevents Modbus timeouts
  - Automatic value scaling based on register config

**Key Files**:
- `frontend/src/components/devices/live-registers/` - UI components
- `frontend/src/app/api/controllers/[controllerId]/registers/route.ts` - API proxy
- `backend/app/routers/controllers.py` - SSH execution endpoints
- `controller/register_cli.py` - Standalone Modbus CLI tool

### Controller Wizard Improvements
- **NVMe Boot Detection**: Now reads from `approved_hardware.features.nvme_boot` instead of hardcoded list
- Future hardware types automatically get NVMe setup instructions if `features.nvme_boot: true`

### RAM Buffering for Logging
Reduces SSD/SD card wear by 60x through RAM buffering:
```
Device Service → SharedState (raw readings every 1s)
       ↓
RAM BUFFER (sample every 1s, max 10,000 readings ~2-3MB)
       ↓
LOCAL SQLITE (flush every 60s = 1 write/min)
       ↓
CLOUD SYNC (every 180s, downsampled per-register)
```

**Key Settings**:
| Setting | Default | Description |
|---------|---------|-------------|
| `local_sample_interval_s` | 1s | Sample into RAM |
| `local_flush_interval_s` | 60s | Flush RAM to SQLite |
| `cloud_sync_interval_s` | 180s | Sync to Supabase |
| `logging_frequency` | per-register | Cloud data density |

### Per-Register Cloud Downsampling
- Each register has its own `logging_frequency` (1s to 3600s)
- Cloud sync downsamples based on frequency (e.g., 60s = 1 reading/min)
- Local SQLite keeps full resolution; cloud gets configurable density
- All registers sync together in one batch (not separate times)

### Controller Remote Update
- **New Endpoint**: `POST /api/controllers/{id}/update`
- **Auth**: `controller_secret` (SSH password) or admin JWT
- **Action**: Runs `git pull` and restarts services on controller
- **Use Case**: OTA updates without SSH tunnel access

### Nginx Routing Fix
- Controller backend operations (`/update`, `/reboot`, `/ssh`, `/config`, `/test`, `/registers/read`, `/registers/write`) route to FastAPI
- Controller frontend routes (`/heartbeats`, `/lookup`, `/register`, `/registers`) route to Next.js

### Logging System Architecture
- **Local vs Cloud Separation**: Local writes ALL readings; cloud filters by per-register `logging_frequency`
- **Local Logging Toggle**: Site settings checkbox (migration 077: `logging_local_enabled`)
- **Device Readings Table**: Separate `device_readings` table for granular cloud sync
- **Conflict Handling**: `Prefer: resolution=ignore-duplicates` header + graceful 409 handling

### Controller Setup Improvements
- **SSH Auto-Assign**: `/register` endpoint auto-assigns SSH credentials
- **Full Git Clone**: Setup script clones full repo for easier `git pull` updates
- **Simplified Ethernet**: Setup script skips ethernet gateway config (WiFi primary)
- **SharedState Caching**: Config service uses SharedState consistently

### API Authentication
- **Controller Self-Auth**: Reboot/update accept `controller_secret` without user JWT
- **Use Case**: OTA updates, wizard automation, maintenance scripts

### New Database Migrations
- **075**: Cleanup users table
- **076**: Add phone column to users
- **077**: Add `logging_local_enabled` to sites
- **078**: Add `get_historical_readings` RPC function for server-side aggregation

### Device Types
- **Temperature Sensor**: Added `sensor` device type for environmental monitoring

## Never Do

- NEVER over-engineer
- NEVER hardcode values
- NEVER use fallback systems
- NEVER use caching
- NEVER deploy without running `npm run build` first
