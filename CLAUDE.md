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
- Pi WiFi connection name varies by OS image — never hardcode, detect with `nmcli`

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

## Recent Updates (2026-02-01)

### Controller Offline Alarm + Connection Chart Fix (Database + Frontend)
Two issues discovered during offline durability testing:

**Issue 1: Controller Offline Alarm Never Triggered**
- **Root cause**: `controller_offline` alarm type existed in schema but no cron job to detect timeout
- **Fix**: Migration 095 adds pg_cron job `check-controller-alarms` (every 5 min)
- **New functions**: `get_offline_controllers()`, `create_controller_offline_alarm()`, `resolve_controller_offline_alarm()`, `check_controller_connection_status()`
- **New columns**: `site_master_devices.controller_alarm_enabled`, `site_master_devices.controller_alarm_severity`
- **Frontend**: UI toggle now saves to DB (previously only read from template)
- **Timeout**: 120s (2 minutes = 4 missed heartbeats)

**Issue 2: Cloud Connection Chart Didn't Show Offline Gap**
- **Root cause**: Single `Area` component with green gradient spanned continuously across offline points
- **Fix**: Split into two Area components (online=green, offline=red) with `connectNulls={false}`
- **File**: `frontend/src/components/charts/power-flow-chart.tsx`

**Files changed**:
- `database/migrations/095_controller_offline_alarm.sql` (new)
- `frontend/src/components/charts/power-flow-chart.tsx`
- `frontend/src/components/devices/master-device-list.tsx`
- `database/CLAUDE.md`

### DNS Watchdog Fix (Controller)
- **Issue**: `dns-watchdog.sh` used `host google.com` but `host` command not installed on Pi (requires `dnsutils` package)
- **Effect**: Script triggered every minute thinking DNS was broken → restarted NetworkManager → caused 600+ DNS failures/hour
- **Fix**: Changed to `getent hosts google.com` (always available, part of glibc)
- **Also fixed**: `setup-controller.sh` 1am daily DNS check timer (same `host` → `getent` change)
- **Manual fix for existing controllers**: Set persistent DNS via `nmcli con mod "WIFI_NAME" ipv4.dns "8.8.8.8 8.8.4.4"` + update script
- **Files**: `controller/scripts/dns-watchdog.sh`, `controller/scripts/setup-controller.sh`

## Recent Updates (2026-01-31)

### Dashboard Cable Widget Improvements (Frontend)
Complete fix for cable widget interactions and usability:

**Core Fixes:**
- **Widget dragging blocked**: SVG overlay had `pointerEvents: 'auto'` blocking all widget interactions. Fixed by setting SVG to `'none'` and cable elements to `'auto'`
- **Click-away deselection**: Clicking anywhere on canvas now deselects cables (expanded grid cell click handler)
- **Position stability**: Cable positions no longer shift when widget picker panel toggles. Uses SVG `viewBox` with fixed coordinate system (100 units per grid cell) instead of pixel-based positioning

**Thickness Options:**
- **3 sizes**: Thin (2px), Medium (5px), Thick (10px) - accessible via cable toolbar
- **Visual buttons**: Each button shows line of proportional height
- **Config merging**: Fixed thickness change by spreading existing config: `{ ...config, thickness: size }`
- **Stale state fix**: Reads config from `widgets.find()` instead of stale `selectedWidget`

**Animation Scaling:**
- **Proportional dash pattern**: `strokeDasharray: ${thickness * 4} ${thickness * 2}` scales with cable size
- **Per-thickness keyframes**: Generated CSS keyframes for each thickness level (2, 3, 4, 5, 6, 8, 10)
- **Visible flow**: Animation now clearly visible on thick cables

**Files**: `dashboard-canvas.tsx`, `cable-widget.tsx`

