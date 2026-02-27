---
name: check-logging
description: Check Volteria controller logging diagnostics and health. Use when user says "check logging", "logging diagnostics", "check logging debug", or wants to verify data collection, check for gaps, or diagnose logging issues.
---

# Check Logging Diagnostics

Diagnose controller logging health and data collection for any Volteria controller.

## Key Principle

**Config is the source of truth for logging.** The logging service only logs registers that exist in the current config file. After a register rename/removal, old names stop logging immediately on next config sync. Existing data in SQLite still syncs to cloud (backfill unaffected).

## Step 0: Identify Controller

If no controller specified, query deployed controllers:

```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/controllers?select=id,serial_number,site_id,status&is_active=eq.true" \
  -H "apikey: SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

Use Supabase credentials from project CLAUDE.md (Database Access section).

- If one controller: use it automatically
- If multiple: ask user which one

Store result as `CONTROLLER_ID` and `SITE_ID`.

Get controller secret:
```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/controllers?select=ssh_password&id=eq.CONTROLLER_ID" \
  -H "apikey: SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

Store `ssh_password` as `SECRET`.

## Step 1: Fetch Debug Endpoint

```bash
curl -s -X POST "https://volteria.org/api/controllers/CONTROLLER_ID/logging-debug" \
  -H "Content-Type: application/json" \
  -d '{"controller_secret": "SECRET"}'
```

## Step 2: Analyze Diagnostics

| Field | Healthy | Warning | Action |
|-------|---------|---------|--------|
| `frequency_lookup_misses` | 0 | >0 (persistent) | Transient after rename = normal (old SQLite data syncing). Persistent = new register missing `logging_frequency` |
| `buffer_current` | <1000 | >5000 | Backlog building — check cloud sync (Step 3) |
| `buffer_peak_24h` | <1000 | >5000 | Had recent backlog — check cloud errors |
| `clock_buckets_created` | >0 | 0 | Downsampling not running — check device config |
| `clock_duplicates_skipped` | any | — | Normal (dedup behavior) |

## Step 3: Check Cloud Sync

In `cloud_sync` section of Step 1 response:

| Field | Healthy | Warning | Action |
|-------|---------|---------|--------|
| `error_count` | 0 | >0 | Check Supabase credentials/connectivity |
| `duplicate_count` | low | — | Normal (clock alignment dedup) |
| `empty_batch_count` | low | high | All readings filtered — check logging_frequency values |
| `unsynced_device_readings` | 0 | >100 | Sync backlog — check network or rate limits |

## Step 3b: Check Register Consistency

Compare `register_frequencies` (config truth) vs `downsample_results` (runtime):
- Names in `downsample_results` but NOT in `register_frequencies` = old/renamed registers
- If their `input_count` is frozen (not growing) = normal (pre-transition buffer draining)
- If their `input_count` is growing = BUG (config filter not working)

## Step 4: Check Logs (if issues found)

```bash
curl -s -X POST "https://volteria.org/api/controllers/CONTROLLER_ID/logs" \
  -H "Content-Type: application/json" \
  -d '{"controller_secret": "SECRET", "lines": 200, "grep": "ERROR|FREQ|CLOUD"}'
```

Log prefixes:
- `[HEALTH]` — 10-min summaries (expect 6/hour)
- `[CLOUD]` — sync results
- `[ERROR]` — failures to investigate
- `[FREQ]` — missing frequency config

## Step 5: Compare Local vs Cloud

From Step 1 response:
- `local_db.total_device_readings` = total in SQLite
- `local_db.unsynced_device_readings` = pending upload

Query cloud count for this site:
```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/device_readings?select=count&site_id=eq.SITE_ID" \
  -H "apikey: SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer SERVICE_ROLE_KEY" \
  -H "Prefer: count=exact"
```

If `unsynced > 0` and growing: sync is failing. If stable at 0: healthy.

## Output Format

Present as structured summary:

**Logging Health: [HEALTHY / ISSUES FOUND]**

