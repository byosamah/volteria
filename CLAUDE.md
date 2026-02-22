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

**Migration fallback** (when CLI fails with `!!` password encoding):
```bash
# Execute SQL directly via exec_sql RPC
curl -s -X POST "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/rpc/exec_sql" \
  -H "apikey: SERVICE_KEY" -H "Authorization: Bearer SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "<sql>"}'
```

### Key Tables
| Table | Purpose |
|-------|---------|
| `users` | Accounts (RLS disabled) |
| `projects`, `sites` | Project/site hierarchy (timezone on `projects`) |
| `site_devices` | Device configs per site |
| `device_templates` | Reusable device definitions |
| `site_master_devices` | Per-site controller devices (calculated field overrides in JSONB) |
| `controller_templates` | Template-level calculated field selections |
| `calculated_field_definitions` | Global calculated field definitions (sum, delta, difference) |
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
| Calculations | `/check-calculations` | Calculated fields pipeline, register_role, Total Load/DG/Solar, data flow |
| Alarms | `/check-alarms` | All 9 alarm types, auto-resolve, dedup, cron jobs, threshold config, sync |

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
7. **Controller deploy order**: `POST /api/controllers/{id}/update` pulls from git — commit and push BEFORE deploying. Auth: `{"controller_secret": "<ssh_password>"}` or admin JWT. Deploy to ALL active controllers after controller-side code fixes.
8. **Setup script auto-updates**: Controller setup clones from main — code fixes are automatically available to new controllers after push
8a. **Setup script must stop services before daemon-reload**: On re-flashed controllers, services are already `enabled` in systemd. `daemon-reload` auto-starts them with empty env before registration populates `/etc/volteria/env`. Fix: `systemctl stop volteria-* 2>/dev/null || true` before `daemon-reload` in `install_systemd_services()`
9. **Config readers use SharedState**: All code reading device settings (services, CLI scripts) must use `get_config()` from `common.state` — never hardcode paths
10. **Debug HTTP errors by tracing full path**: Browser → Nginx → Frontend API → Backend → Database. Don't assume error source — check each hop.
11. **Device types must be synced**: When adding new device types to frontend/database, also add to `controller/common/config.py` DeviceType enum — controller skips devices with unrecognized types
12. **ME437 register addresses are 0-based**: Datasheet values = direct Modbus addresses, no offset needed. Energy registers are UInt32 in kWh (V3.0 manual changed from float32/Wh)
13. **RTU Direct serial requirements**: `pyserial` must be installed in controller venv. pymodbus 3.11+ uses `device_id=` not `slave=`
14. **Pi 5 USB host crash recovery**: FTDI RS485 adapters can crash xhci-hcd.1; reset with `echo xhci-hcd.1 > /sys/bus/platform/drivers/xhci-hcd/unbind && sleep 2 && echo xhci-hcd.1 > /sys/bus/platform/drivers/xhci-hcd/bind`. Serial connection pool now auto-reconnects on stale FTDI locks (3-layer: close old client before new, pool eviction, reader trigger) — manual restart no longer needed.
15. **Config sync normalizes both field name conventions**: Template uses `data_type`/`register_type`/`scale_factor`, device config uses `datatype`/`type`/`scale` — `_normalize_register()` in `sync.py` accepts both. Frontend `template-form-dialog.tsx` also normalizes on load
16. **RTU Direct DeviceConfig requires explicit serial fields**: `service.py` must populate `serial_port`, `baudrate`, `parity`, `stopbits` from `modbus` config — these don't have defaults that work
17. **RTU Direct Live Registers read from SharedState**: Serial port is exclusively locked by device service — `register_cli.py` can't open its own connection. For `rtu_direct` protocol, reads latest values from SharedState instead of direct Modbus. TCP/RTU Gateway still uses direct connection.
18. **Device service polls ALL register types**: Visualization and alarm registers are polled at 5s interval (vs 1s for logging registers) so they appear in SharedState for Live Registers page. Registers with unsupported datatypes (e.g., `uint8_hi`) are skipped gracefully.
19. **Dashboard widgets use logging + visualization registers**: `getDeviceRegisters()` in `widget-config-dialog.tsx` merges both `logging_registers` and `visualization_registers` from device templates, deduplicated by name. Exception: **chart widgets** filter to logging-only registers for historical queries (viz registers aren't stored in `device_readings`).
20. **Template register JSONB may lack fields**: Registers stored in `device_templates` JSONB can have missing `datatype`, `type`, or `unit` fields. Frontend code accessing these must use fallback defaults (e.g., `reg.datatype || "uint16"`, `reg.type || "input"`).
21. **Config sync reads `logging_registers` from templates**: `device_templates` stores registers in `logging_registers` column, but `site_devices` uses `registers`. `sync.py` reads both columns and prefers `logging_registers` when `registers` is empty. `_fetch_template_registers()` also fetches both.
22. **Supabase RLS silent failure**: UPDATE/DELETE blocked by RLS returns `{data: null, error: null}` — no error thrown. Always verify RLS policies exist for write operations, not just SELECT.
23. **Template UI edits copy registers to site_devices**: Editing a template in the UI copies registers to `site_devices.registers` with `"source": "template"` tags. Fixing a template alone doesn't fix existing devices — must also update site_devices copies or trigger re-sync.
24. **ComAp InteliGen NT uses 1-based register numbering**: ComAp register 40013 = Modbus PDU address 12. pymodbus uses 0-based PDU addresses. Template addresses must be `register_number - 1`. Meatrol ME437 is 0-based (no offset needed).
25. **Register error isolation + alarm**: `_read_register_with_retry()` returns `(value, is_connection_error, error_msg)` 3-tuple. Register-specific errors fail only that register; connection errors cascade. After 20 consecutive failures, device service writes `register_errors.json` → logging service creates `REGISTER_READ_FAILED` alarm per device with register names + errors. Auto-resolves when cleared. **Suppressed when >5 registers failing**: `REGISTER_ALARM_MAX = 5` in `_health_cycle()` — >5 failures = device-level issue (offline), deferred to cloud "Not Reporting" cron. ≤5 = genuine register-specific problem. If alarm existed with ≤5 but count grows >5, auto-resolves existing alarm.
26. **Logging buffer thresholds are dynamic**: `ALERT_BUFFER_SIZE` and `MAX_BUFFER_SIZE` scale with `register_count × flush_interval`. With 462 registers at 60s flush, thresholds are 55K/83K (not the old hardcoded 5K/10K). Auto-resolves after 3 consecutive healthy checks.
27. **Disabled devices must be excluded from alarm cron jobs**: `get_non_reporting_devices()` and `check_device_connection_status()` filter by `sd.enabled = true`. Without this, disabled devices with stale readings trigger recurring "Not Reporting" alarms that re-create after every manual resolve.
28. **DG total power > load meter total is expected**: ~10-15% gap from DG auxiliaries, transformer/distribution losses, and house loads between generation and metering point. No solar = DGs are the only source, so the gap is purely losses.
29. **SQLite parameter limit**: `WHERE id IN (...)` queries must chunk at 999 parameters max. `local_db.py` uses `SQLITE_MAX_PARAMS = 999` constant for chunked marking.
30. **Cloud sync batch size is dynamic**: `max(5000, register_count * 200)` scales with register count. For 462 registers = 92,400 per batch. Ensures sync throughput exceeds production rate even with many devices.
31. **UTF8 Modbus strings skip scaling**: `modbus_client.py` guards with `isinstance(value, str)` at 4 locations (TCP+Serial, holding+input). Backend `RegisterReading` Pydantic model uses `float | str` for raw/scaled values.
32. **Enumeration display is register-type agnostic**: `RegisterRow` uses `register.values` for enum lookup identically across logging, visualization, and alarm registers. No special handling per type.
33. **Never add special colors to data values**: All register values in Live Registers tables must use the same default formatting. Don't add color-coded styling to specific value types (enums, scaled, etc.) unless user explicitly requests it.
34. **SQLite retention with boot catch-up**: `_retention_loop()` checks `.last_cleanup` marker on first iteration — if >24h old or missing, runs cleanup immediately regardless of hour (handles sites that lose power overnight). Normal schedule: 1-5 AM local time, hourly checks. Uses `.vacuum_done` marker file for first-run full VACUUM. `incremental_vacuum(50000)` runs after each cleanup but **fails silently with active WAL writers** (~1 page/call). For large space reclamation: stop logging service, run full VACUUM as `volteria` user, `sudo fuser -k 8085/tcp`, restart service. Full VACUUM temporarily doubles disk usage (~59% spike on 15 GB DB). New DBs get INCREMENTAL auto_vacuum from creation.
34a. **Scheduler detects NTP clock jumps**: `ScheduledLoop` in `scheduler.py` treats drift >30s as clock jump (NTP sync after boot with stale RTC). Doesn't accumulate as real drift — prevents false LOGGING_HIGH_DRIFT alarms after every power outage. Pi RTC can drift hours during prolonged outage; NTP corrects on reconnect.
35. **Removing bad registers from templates**: Must PATCH both `device_templates` AND all linked `site_devices` (they have independent copies of `visualization_registers`). Then trigger config sync via `control_commands` INSERT (`command_type: "sync_config"`). Controller polls commands every 5s.
36. **Cable flow is 3-state with thresholds**: `CableConfig` has `flowUpperThreshold`/`flowLowerThreshold` (default 0) + per-state colors (`color`, `reverseColor`, `stoppedColor`). Value > upper = forward, value < lower = reverse, between = stopped (static dashes). No `animationSource` (null value) = always forward for backward compat.
37. **Alarm deduplication/resolution matches by device_id**: Alarms match by `device_id` (UUID, immutable), not `device_name`. Old alarms without `device_id` fall back to `device_name` matching. Migration 099. Device rename is safe across the full stack — all core data pipelines use UUID.
38. **SharedState lives in tmpfs**: Production path is `/run/volteria/state/` (RAM-backed). `/opt/volteria/data/state/` is stale fallback from before tmpfs was set up. Always read from `/run/volteria/state/config.json` for current config. Config version history at `/opt/volteria/data/config_history/v_*.json`.
39. **Site settings auto-sync to controller**: Saving site settings auto-calls `/api/sites/[siteId]/sync` — same endpoint as manual sync button. One code path for both manual and auto sync. Never create separate sync logic.
40. **Controller systemd units are per-service**: Use `volteria-config`, `volteria-logging`, `volteria-device`, `volteria-control`, `volteria-system`, `volteria-supervisor`. NOT `volteria` (doesn't exist). Backend `/api/controllers/{id}/logs` is broken — uses `-u volteria` (non-existent unit) and `service` filter param causes SSH error. Use direct SSH for controller logs.
41. **Interactive controls must look interactive**: Use dropdowns/selects instead of click-toggles for non-obvious state changes. Static displays and clickable controls must be visually distinct (learned: +/- toggle looked identical to locked first operand, users couldn't discover it).
42. **exec_sql RPC works for writes**: `exec_sql` returns `{"success": true}` without row data for UPDATE/DELETE. It works but verify via REST API after. Active controllers may write rows with old names during rename windows.
43. **Renaming register_name in device_readings**: Trigger config sync FIRST (so controller starts writing new names), then rename existing rows via REST API PATCH. Handle unique constraint `(device_id, register_name, timestamp)` conflicts by DELETE-ing old-name duplicates at overlapping timestamps.
44. **Calculated field rename is DB-only**: Names flow from `calculated_field_definitions` → registers API → Historical page. Rename requires updating: (1) `calculated_field_definitions.name`, (2) `device_readings.register_name`, (3) JSONB `name` in `controller_templates` + `site_master_devices`. No code changes needed.
45. **Site calculations compute in device_manager (zero-lag)**: `common/site_calculations.py` has pure functions shared by device + control services. Device manager computes inline in `update_shared_state()` using current readings — never read stale `control_state`. Control service no longer relays site calculations; `ControlState` has no `site_calculations` field.
46. **Controller git pull requires root**: `sudo -u volteria git pull` fails (safe.directory + FETCH_HEAD permissions). Use: `sudo bash -c "cd /opt/volteria && git config --global --add safe.directory /opt/volteria && git pull origin main"`
47. **Calculated field settings flow through 3 tables**: `calculated_field_definitions` (global definitions + defaults) → `controller_templates.calculated_fields` (template-level) → `site_master_devices.calculated_fields` (per-device overrides with `logging_frequency_seconds`, `storage_mode`, `enabled`). Config sync merges per-device overrides from `site_master_devices` with global defaults from `calculated_field_definitions`.
48. **Config reload must clear all re-populated collections**: In logging service `_load_config()`, both `_alarm_definitions` and `_calculated_fields_to_log` must be cleared before re-populating. Missing `.clear()` causes stale entries to accumulate across config reloads.
49. **Delta fields: RPC-computed, not controller-logged**: Delta field historical values (Hourly/Daily Energy Production) are computed on-the-fly by the cloud RPC `get_historical_readings` (migration 106) from raw kWh counter readings. **Not logged to SQLite/cloud** — logging service skips delta field names in `_sample_readings_to_buffer`. DeltaTracker still runs for **real-time dashboard only** (SharedState values). RPC logic: detect delta fields via `calculated_field_definitions WHERE calculation_type='delta'`, find source devices via `site_devices` registers JSONB `register_role`, compute `first_reading_of_next_bucket - first_reading_of_current_bucket` per device per timezone-aligned bucket (boundary-to-boundary, captures full period including last logging interval), SUM across devices. Extended range: fetches readings up to 1 day past `p_end` for boundary computation. `GREATEST(0, ...)` guards meter resets. Bucket size per field from `logging_frequency_seconds`: 3600→hourly, 86400→daily. Only aggregates UP (hourly→daily), never down. **Persistence**: DeltaTracker state saved to tmpfs every 60s + disk on shutdown (7-day staleness limit, supports non-24/7 sites). **Offline devices**: only includes devices active in current window.
50. **Projects must have timezone set**: `projects.timezone` (IANA format, e.g., `Asia/Dubai`) controls DeltaTracker hourly/daily window boundaries. Null timezone falls back to UTC — hourly windows misalign with local time. Timezone is on `projects` table (not `sites`). Config sync hash doesn't include timezone — must restart config service after changing it.
51. **In-memory alarm tracking sets must be seeded from SQLite on startup**: `_devices_with_register_alarms` loses state on restart. `get_unresolved_device_ids_for_alarm_type()` seeds from local DB on first health check so pre-restart alarms auto-resolve when device recovers.
52. **NaN/Inf guard on float32/float64 Modbus decode**: `modbus_client.py` checks `math.isnan(value) or math.isinf(value)` after `struct.unpack` for float32/float64 in both TCP and serial paths (4 locations). Returns `None` instead of NaN — prevents corrupt values from propagating through site calculations. `site_calculations.py` `_get_register_value()` also guards.
53. **Controllers may not run 24/7**: Sites can shut down overnight as normal operations. All persistence, delta tracking, and alarm logic must handle multi-hour gaps gracefully. Delta fields must produce values for partial windows — two readings in a window = valid delta. Never assume continuous operation.
54. **Controller-managed alarm types skip cloud resolution sync**: `REGISTER_READ_FAILED`, `LOGGING_HIGH_DRIFT`, `LOGGING_BUFFER_BUILDUP`, `LOGGING_CONSECUTIVE_ERRORS` are auto-resolved by the controller when conditions clear. `sync_resolved_alarms()` in `cloud_sync.py` skips these types — syncing cloud resolutions for them causes infinite duplicate alarm creation. When adding new controller-managed alarm types, add them to `_CONTROLLER_MANAGED_TYPES` in `sync_resolved_alarms()`.
55. **SQLite datetime format mismatch**: SQLite `datetime('now')` produces `'YYYY-MM-DD HH:MM:SS'` (space), Python `.isoformat()` produces `'YYYY-MM-DDTHH:MM:SS+00:00'` (T). Lexicographic comparison of mixed formats is always wrong (space < T). Use `REPLACE(col, ' ', 'T')` to normalize before comparing.
56. **USB 4G dongle setup (SIM7600G-H)**: Kernel auto-loads `qmi_wwan` + `option` drivers, creates `wwan0` + `ttyUSB0-4`. ModemManager detects as `SIMCOM_SIM7600G-H`. Setup: `nmcli con add type gsm ifname cdc-wdm0 con-name volteria-4g apn <apn> connection.autoconnect yes`. **4G is primary** (ipv4.route-metric 100), WiFi is fallback (metric 600). Sites may not have WiFi. Etisalat APN: `etisalat.ae`, du APN: `du`.
56a. **Network switch causes tunnel stale port**: When controller switches between WiFi↔4G, DO server holds old tunnel port in CLOSE_WAIT. Tunnel watchdog auto-recovers in 1-2 min. For faster manual recovery: `fuser -k PORT/tcp` on DO server.
57. **Device status follows controller status (frontend-only override)**: Frontend overrides device display to offline when controller is offline. DB `is_online` reflects device Modbus communication only — never set `is_online = false` based on controller connectivity (recovery via cron + cloud sync takes 5-8 min, leaving devices stuck offline). Cloud sync drains SQLite buffer 10-15 min after heartbeat stops.
58. **`sites.controller_last_seen` is stale — use `controller_heartbeats`**: For live controller online status, query `controller_heartbeats` table directly (latest timestamp within 90s = online). `sites.controller_last_seen` is not reliably updated. Reference implementation: `/api/sites/[siteId]/controller-health` route.
59. **Test both transitions of state-dependent overrides**: When adding display overrides (e.g., controller offline → devices offline), always test the reverse transition (controller comes back → devices online). A one-way override that corrupts recovery is worse than no override.
60. **Calculated field UI exists in TWO forms**: `master-device-template-form.tsx` (template level) and `master-device-list.tsx` (per-site level). When changing calculated field behavior (locking, defaults, options), update BOTH forms.
61. **Template name display must use `device_templates.name`**: Not `brand + model` concatenation. The `name` field includes variant suffixes (e.g., "(Simplified)") that brand+model misses. All pages displaying template names must use `.name` consistently.
62. **Never log stale readings (source-validated)**: Device service guarantees only fresh readings exist in SharedState: (a) `clear_all_readings()` on connection cascade wipes all cached values. (b) `update_reading(success=False)` deletes individual stale readings. (c) Logging service skips offline devices (`is_online` check). Site calculations also exclude offline devices. No downstream timestamp staleness guards — validate at the source, not downstream with magic numbers.
63. **Delta field data is ephemeral**: No delta readings stored in `device_readings` — RPC computes on-the-fly from raw kWh counters. If delta values look wrong, verify: (1) raw kWh counter data exists for source devices (`register_role` matching), (2) `calculated_field_definitions` has correct `calculation_type='delta'` and `register_role` in `calculation_config`, (3) `logging_frequency_seconds` is correct (3600=hourly, 86400=daily). No manual data repair needed — fix the source data or definitions and RPC output corrects automatically.

## Key Architecture Decisions

### Logging System
- **RAM Buffer** → **SQLite** (every 60s) → **Cloud** (every 180s)
- Per-register `logging_frequency` controls cloud data density
- Clock-aligned timestamps for easy cross-device correlation
- **Config-filtered sampling**: Logging service only logs registers present in current config (source of truth)
- **Register rename**: Old name stops logging immediately after config sync; old data preserved as "Non-Active" in Historical Data
- **SQLite in thread pool**: All `local_db` calls run via `run_in_executor` — never block asyncio event loop
- **Smart backfill**: After offline recovery, syncs newest first (dashboard current), then fills gaps chronologically
- **Dynamic scaling**: Buffer threshold (`register_count × flush_interval × 3`) and sync batch size (`max(5000, register_count × 200)`) auto-scale with device count — no manual tuning needed
- **Local retention**: 7 days default (`local_retention_days`). Boot catch-up: `.last_cleanup` marker checked on start — runs immediately if >24h stale (handles sites losing power overnight). Normal: 1-5 AM local time, hourly. `incremental_vacuum(50000)` after each cleanup but fails with active WAL writers — manual full VACUUM needed for large reclamation. ~380 MB/day at 462 registers × 1s = ~2.6 GB steady state (safe for 32GB SD card)

### Historical Data
- Server-side aggregation via `get_historical_readings()` RPC
- Raw (30d max), Hourly (90d), Daily (2y)
- Local source available via SSH for super admins
- **Calculated fields** use forward-fill (last known value) for registers with different logging frequencies in raw mode. Aggregated mode aligns timestamps naturally.
- **Cross-field references**: Calculated fields can reference other calculated fields (field-to-field math). Computation uses topological sort for dependency ordering. Circular refs prevented in AdvancedOptions dropdown.
- **Site-level calculations (register_role)**: Controller computes totals (Total Load Active Power, Total Generator Active Power, Total Solar Active Power) from `register_role` tags on device registers. Pipeline: `calculated_field_definitions` → `controller_templates`/`site_master_devices` JSONB → config sync → `device_manager.update_shared_state()` computes inline from current readings (zero-lag) → logged to `device_readings` under master device ID. Pure functions in `common/site_calculations.py` (shared by device + control services). Historical page reads via `handleMasterDevice()` in registers API.
- **Delta fields computed in RPC, not controller**: Hourly/Daily Energy Production fields are NOT logged to SQLite/cloud. The cloud RPC `get_historical_readings` (migration 106) computes them on-the-fly from raw kWh counter readings using `register_role` + timezone-aligned bucketing. Bucket size determined per field by `calculated_field_definitions.logging_frequency_seconds`.

### Device Config
- Devices dict structure: `{load_meters: [], inverters: [], generators: [], sensors: [], other: []}`
- Config uses merged template + manual registers

### Device Polling
- Exponential backoff on offline devices: 5s → 10s → 20s → 40s → 60s max
- Resets immediately on first successful read
- **Register error isolation**: Register-specific errors (ExceptionResponse, address validation) fail only that register — other registers on the same device continue. Connection errors (timeout, unreachable) cascade to skip remaining registers with single summary log.
- **Register failure alarm**: 20+ consecutive failures → `register_errors.json` in SharedState → `REGISTER_READ_FAILED` alarm (per device, auto-resolves)
- Other devices on the same site continue polling normally — one offline device doesn't block others
- **Three register types polled**: `registers` (1s), `visualization_registers` (5s), `alarm_registers` (5s) — all appear in SharedState
- Deduplicates by address across register types to avoid double-reads
- **Serial auto-reconnect**: Stale FTDI locks self-heal via 3-layer mechanism: (1) `ModbusSerialClient.connect()` closes old client before creating new, (2) `ConnectionPool.reconnect_serial()` evicts cached connection, (3) `RegisterReader` triggers pool reconnect on serial connection failure

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
/c/Windows/System32/OpenSSH/ssh.exe -i "C:/Users/Hp/.ssh/volteria-deploy" root@159.223.224.203 "sshpass -p '<ssh_password>' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p <ssh_port> <ssh_username>@localhost '<command>'"
```

- **Windows SSH**: Must use `/c/Windows/System32/OpenSSH/ssh.exe` with `-i C:/Users/Hp/.ssh/volteria-deploy` key. Default `ssh` in Git Bash silently fails (no output, no error).
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
- NEVER bypass RLS with backend service_role for operations that should work through proper RLS policies — add the correct policy instead

## Documentation Convention

- **CLAUDE.md** = Reference only (architecture, rules, commands, decisions)
- **CHANGELOG.md** = Timestamped history (bug fixes, feature launches)
- **Skills** = Diagnostic knowledge (self-contained, don't duplicate in CLAUDE.md)
- After every fix: promote the **rule** to CLAUDE.md, not the story