### Controller Stability Improvements
- **SQLite timeout**: 10s connection timeout prevents infinite waits on lock contention
- **Incremental vacuum**: Replaces blocking VACUUM (<1s vs 30-60s on large DBs)
- **Batch chunking**: Inserts chunked to 1000 records max (shorter lock duration)
- **Off-peak cleanup**: Retention cleanup scheduled for 2-4 AM local time
- **DNS watchdog**: Reduced from 5-min to 1-min interval for faster recovery
- **Cloud offline alert**: CLOUD_SYNC_OFFLINE alarm when unreachable >1 hour, auto-resolves on reconnect
- **Files**: `local_db.py`, `service.py`, `cloud_sync.py`, `setup-controller.sh`

### Dashboard Gauge Widget (Frontend)
- **New widget type**: Gauge widget with 4 visual styles (dial, bar, thermometer, tank)
- **Configurable**: Min/max values, threshold zones, colors, units
- **Real-time**: Displays live register values with smooth animations
- **Files**: `gauge-widget.tsx`, `gauge-styles/*.tsx`, `widget-config-dialog.tsx`

### Belt Scale Device Type
- **New device type**: `belt_scale` for conveyor weighing systems
- **Migration 094**: Added to `device_type` enum
- **Frontend**: Added to device constants and template grouping

### Security Fix (Database)
- **Migration 093**: All DB functions now use `SET search_path = ''` to prevent search path injection
- **Scope**: 50+ functions updated

## Recent Updates (2026-01-30)

### Alarm System Overhaul (Controller)
Complete fix for device threshold alarm lifecycle:

**Core Fixes:**
- **`active_conditions` vs `triggered`**: Evaluator now returns both - `triggered` is for creating alarms (cooldown applied), `active_conditions` is for auto-resolve logic (condition currently met regardless of cooldown)
- **`check_only` mode**: Added parameter to `evaluate()` for config re-evaluation without side effects (no cooldown updates)
- **Cloud sync for all resolutions**: All auto-resolutions now call `resolve_alarm_in_cloud()` (PATCH request)
- **Address-based register matching**: Alarm definitions now match `alarm_registers` to `registers` by address to find actual register name

**Auto-Resolution Triggers (all sync to cloud):**
| Trigger | Method |
|---------|--------|
| Condition clears | `_evaluate_alarms()` compares `active_conditions` to `_previously_triggered_ids` |
| Threshold changed | `_reevaluate_alarms_after_config_change(check_only=True)` |
| Definition deleted | Orphan resolution in `_config_watch_loop()` |
| Drift recovers | `_check_logging_health()` after 3 healthy checks |

**Key Code Locations:**
- `alarm_evaluator.py`: `evaluate(check_only=False)` returns `(triggered, active_conditions)`
- `cloud_sync.py`: `resolve_alarm_in_cloud()` - PATCH to update existing alarm
- `service.py`: `_reevaluate_alarms_after_config_change()` uses `check_only=True`

**Bug Fixes:**
- Duplicate alarms during cooldown: Fixed by separating `active_conditions` from `triggered`
- Orphan alarms not syncing to cloud: Added `resolve_alarm_in_cloud()` call
- Config re-eval preventing new alarms: Added `check_only` parameter
- Register name mismatch: Now matches by address to find actual register name from `registers` array

**Alarm Speed**: ~5 seconds from config sync to alarm appearing in cloud (critical severity = immediate sync)

**Diagnostic Skill**: `/check-alarm` updated with full alarm lifecycle documentation

## Recent Updates (2026-01-29)

### Dashboard Text Widget (Frontend)
- **New widget type**: Text widget for custom labels, titles, and annotations
- **Configurable options**: Text content (multiline), size (xs to 3xl), color (hex picker), alignment (left/center/right)
- **Files**: `text-widget.tsx`, `widget-picker.tsx`, `widget-config-dialog.tsx`, `dashboard-canvas.tsx`
- **Default size**: 3 columns × 1 row

### Dashboard Alarm List Widget Fix (Frontend)
- **Issue**: Widget showed infinite loading spinner with repeated 400 Bad Request errors
- **Root cause 1**: Query used `project_id` but alarms table uses `site_id`
- **Root cause 2**: `severities` array recreated every render, causing useCallback dependency change → infinite re-fetch loop
- **Fix**: Changed `.eq("project_id", ...)` to `.eq("site_id", siteId)`, memoized severities array with `useMemo` using JSON.stringify pattern
- **File**: `alarm-list-widget.tsx`