| Metric | Value | Status |
|--------|-------|--------|
| Buffer | X readings | OK/Warning |
| Buffer peak (24h) | X | OK/Warning |
| Cloud errors | X | OK/Warning |
| Unsynced | X readings | OK/Warning |
| Freq misses | X | OK/Warning |
| Clock buckets | X | OK (>0) / Warning (0) |
| Unresolved alarms | X | OK (0) / Warning |

Also check cloud alarms table for unresolved LOGGING_HIGH_DRIFT or LOGGING_BUFFER_BUILDUP:
```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/alarms?select=alarm_type,created_at,resolved&site_id=eq.SITE_ID&resolved=eq.false&alarm_type=like.LOGGING_*&order=created_at.desc&limit=5" \
  -H "apikey: SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

**Cross-check local vs cloud**: If cloud shows unresolved LOGGING_* alarms but controller SQLite has them resolved (`resolved=1`), the cloud resolve call was missed. Fix: manually PATCH the alarm in Supabase and verify `resolve_alarm_in_cloud()` is called after every `resolve_alarms_by_type()`.

Also check for persistent register read failures (device service writes these):
```bash
cat /run/volteria/state/register_errors.json 2>/dev/null | python3 -m json.tool || echo "No register errors"
```
If this file exists with entries, specific registers are consistently failing (20+ consecutive). Logging service creates `REGISTER_READ_FAILED` alarm during health check (~10 min cycle). Auto-resolves when failures clear.

If issues found: list specific problems with remediations below the table.

## Remediation Guide

| Problem | Cause | Fix |
|---------|-------|-----|
| High buffer | Flush stalled or register count explosion | Buffer thresholds are dynamic: `register_count × flush_interval × 2` (alert) / `× 3` (max). If buffer alarm fires after adding devices, thresholds auto-recalculate on config reload. Auto-resolves after 3 healthy checks. If persistent, check SQLite disk space. |
| Cloud errors | Auth/network | Verify Supabase keys in controller config |
| Freq misses | Stale register names or new registers | Normal briefly after rename; persistent = add `logging_frequency` |
| Unsynced growing | Network/rate or batch too small | Check internet first. If network OK, check sync throughput: production rate (registers/s) must not exceed sync rate (batch_size / sync_interval). Batch size is dynamic: `max(5000, register_count * 200)`. For 462 registers = 92,400 per batch. |
| No clock buckets | No device reads | Verify device service is running |
| Empty batches | All filtered | Lower `logging_frequency` values |
| LOGGING_HIGH_DRIFT alarms | Blocking SQLite on event loop | Ensure all `local_db` calls use `_run_db()` wrapper (run_in_executor). Threshold is 5000ms. |
| Drift alarms accumulating | No auto-resolve | After 3 healthy checks, alarms auto-resolve. If not resolving, check `_consecutive_low_drift_checks` logic |
| Alarm resolved locally but stuck in cloud | Missing `resolve_alarm_in_cloud()` call | Every `resolve_alarms_by_type()` must be paired with `cloud_sync.resolve_alarm_in_cloud(alarm_type)`. Compare SQLite `resolved=1` vs Supabase `resolved=false` for same alarm. |
| Repeated "Resolved alarm in cloud" spam | Auto-resolve guard uses `>= N` instead of `== N` | Use `== N` for consecutive-check guards so resolve fires exactly once on transition, not every cycle forever |
| Retention cleanup never runs | Service restarts reset 1-5 AM timer | Window is 1-5 AM local time (was 2-4 AM). Manual cleanup: `sudo systemctl stop volteria-logging && sudo -u volteria python3 /tmp/cleanup.py && sudo systemctl start volteria-logging`. DB owned by `volteria` user. Delete in batches of 50K, then VACUUM. No HTTP endpoint for on-demand cleanup. |
| DB file huge despite retention working | `auto_vacuum=NONE` (SQLite default for pre-existing DBs) | `incremental_vacuum` is a no-op when `auto_vacuum=0`. Check: `sudo -u volteria python3 -c "import sqlite3; c=sqlite3.connect('/opt/volteria/data/controller.db'); print(c.execute('PRAGMA auto_vacuum').fetchone())"`. Fix: `cleanup_old_data()` auto-detects and runs one-time full VACUUM to convert to INCREMENTAL (runs at 1-5 AM off-peak). New controllers get INCREMENTAL from DB creation. |
| REGISTER_READ_FAILED alarm | Device service detects 20+ consecutive register failures | Alarm created per device during health check cycle (~10 min). Auto-resolves when failures clear. Check: `cat /run/volteria/state/register_errors.json`. Remove bad registers from template to fix permanently. |

### Known Behaviors

- **`resolve_alarm_in_cloud()` logs success even when no alarm exists** — PATCH on 0 matching rows returns HTTP 200 OK. The log "Resolved alarm in cloud: X" does NOT confirm an alarm was actually updated. Always cross-check cloud alarms table.
- **To verify cloud data gaps**: Query `device_readings` in Supabase around known offline events (from `alarms` table). Expected: gap duration matches offline duration, continuous data before/after.
- **Historical data gaps (~35-40s every 60s)**: Caused by old fixed `MAX_BUFFER_SIZE=10,000` overflow with high register counts. Dynamic buffer threshold `max(10000, register_count × flush_interval × 3)` prevents this (fixed 2026-02-12).
- **False `not_reporting` alarms from sync lag**: Cloud cron checks `device_readings` timestamps. If sync throughput < production rate, stale timestamps trigger false alarms even though controller is healthy. Fix: dynamic sync batch size (fixed 2026-02-12).
- **Bad register no longer blocks device data**: Register-specific errors (ExceptionResponse, address validation like "0 < address -1 < 65535 !") only fail that register — other registers on the same device continue logging normally. Only connection errors (timeout, unreachable) cascade to skip remaining registers (fixed 2026-02-13).
- **Viz register failures were invisible before REGISTER_READ_FAILED alarm**: Logging registers are first in `device.registers` list, viz/alarm registers appended after. If only viz registers fail, logging data continues flowing → cloud `check_device_connection_status` cron sees fresh `device_readings` timestamps → no alarm. `REGISTER_READ_FAILED` alarm (added 2026-02-13) closes this gap via SharedState IPC: device service writes `register_errors.json` after 20 consecutive failures → logging service health check creates per-device alarm.
- **SQLite freelist pages reclaimed automatically (fixed 2026-02-27)**: After retention cleanup deletes rows, `_vacuum_pause` event pauses flush/sync loops for ~2s, then `vacuum_incremental()` runs `wal_checkpoint(TRUNCATE)` + `incremental_vacuum(50000)` with no competing writers. Freelist should shrink each cleanup cycle. If freelist stays high, check logs for "Retention vacuum" messages.
- **SQLite DB file never shrinks despite retention deleting data**: Pre-existing DBs have `auto_vacuum=NONE` (SQLite default). `PRAGMA auto_vacuum=INCREMENTAL` set at init has no effect on existing DBs. `incremental_vacuum()` is a no-op. Fix (2026-02-13): `cleanup_old_data()` detects `auto_vacuum=0`, runs one-time `PRAGMA auto_vacuum=INCREMENTAL; VACUUM` to convert and reclaim all dead pages. New controllers get INCREMENTAL from creation. Diagnostic: `sudo -u volteria python3 -c "import sqlite3; c=sqlite3.connect('/opt/volteria/data/controller.db'); print('auto_vacuum:', c.execute('PRAGMA auto_vacuum').fetchone()); print('freelist:', c.execute('PRAGMA freelist_count').fetchone())"`.
- **Stale data defense is source-validated (fixed 2026-02-21)**: Device service guarantees only fresh readings exist in SharedState: (a) `clear_all_readings()` on connection cascade wipes all cached values, (b) `update_reading(success=False)` deletes individual stale readings, (c) logging service skips offline devices. No downstream timestamp staleness guards — validate at the source, not with magic numbers. Previously had a `MAX_READING_AGE_S` guard that was removed as over-engineering.
- **Zero is a valid reading**: DG off = 0 kW is real data. When device is unreachable, correct behavior is NO data point (gap in chart), not cached 0 being re-logged as current. Ghost readings (stale cached values re-stamped with `current_timestamp`) were the root cause of false 0s in historical data.
- **Delta fields NOT logged**: Controller logging service skips delta field names entirely (`_delta_field_names` set populated from config `site_calculations` where `type == "delta"`). Delta historical values computed on-the-fly by cloud RPC `get_historical_readings` (migration 106) from raw kWh counter readings with timezone-aligned bucketing. DeltaTracker still runs for real-time dashboard (SharedState) only. Log indicator: `"X delta fields skipped"` in config load message.

## Restart Controller (if needed)

```bash
curl -s -X POST "https://volteria.org/api/controllers/CONTROLLER_ID/update" \
  -H "Content-Type: application/json" \
  -d '{"controller_secret": "SECRET"}'
