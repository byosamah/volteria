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

> **Full schema**: See `database/migrations/` (78 migration files)

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

## Recent Updates (2026-01-18)

### Controller OTA Update Safety (NEW)
Prevents runtime directories from being wiped during OTA updates:

**Problem**: `git reset --hard` during updates removed `/opt/volteria/{backup,updates,logs}` directories (not tracked in git), causing systemd NAMESPACE errors and service crashes.

**Solution** (two-layer fix):
| Layer | Fix | Purpose |
|-------|-----|---------|
| Git | Added `.gitkeep` files to `backup/`, `updates/`, `logs/` | Directories survive `git reset` |
| Backend | Update endpoint recreates dirs after git reset | Failsafe for existing controllers |
| Setup | `create_directories` now runs AFTER `git clone` | Fresh installs work correctly |

**Files Changed**:
- `backup/.gitkeep`, `updates/.gitkeep`, `logs/.gitkeep` - New tracked directories
- `backend/app/routers/controllers.py` - Recreates dirs after git operations
- `controller/scripts/setup-controller.sh` - Fixed execution order

### Dashboard Metric Labels (NEW)
Renamed metrics for clarity to avoid confusion between hardware uptime and cloud connectivity:

| Before | After | Location |
|--------|-------|----------|
| Running | **Hardware Uptime** | Controller Health card |
| Connection Status | **Cloud Connection** | Chart title |
| Uptime: X% | **Connected:** X% | Connection stats |
| Offline: Xm | **Disconnected:** Xm | Connection stats |

**Description**: "Hardware connection to cloud history (heartbeat gaps)"

**Files Changed**:
- `frontend/src/components/sites/controller-health-card.tsx`
- `frontend/src/components/charts/power-flow-chart.tsx`

### Server Maintenance Automation
Automated cleanup to prevent disk/memory issues:

**Changes Made**:
| Change | Before | After |
|--------|--------|-------|
| Disk cleanup | Manual | Daily 3am (`maintenance.sh`) |
| SSH sync | Every 1 min | Every 5 min |
| Docker logs | Unbounded | 10MB max, 3 files |
| Backend workers | 4 | 2 (saves ~200MB RAM) |
| Resource limits | None | backend 512M, frontend 384M, nginx 64M |

**Maintenance Script** (`deploy/maintenance.sh`):
- Docker prune (images >24h, unused volumes/networks)
- Journal vacuum (7 days retention)
- APT cleanup
- Disk/memory health report

**Cron Schedule**:
```
*/5 * * * * sync-ssh-keys.sh   # SSH key sync
0 3 * * * maintenance.sh       # Daily cleanup
```

### Controller Performance Improvements
- **Config Watch Interval**: Increased from 5s to 15s in device/control/logging services (3x fewer file reads)
- **Removed DEBUG prints**: Removed 15 verbose DEBUG print statements from `common/state.py`
- **SharedState optimization**: Cleaner write() method without debug logging overhead
- **SD Card Wear Reduction**: ~23% fewer writes when running on SD card

### Historical Data V2 - Local Data Source (NEW)
Query historical data directly from controller's SQLite database:

**Data Sources**:
- **Cloud**: Supabase PostgreSQL (default) - multi-site, long-term storage
- **Local**: Controller SQLite via SSH - single-site, real-time, super admin only

**Data Source Constraints**:
| Source | Raw Max | Aggregated Max | Sites | Notes |
|--------|---------|----------------|-------|-------|
| Cloud | 30 days | 2 years (daily) | Multi-site | RPC LIMIT 50k rows |
| Local | 1 hour | 30 days | Single site only | SSH timeout, active only |

**Auto-Behavior When Switching to Local**:
- Resets to 1h date range
- Sets Raw aggregation (optimal for 1h)
- Clears parameters from other sites
- Forces "Active" filter

**Key Files**:
- `controller/historical_cli.py` - CLI for querying local SQLite (supports --aggregation raw/hourly/daily)
- `backend/app/routers/controllers.py` - SSH endpoint for historical queries
- `frontend/src/app/api/historical/local/route.ts` - Frontend API proxy
- `frontend/src/components/historical/v2/ControlsRow.tsx` - Cloud/Local toggle