### Dashboard Chart Widget Fixes (Frontend)
- **ResponsiveContainer warning fix**: Changed from `height="100%"` to calculated pixel height based on widget's `grid_height` - fixes "width(-1) and height(-1)" console warning caused by flex layout timing
- **Smart downsampling for sparse data**: New algorithm preserves timestamps where sparse parameters have data - fixes missing lines when registers have different logging frequencies
- **Height calculation**: `chartHeight = (grid_height * 100) + ((grid_height - 1) * 8) - titleHeight - padding`
- **Increased line visibility**: strokeWidth increased to 3, right margin to 50px for better Y-axis labels
- **File**: `chart-widget.tsx`

### Dashboard Preset Images Expansion (Frontend)
- **6 new preset images**: Crusher, EV Charger, Power Meter, Solar Panels (Small), Solar Panels (Large), Solar House
- **Per-image sizing control**: Added `useContainSize` flag to `PresetImage` interface - new presets use `contain` sizing like custom uploads
- **Adaptive padding**: Images with `useContainSize: true` get optimized padding (top: 4px, bottom: 36px with content) to avoid text overlap
- **Old presets unchanged**: Original presets (generator, solar panel, circles) keep `96% auto` sizing
- **Files**: `dashboard-preset-images.ts`, `icon-widget.tsx`, `/public/images/dashboard/*.png`

### Dashboard Chart Widget Redesign (Frontend)
- **Dual Y-axis support**: Left and right Y-axis with independent unit grouping
- **Per-parameter chart types**: Each parameter can be line, area, or bar independently
- **Device/register selection**: Improved parameter picker with device grouping

## Recent Updates (2026-01-28)

### Dashboard Icon Widget Improvements (Frontend)
- **Custom image upload**: Created Supabase storage bucket `dashboard-images` with upload/read/delete policies
- **Image sizing**: Custom images use `contain` (prevents overflow), preset images use `96% auto` (original sizing)
- **Adaptive text positioning**: Label+value positioned lower (4px), label-only centered higher (12px)
- **Text size increase**: Label `text-sm`→`text-base`, value `text-base`→`text-lg`, unit `text-xs`→`text-sm`
- **Dialog accessibility**: Added `DialogDescription` to widget config dialog (fixes console warning)
- **Conditional switching fix**: Default operator set to `>` when enabling conditional mode
- **Preset images library**: Added SVG status indicators (generator running/off, solar active/inactive, colored circles)
- **Files**: `icon-widget.tsx`, `widget-config-dialog.tsx`, `dashboard-preset-images.ts`, `upload-image/route.ts`

### Site Creation Fix (Frontend + Backend + Nginx)
- **Issue**: Creating a new site failed with 403 Forbidden, then ERR_TOO_MANY_REDIRECTS
- **Root cause 1**: RLS on `sites` table only allows SELECT for authenticated users — no INSERT policy
- **Root cause 2**: Nginx `location /api/sites/` required trailing slash, but browser sends `/api/sites`
- **Fix**:
  1. Created frontend API route `/api/sites/route.ts` that calls backend (bypasses RLS with service_role)
  2. Updated backend `SiteCreate` model to include `control_method`, `grid_connection`, `logging_cloud_enabled`, etc.
  3. Changed nginx from `location /api/sites/` to `location ~ ^/api/sites(/.*)?$` (regex handles both)
  4. Added `/api/sites` to middleware public paths (API route handles own auth)
- **Pattern**: Same as site deletion — route through backend for write operations