```

This triggers git pull + service restart via SSH tunnel. Use when code fix is deployed but controller hasn't picked it up.

---

## Connection Alarms & Severity

### Alarm Severity Hierarchy
```
info < warning < minor < major < critical
```

**Color coding**: warning=yellow, minor=amber, major=orange, critical=red

### Connection Alarm Config (in config.json)
Connection alarms now include `severity` field synced from cloud:
```json
"connection_alarm": {
  "enabled": true,
  "severity": "warning"  // warning | minor | major | critical
}
```

- **Device alarms**: Created by cloud cron job when device stops reporting (10 min timeout)
- **Severity**: Per-device setting stored in `site_devices.connection_alarm_severity`
- **Config sync**: `sync.py` includes both `enabled` and `severity` fields

### Verify Connection Alarm Config
```bash
grep -A3 "connection_alarm" /run/volteria/state/config.json
```

---

## Device Threshold Alarms

### How They Work
Device register threshold alarms are configured in the frontend (alarm_registers with thresholds) and evaluated by the controller.

**Data Flow:**
```
Frontend: alarm_registers[].thresholds configured per device
    ↓
Config Sync: alarm_registers synced to controller
    ↓
Logging Service: Converts alarm_registers → alarm_definitions at config load
    ↓
Sample Callback: Evaluates thresholds against device readings every 1s
    ↓
