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

If issues found: list specific problems with remediations below the table.

## Remediation Guide

| Problem | Cause | Fix |
|---------|-------|-----|
| High buffer | Flush stalled or register count explosion | Buffer thresholds are dynamic: `register_count × flush_interval × 2` (alert) / `× 3` (max). If buffer alarm fires after adding devices, thresholds auto-recalculate on config reload. Auto-resolves after 3 healthy checks. If persistent, check SQLite disk space. |
| Cloud errors | Auth/network | Verify Supabase keys in controller config |
| Freq misses | Stale register names or new registers | Normal briefly after rename; persistent = add `logging_frequency` |
| Unsynced growing | Network/rate | Check internet, restart controller |
| No clock buckets | No device reads | Verify device service is running |
| Empty batches | All filtered | Lower `logging_frequency` values |
| LOGGING_HIGH_DRIFT alarms | Blocking SQLite on event loop | Ensure all `local_db` calls use `_run_db()` wrapper (run_in_executor). Threshold is 5000ms. |
| Drift alarms accumulating | No auto-resolve | After 3 healthy checks, alarms auto-resolve. If not resolving, check `_consecutive_low_drift_checks` logic |
| Alarm resolved locally but stuck in cloud | Missing `resolve_alarm_in_cloud()` call | Every `resolve_alarms_by_type()` must be paired with `cloud_sync.resolve_alarm_in_cloud(alarm_type)`. Compare SQLite `resolved=1` vs Supabase `resolved=false` for same alarm. |
| Repeated "Resolved alarm in cloud" spam | Auto-resolve guard uses `>= N` instead of `== N` | Use `== N` for consecutive-check guards so resolve fires exactly once on transition, not every cycle forever |

### Known Behaviors

- **`resolve_alarm_in_cloud()` logs success even when no alarm exists** — PATCH on 0 matching rows returns HTTP 200 OK. The log "Resolved alarm in cloud: X" does NOT confirm an alarm was actually updated. Always cross-check cloud alarms table.
- **To verify cloud data gaps**: Query `device_readings` in Supabase around known offline events (from `alarms` table). Expected: gap duration matches offline duration, continuous data before/after.

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

<!-- Updated: 2026-02-06 - Added resolve spam fix pattern, resolve_alarm_in_cloud known behavior, cloud gap verification -->