### Supervisor Restart Loop Fix (Controller)
- **Issue**: Controller CPU at 90%+, all services in restart loop
- **Root cause**: `volteria-supervisor.service` missing `/run/volteria` in `ReadWritePaths`
- **Error**: `OSError: [Errno 30] Read-only file system: '/run/volteria/state/service_health.tmp'`
- **Why**: `ProtectSystem=strict` blocks writes to paths not in `ReadWritePaths`. Other services had `/run/volteria` but supervisor didn't.
- **Fix**: Added `/run/volteria` to `ReadWritePaths` + `VOLTERIA_STATE_DIR` env var in `controller/systemd/volteria-supervisor.service`
- **Deploy to existing controllers**: `sudo cp /opt/volteria/controller/systemd/volteria-supervisor.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl restart volteria-supervisor`
- **Future controllers**: Auto-fixed (setup script copies from repo)

## Recent Updates (2026-01-27)

### R2000 (SOL532-E16) Setup Testing Fixes
Bugs discovered and fixed during first real R2000 hardware setup:
- **modemmanager package name**: Changed `modem-manager` → `modemmanager` (no hyphen) in setup script
- **UPS monitor test**: Made optional (returns "skipped" instead of "failed") since GPIO16 not configured on stock Seeed image
- **4G modem install**: Made non-fatal with `|| log_warn` - 4G is optional feature
- **GitHub raw caching**: Raw content caches for ~5 minutes. Use cache-busting: `curl -sSL "URL?$(date +%s)" | sudo bash`
- **Service restart after registration**: If heartbeat fails with "Illegal header value b'Bearer '", restart volteria-system service
- **Wizard registration mismatch**: Known issue - wizard creates controller record with NULL serial, setup script creates separate record with detected serial. Manual DB merge required until fixed.
- **Docker code changes**: `docker-compose restart` doesn't pick up code changes. Must use `docker-compose up -d --build backend`

### Live Registers Config Fix (Controller)
- **Issue**: "Request Data" button showed "Device not reporting back" despite device being online
- **Root cause**: `register_cli.py` (executed via SSH) was reading stale disk config (`/opt/volteria/data/state/config.json`) instead of tmpfs (`/run/volteria/state/config.json`)
- **Why**: SSH runs outside systemd, so `VOLTERIA_STATE_DIR` env var not available. Script hardcoded disk path.
- **Fix**:
  - `common/state.py` now prefers tmpfs over disk when env var not set (checks if `/run/volteria/state` exists)
  - `register_cli.py` now uses `get_config()` from SharedState (same pattern as logging service)
- **Principle**: Config is single source of truth. All code reading device settings must use SharedState — user changes IP in UI → config syncs → all readers (services + SSH scripts) see new settings automatically.

## Recent Updates (2026-01-26)

### React Hydration Fix (Frontend)
- **Issue**: React error #418 (hydration mismatch) caused by `Date.now()` and `toLocaleString()` during SSR
- **Root cause**: Server renders at T0, client hydrates at T0+100ms, different timestamps cause DOM mismatch
- **Fix pattern**: Add `mounted` state with `useEffect(() => { setMounted(true); }, [])`, only compute time values after mount
- **Files fixed**:
  - `site-status-header.tsx` - FormattedTimeSince component
  - `controller-health-card.tsx` - FormattedTimeSince component
  - `alarms-viewer.tsx` - Use FormattedDate component
  - `sync-status.tsx` - Client-side hooks for date formatting
  - `master-device-list.tsx` - Mounted check for isControllerOnline/formatTimeSince
  - `controller-reboot-action.tsx` - Mounted check for isControllerOnline

### Alarm Condition Storage (Database + Controller)
- **Separate column**: Alarms now store condition in separate `condition` column (e.g., "Ambient Temperature < 50")
- **Message column**: Contains only user-defined message (e.g., "major issue")
- **Migration 092**: Added `condition` column to `alarms` table
- **Frontend display**: Dashboard shows "condition - message" format with device/site info below

### Orphan Alarm Auto-Resolution (Controller)
When alarm register is removed from config:
- On config change, old definition IDs compared to new definition IDs
- Missing definitions = orphaned alarm types
- `resolve_alarms_by_type()` called for each orphaned type
- Log indicator: `[CONFIG] Auto-resolved X orphan alarm(s): alarm_id`