SQLite: Triggered alarms stored locally
    ↓
Cloud Sync: Alarms synced to Supabase (every 180s or instant for critical)
```

### Alarm Definition Format (internal)
```json
{
  "id": "reg_{device_id}_{register_name}",
  "name": "{register_name} Alarm",
  "source_type": "modbus_register",
  "source_key": "{register_name}",
  "device_id": "{device_id}",
  "device_name": "{device_name}",
  "conditions": [
    {"operator": ">", "value": 10, "severity": "warning", "message": "..."}
  ],
  "cooldown_seconds": 300
}
```

### Verify Alarm Definitions Loaded
```bash
journalctl -u volteria-logging --since "5 min ago" | grep "alarm definitions"
# Should show: "Config loaded: X alarm definitions" where X > 0
```

### Check Triggered Alarms
```bash
# Local SQLite
sqlite3 /opt/volteria/data/controller.db "SELECT alarm_type, device_name, message, severity FROM alarms ORDER BY id DESC LIMIT 5"

# Cloud (Supabase)
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/alarms?alarm_type=like.reg_*&order=created_at.desc&limit=5" \
  -H "apikey: SERVICE_ROLE_KEY"
```

### Deduplication & Cooldown
- **Deduplication**: If an unresolved alarm exists for this type+device, new alarms are skipped
- **Cooldown**: 300 seconds (5 minutes) between re-triggers of same alarm ID
- Each threshold condition evaluated independently
- First matching condition triggers (then breaks)

### Message Format
Alarms use a formatted message that includes all context:
```
{user_message} - {register_name} {operator} {threshold} ({device_name})
```
Example: `"Temperature High - Ambient Temperature > 50 (Sensor Device)"`

### Troubleshooting

| Issue | Check | Fix |
|-------|-------|-----|
| No alarm definitions loaded | `grep "alarm definitions" journalctl` | Verify alarm_registers have thresholds in config |
| Alarms not triggering | Check device readings in SharedState | Verify register name matches exactly |
| Alarms not syncing | `curl :8085/stats` for unsynced count | Check cloud connectivity |
| Duplicate alarms while active | Check logs for "Skipping duplicate" | Deduplication working correctly |
| Alarms not deduplicating | Check resolved status in SQLite | Ensure previous alarm is unresolved |
| Duplicates after cooldown (5 min) | Resolution sync resolved NEW alarm | Fixed: sync only resolves alarms created BEFORE resolution timestamp |
| Stale REGISTER_READ_FAILED in cloud after restart | `_devices_with_register_alarms` tracking set starts empty on restart | Fixed in `251007e`: seeds from SQLite on first health check via `get_unresolved_device_ids_for_alarm_type()` |

### Resolution Sync (Bidirectional)
Cloud resolutions now sync back to controller:
- `sync_resolved_alarms()` runs every 180s (cloud sync interval)
- Queries cloud for alarms resolved in last 24 hours (extended for offline recovery)
- Updates local SQLite resolved status for alarms created BEFORE resolution timestamp
- Prevents incorrectly resolving NEW alarms when syncing old resolutions
- Enables proper deduplication after UI resolution
- **Skips `reg_*` alarms** — controller handles these via condition monitoring

Log indicator: `[CLOUD] Synced N alarm resolutions from cloud to local`

### Cloud Alarm Resolution (Controller → Cloud)
When controller auto-resolves an alarm, it syncs to cloud via `resolve_alarm_in_cloud()`:
- Uses **PATCH** request (not POST) to update existing alarm
- Targets: `site_id`, `alarm_type`, `resolved=false`
- Sets: `resolved=true`, `resolved_at=now`
- Called from: condition clear, threshold change, orphan resolution, drift recovery

```python
# cloud_sync.py
async def resolve_alarm_in_cloud(self, alarm_type: str) -> bool:
    response = await client.patch(
        f"{supabase_url}/rest/v1/alarms",
        params={"site_id": f"eq.{site_id}", "alarm_type": f"eq.{alarm_type}", "resolved": "eq.false"},
        json={"resolved": True, "resolved_at": now_iso},
    )