### Historical Data V2 - Server-Side Aggregation
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
| Aggregation | Cloud Max | Local Max | Points/Device |
|-------------|-----------|-----------|---------------|
| Raw | 30 days | 1 hour | ~50,000 (LIMIT) |
| Hourly | 90 days | 30 days | ~2,160 |
| Daily | 2 years | 30 days | ~730 |

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

### Historical Chart Improvements
- **Adaptive Y-Axis**: Domain calculated from actual data values with 10% padding (no longer starts at 0)
- **Date Presets**: 1h, 24h, 3d, 7d buttons (1h optimal for local raw data)
- **Raw Disabled Logic**: Raw aggregation disabled for local source when date range > 1 hour
- **No Browser Caching**: Refresh/Plot buttons always fetch fresh data (`cache: 'no-store'` + `Cache-Control` headers)
- **Device Register Caching**: In-memory cache for fast device switching (no re-fetch when switching back)
- **Loading Spinner**: Shows "Loading registers..." while fetching device parameters

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
- **Action**: Runs `git fetch + reset --hard` and restarts services on controller
- **Use Case**: OTA updates without SSH tunnel access
- **Note**: Uses `reset --hard` to handle local changes gracefully (config.yaml excluded)

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

### Device Template Linkage (NEW - 2026-01-18)
Template registers are now **live references**, not copies. Changes to templates show immediately in linked devices.

**Architecture**:
```
┌─────────────────────────────────────────────────────────────┐
│  TEMPLATE (device_templates table)                          │
│  - logging_registers, visualization_registers, alarm_registers │
└──────────────────────┬──────────────────────────────────────┘
                       │ LIVE REFERENCE (fetched on edit)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  DEVICE (site_devices table)                                │
│  - template_id → links to template                          │
│  - registers: [template source:"template"] + [manual source:"manual"] │
└──────────────────────┬──────────────────────────────────────┘
                       │ SYNC (pushes merged config)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  CONTROLLER (local config.yaml)                             │
│  - Receives merged template + manual registers              │
│  - source field preserved for debugging                     │
└─────────────────────────────────────────────────────────────┘
```

**Key Behaviors**:
| Action | Result |
|--------|--------|
| Edit template | Device edit dialog shows updated registers immediately (live fetch) |
| Save template | Confirmation dialog if template has connected devices |
| Add manual register to device | Saved with `source: "manual"`, editable |
| Template registers in device | Read-only, `source: "template"` badge |
| Sync to controller | Sends merged list (template + manual registers) |

**Source Field Values**:
- `"template"` - Register comes from template, read-only in device
- `"manual"` - Register added directly to device, editable

**Files Changed**:
- `frontend/src/components/devices/device-list.tsx` - Fetches template registers live on edit
- `frontend/src/components/devices/template-form-dialog.tsx` - Confirmation dialog + warning banner
- `backend/app/routers/controllers.py` - Config includes all device types + device registers
- `backend/app/routers/sites.py` - Config endpoint updated for all device types

### Controller Config - All Device Types (NEW - 2026-01-18)
Controller config now includes **all device types**, not just load_meters/inverters/generators.

**Device Categories in Config**:
```json
{
  "devices": {
    "load_meters": [],      // meter, load_meter, load, subload, energy_meter
    "inverters": [],        // inverter, solar_meter
    "generators": [],       // dg, diesel_generator, gas_generator
    "sensors": [],          // sensor, temperature_humidity_sensor, solar_sensor, etc.
    "other": []             // wind_turbine, bess, capacitor_bank, etc.
  }
}
```

**Register Types in Config**:
- `registers` - Logging registers (for control logic + data logging)
- `visualization_registers` - Live display registers
- `alarm_registers` - Threshold-based alarm registers

**Important**: Config uses **device registers** (merged template + manual), not raw template registers.

## Never Do

- NEVER over-engineer
- NEVER hardcode values
- NEVER use fallback systems
- NEVER use caching
- NEVER deploy without running `npm run build` first