### Dashboard Recent Alarms Fix (Frontend)
- **Severity colors**: All 5 levels now mapped (critical=red, major=orange, minor=amber, warning=yellow, info=blue)
- **Display format**: Line 1 = condition + message, Line 2 = device • project > site
- **Previously**: Major/minor showed as blue (wrong)

### Alarm Deduplication Fix (Controller)
- **Skip `reg_*` in resolution sync**: Device threshold alarms use cooldown deduplication, not resolution sync
- **Prevents**: Repeating alarms while condition still active

### Historical Chart Tooltip Fix (Frontend)
- **rightYAxisWidth prop**: ChartOverlay now accounts for right Y-axis width when calculating hover position
- **Calculation**: `dataRight = plotRight - rightYAxisWidth - xAxisPadding.right`
- **Previously**: Tooltip position was off when right Y-axis was present

## Recent Updates (2026-01-25)

### Device Threshold Alarms (Controller)
Device register threshold alarms now work end-to-end:
- **Config loading**: `alarm_registers[].thresholds` converted to `alarm_definitions` at startup
- **Evaluation**: Thresholds checked against device readings every 1s in `_sample_callback()`
- **AlarmDefinition**: Added `device_id`, `device_name`, and `operator` fields
- **Data flow**: Frontend config → Controller → SQLite → Cloud (Supabase alarms table)
- **Deduplication**: If unresolved alarm exists for same type+device, new alarms are skipped
- **Cooldown**: 300s default between re-triggers when no unresolved alarm exists
- **Alarm type format**: `reg_{device_id}_{register_name}`

### Connection Alarm Severity Unification
Unified device and controller connection alarm UI with severity levels:
- **Migration 089**: Added `connection_alarm_severity` column to `site_devices` table
- **Migration 090**: Added 'minor' severity level to alarms constraint (info < warning < minor < major < critical)
- **Migration 091**: Updated `create_not_reporting_alarm()` to use device-specific severity
- **Frontend**: Both device and controller alarms now have identical card-based UI with toggle + severity dropdown
- **Controller sync.py**: Connection alarm config now includes `severity` field alongside `enabled`
- **Color coding**: warning=yellow, minor=amber, major=orange, critical=red

### SOL532-E16 (R2000) Hardware Support
Full support for Seeed reComputer Industrial R2000:
- **Setup Script**: Auto-detects R2000 via `/dev/ttyACM1-3` presence, configures UPS monitor, watchdog, 4G modem
- **Wizard Step 2**: SSH credentials box (`recomputer` / `12345678`), hardware verification commands (RS485, UPS, 4G)
- **Wizard Step 3**: R2000 verification section with serial port and UPS checks
- **Wizard Step 6**: Hardware-specific tests (serial_ports, ups_monitor, watchdog)
- **New Services**: `volteria-ups-monitor` (GPIO16 power loss detection), `volteria-watchdog` (auto-reboot on hang)
- **Backend Tests**: `test_serial_ports()`, `test_ups_monitor()`, `test_watchdog()` in `ssh_tests.py`

### Hardware Features (SOL532-E16)
| Feature | Details |
|---------|---------|
| Boot | Pre-flashed eMMC (no SD card) |
| Serial | 3x RS-485 (`/dev/ttyACM1-3`) + 1x RS-232 (`/dev/ttyACM0`) |
| UPS | SuperCAP with GPIO16 monitoring |
| Watchdog | Hardware `/dev/watchdog` (1-255s timeout) |
| Cellular | 4G LTE modem (Quectel EC25, optional) |
| Default SSH | `recomputer` / `12345678` |

### Alarm Tab Indicator Fix (Frontend)
- **Problem**: Alarm tab dot indicator had hydration mismatch and incorrect trigger logic
- **Fix**: Simplified to dot-only indicator, show unacknowledged count regardless of resolved state

## Recent Updates (2026-01-24)