```

### Orphan Alarm Auto-Resolution
When alarm register is removed from config, existing unresolved alarms are auto-resolved:
- On config change, old definition IDs compared to new definition IDs
- Missing definitions = orphaned alarm types
- `resolve_alarms_by_type()` called for each orphaned type (local)
- `resolve_alarm_in_cloud()` called for each orphaned type (cloud sync)
- Log indicator: `[CONFIG] Auto-resolved X orphan alarm(s): alarm_id`

### Alarm Data Storage
**IMPORTANT**: Store condition in separate `condition` column, never embed in message field.
- `message`: User-defined message only (e.g., "major issue")
- `condition`: Threshold condition text (e.g., "Ambient Temperature < 50")
- `alarm_type`: For `reg_*` alarms: `reg_{device_id}_{register_name}`

## Cross-References

- **Site calculations data flow**: Use `/check-calculations` to verify computed totals (Total Load, Total DG, Total Solar) from register_role through control_state to device_readings
- **Controller/device issues**: Use `/check-controller` for service health, Modbus, safe mode

<!-- Updated: 2026-02-22 - Delta fields NOT logged to SQLite/cloud (computed by cloud RPC from raw kWh counters). Logging service skips via _delta_field_names set -->
<!-- Updated: 2026-02-15 - Added cross-reference to /check-calculations for site calculation data flow -->
<!-- Updated: 2026-02-13 - Added REGISTER_READ_FAILED alarm (device service writes failures to SharedState, logging service creates/auto-resolves per-device alarm) -->