### Logging Drift Fix (Controller)
- **Root cause**: Blocking `sqlite3` calls on asyncio event loop caused 15-22s scheduler drift
- **Fix**: All `local_db.*` calls now use `_run_db()` (wraps in `run_in_executor` thread pool)
- **Threshold**: Raised `ALERT_DRIFT_MS` from 1000ms → 5000ms (realistic for Pi SD card I/O)
- **Auto-resolve**: LOGGING_HIGH_DRIFT alarms auto-resolve after 3 consecutive healthy checks
- **New method**: `local_db.resolve_alarms_by_type()` for bulk alarm resolution

### Alarms Page Fix (Frontend)
- **Problem**: Main `/alarms` page only showed Active/Acknowledged, missing Resolved state
- **Fix**: Added 3-state display (Active → Acknowledged → Resolved), resolve button, unresolved filter
- **Consistency**: Now matches site-level `AlarmsViewer` behavior

### Smart Backfill (Controller Logging)
- **Two-phase strategy**: After offline recovery, sync newest 5000 first (dashboard current), then fill gaps oldest-first
- **`source` field**: Device readings tagged `live` or `backfill` for tracking
- **Migration 086**: Added `source` column to `device_readings` table

### DNS Resilience (Controller Setup)
- Cron watchdog (every 5 min) checks DNS, restarts NetworkManager if broken
- Daily systemd timer safety net at 1am UTC
- Persistent DNS on WiFi via `nmcli` connection settings

### Controllers RLS (Database)
- **Migration 085**: INSERT/UPDATE policies for controllers table (controller auth via secret)
- **Migration 087**: DELETE policy for admin controller deletion

### Device Template Type Filter Fix (Frontend)
- **Problem**: Templates list filter dropdown had 8 hardcoded legacy types — modern types (diesel/gas generators, BESS, wind turbine, etc.) were invisible
- **Fix**: Extracted `DEVICE_TYPE_OPTIONS` to shared `frontend/src/lib/device-constants.ts` — filter dropdown, section groups, and template form all use same source of truth
- **Linked**: Adding a new type to `device-constants.ts` auto-updates both the form and the filter

## Recent Updates (2026-01-23)

### Register Rename Fix (Controller + Frontend)
- **Controller**: Logging service now filters SharedState readings against current config — only registers in active config get logged
- **Controller**: Device service clears stale reading buffers on config reload (no old names persist in SharedState)
- **Frontend**: Historical Data "Non-Active" registers now show correctly — uses `get_distinct_register_names` RPC instead of raw query (PostgREST 1000-row limit was hiding old names)
- **Migration 084**: `get_distinct_register_names()` RPC for efficient DISTINCT query on device_readings
- **Deploy controller**: Use `POST /api/controllers/{id}/update` with `controller_secret` — triggers git pull + service restart via SSH tunnel

### Historical Chart Fixes
- **Preset highlight bug**: Quick range buttons (1h, 24h, etc.) no longer highlight when a custom date/time range happens to match a preset duration. Uses `rangeMode` to distinguish preset (relative) from custom (absolute) selections.
- **Sparse data badge removed**: Removed misleading "Sparse data" badge from chart — was confusing since data density varies by device/register.

## Recent Updates (2026-01-22)

### Deletion Bug Fixes
- **Site deletion**: Frontend now uses API route (`/api/sites/[siteId]`) instead of direct Supabase UPDATE (RLS only allows SELECT for authenticated users)
- **Template deletion**: Fixed `checkTemplateUsage()` to use `template.id` (UUID) not `template_id` (slug), and filter for active sites + enabled devices only
- **Project deletion**: Simplified to only check active sites (sites already check for devices)

### Cascade Delete Fixes (DB Migrations)
- **`site_devices.site_id`**: Changed FK from NO ACTION to CASCADE - deleting a site now cascades to its devices
- **`site_devices.template_id`**: Changed FK from NO ACTION to SET NULL - deleting a template unlinks devices (they keep manual registers)

### Deletion Hierarchy
```
Project → checks active sites only
   ↓
Site → checks active devices (enabled = true)
   ↓
Template → checks active devices in active sites
```

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
