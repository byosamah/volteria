---
name: check-alarms
description: Check Volteria alarm system health — all 9 alarm types, auto-resolve, deduplication, cloud cron jobs, threshold config, and sync status. Use when user says "check alarms", "alarm issues", "stale alarms", or wants to audit the alarm pipeline end-to-end.
---

# Check Alarms - Volteria Alarm System Diagnostic

> Master reference for the alarm pipeline: controller-side (SQLite + evaluator), cloud-side (cron jobs + REST), frontend display, auto-resolve, deduplication, and sync.

## Trigger Conditions

Activate this skill when:
- Topics: alarms, stale alarms, alarm not resolving, alarm not triggering, duplicate alarms, not_reporting, controller_offline, REGISTER_READ_FAILED, threshold alarms, alarm sync, alarm config
- Files touched: `controller/services/logging/alarm_evaluator.py`, `controller/services/logging/service.py` (alarm sections), `controller/services/logging/cloud_sync.py` (alarm sync), `database/migrations/*alarm*`

---

## Alarm Types (9 Total)

### Controller-Generated (Logging Service)
| Type | Trigger | Severity | Auto-Resolve |
|------|---------|----------|--------------|
| `LOGGING_HIGH_DRIFT` | Scheduler drift > 5000ms | warning | Yes (3 consecutive healthy checks) |
| `LOGGING_BUFFER_BUILDUP` | RAM buffer > dynamic threshold | warning | Yes (3 consecutive healthy checks) |
| `LOGGING_CONSECUTIVE_ERRORS` | 3+ consecutive flush/sample errors | major | No (manual) |
| `REGISTER_READ_FAILED` | 20+ consecutive register failures per device | warning | Yes (when failures clear) |
| `CLOUD_SYNC_OFFLINE` | Cloud unreachable > 1 hour | warning | Yes (on reconnect) |
| `reg_{device_id}_{register}` | User-defined threshold exceeded | variable | Yes (condition clears) |

### Cloud-Generated (Supabase Cron Jobs, every 5 min)
| Type | Trigger | Severity | Auto-Resolve |
|------|---------|----------|--------------|
| `not_reporting` | Device no readings > 10 min (600s) | per-device config | Yes (device comes online) |
| `controller_offline` | No heartbeat > 2 min (120s) | per-site config | Yes (heartbeat resumes) |

### Legacy (Backend API)
| Type | Origin | Notes |
|------|--------|-------|
| `communication_lost`, `control_error`, `safe_mode_triggered`, `write_failed`, `command_not_taken` | Backend `/api/alarms/` | Created by backend, not controller |

---

## Step 0: Identify Controller

If no controller specified, query deployed controllers:

```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/controllers?select=id,serial_number,site_id,status&is_active=eq.true" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

Use Supabase credentials from project CLAUDE.md (Database Access section).

- If one controller: use it automatically
- If multiple: ask user which one

Store result as `CONTROLLER_ID` and `SITE_ID`.

Get SSH credentials:
```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/controllers?select=ssh_password,ssh_port,ssh_username&id=eq.CONTROLLER_ID" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

SSH path (from Windows, through DO server):
```bash
ssh root@159.223.224.203 "sshpass -p 'SSH_PASSWORD' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p SSH_PORT SSH_USER@localhost 'COMMAND'"
```

---

## Step 1: Cloud Alarm Overview

### 1a. All unresolved alarms for this site

```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/alarms?select=id,alarm_type,device_id,device_name,message,condition,severity,acknowledged,created_at&site_id=eq.SITE_ID&resolved=eq.false&order=created_at.desc" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

**Expected**: Empty array `[]` = healthy. Any results = active issues.

### 1b. Alarm counts by type (last 7 days)

```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/alarms?select=alarm_type,resolved,severity&site_id=eq.SITE_ID&created_at=gte.$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)&order=created_at.desc&limit=200" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

Tally by alarm_type and resolved status. High churn (many create+resolve cycles) = flapping condition.

### 1c. Recently resolved alarms (last 24h)

```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/alarms?select=alarm_type,device_name,severity,created_at,resolved_at&site_id=eq.SITE_ID&resolved=eq.true&resolved_at=gte.$(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%SZ)&order=resolved_at.desc&limit=20" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

Check for healthy auto-resolve patterns. Short-lived alarms that self-resolve = working correctly.

---

## Step 2: Controller-Side Alarms (Local SQLite)

### 2a. Unsynced and unresolved alarms

```bash
ssh root@159.223.224.203 "sshpass -p 'SSH_PASSWORD' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'sudo -u volteria sqlite3 /opt/volteria/data/controller.db \"
    SELECT \\\"--- Unsynced ---\\\";
    SELECT count(*) FROM alarms WHERE synced_at IS NULL;
    SELECT \\\"--- Unresolved (local) ---\\\";
    SELECT alarm_type, device_name, message, severity, timestamp FROM alarms WHERE resolved = 0 ORDER BY id DESC LIMIT 10;
    SELECT \\\"--- Total alarms ---\\\";
    SELECT count(*) FROM alarms;
  \"'"
```

### 2b. Local vs cloud mismatch check

Compare: if local has `resolved=1` but cloud has `resolved=false` for same alarm_type → cloud resolve call was missed.

```bash
# Check local resolved alarms in last 24h
ssh root@159.223.224.203 "sshpass -p 'SSH_PASSWORD' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'sudo -u volteria sqlite3 /opt/volteria/data/controller.db \"
    SELECT alarm_type, device_name, resolved, resolved_at FROM alarms
    WHERE resolved = 1 AND resolved_at > datetime(\\\"now\\\", \\\"-1 day\\\")
    ORDER BY resolved_at DESC LIMIT 10;
  \"'"
```

Cross-check with Step 1c cloud results. Any alarm resolved locally but still `resolved=false` in cloud = sync gap.

---

## Step 3: Register Error State

### 3a. Check SharedState for persistent register failures

```bash
ssh root@159.223.224.203 "sshpass -p 'SSH_PASSWORD' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'cat /run/volteria/state/register_errors.json 2>/dev/null | python3 -m json.tool || echo \"No register errors file\"'"
```

**Expected**: `{"_updated_at": "..."}` only (no device entries) = healthy.

If device entries exist: lists device_id → {register_name: error_msg, ...} for devices with 20+ consecutive failures.

### 3b. Cross-check: errors exist but no alarm?

If register_errors.json has device entries but Step 1a shows no `REGISTER_READ_FAILED` alarm:
- Alarm seeding may not have run yet (first health check ~10 min after start)
- Check logging service uptime: `curl -s localhost:8085/stats | python3 -c "import sys,json; print(json.load(sys.stdin)['uptime_seconds'])"`
- If uptime < 600s: wait for first health check cycle

---

## Step 4: Health Alarm State

### 4a. Logging service health metrics

```bash
ssh root@159.223.224.203 "sshpass -p 'SSH_PASSWORD' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'curl -s localhost:8085/stats | python3 -m json.tool'"
```

Check these fields for alarm triggers:

| Field | Alarm Trigger | Current Threshold |
|-------|--------------|-------------------|
| `timing.sample_drift_ms` | > 5000 → LOGGING_HIGH_DRIFT | 5000ms |
| `timing.flush_drift_ms` | > 5000 → LOGGING_HIGH_DRIFT | 5000ms |
| `buffer.readings_count` | > alert_threshold → LOGGING_BUFFER_BUILDUP | `register_count × flush_interval × 2` |
| `errors.sample_errors` | 3+ consecutive → LOGGING_CONSECUTIVE_ERRORS | 3 |
| `errors.flush_errors` | 3+ consecutive → LOGGING_CONSECUTIVE_ERRORS | 3 |
| `errors.cloud_errors` | accumulates → eventual CLOUD_SYNC_OFFLINE | 1 hour |

### 4b. Debug endpoint for alarm-specific counters

```bash
ssh root@159.223.224.203 "sshpass -p 'SSH_PASSWORD' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'curl -s localhost:8085/debug | python3 -c \"
import sys, json
d = json.load(sys.stdin)
print(\\\"=== Alarm State ===\")
for k in [\\\"active_alarms\\\", \\\"alarm_definitions_count\\\", \\\"unsynced_alarms\\\"]:
    print(f\\\"{k}: {d.get(k, \\\"N/A\\\")}\\\")
print(\\\"=== Cloud Sync ===\")
cs = d.get(\\\"cloud_sync\\\", {})
for k in [\\\"alarm_sync_count\\\", \\\"error_count\\\", \\\"consecutive_failures\\\", \\\"offline_seconds\\\"]:
    print(f\\\"{k}: {cs.get(k, \\\"N/A\\\")}\\\")
\"'"
```

---

## Step 5: Cloud Cron Job Health

### 5a. Device connection alarm cron (`not_reporting`)

Check for devices that SHOULD have alarms but don't (or vice versa):

```bash
# Enabled devices with their online status and alarm settings
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/site_devices?select=id,name,is_online,last_seen,enabled,connection_alarm_enabled,connection_alarm_severity&site_id=eq.SITE_ID&enabled=eq.true" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

For each device: if `is_online=false` and `connection_alarm_enabled=true` and `last_seen` > 10 min ago → should have `not_reporting` alarm in cloud.

### 5b. Controller offline alarm cron

```bash
# Controller heartbeat freshness
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/controller_heartbeats?select=controller_id,timestamp&controller_id=eq.CONTROLLER_ID&order=timestamp.desc&limit=1" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

If last heartbeat > 2 min old → should have `controller_offline` alarm.

```bash
# Controller alarm settings
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/site_master_devices?select=id,name,controller_alarm_enabled,controller_alarm_severity&site_id=eq.SITE_ID&device_type=eq.controller" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

### 5c. Verify cron jobs are scheduled

```bash
# Check pg_cron jobs exist (requires exec_sql RPC)
curl -s -X POST "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/rpc/exec_sql" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE '\''%alarm%'\'' OR jobname LIKE '\''%device%'\'' OR jobname LIKE '\''%controller%'\''"}'
```

Expected: `check-device-alarms` (*/5 * * * *, active) and `check-controller-alarms` (*/5 * * * *, active).

---

## Step 6: Threshold Alarm Config

### 6a. Alarm definitions loaded on controller

```bash
ssh root@159.223.224.203 "sshpass -p 'SSH_PASSWORD' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'journalctl -u volteria-logging --since \"30 min ago\" --no-pager | grep -i \"alarm def\"'"
```

Expected: `Config loaded: X alarm definitions` where X matches configured thresholds.

### 6b. Alarm registers in config

```bash
ssh root@159.223.224.203 "sshpass -p 'SSH_PASSWORD' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'python3 -c \"
import json
c = json.load(open(\\\"/run/volteria/state/config.json\\\"))
for d in c.get(\\\"devices\\\", []):
    alarms = d.get(\\\"alarm_registers\\\", [])
    if alarms:
        for a in alarms:
            thresholds = a.get(\\\"thresholds\\\", [])
            if thresholds:
                print(f\\\"{d[\\\"name\\\"]}: {a[\\\"name\\\"]} -> {thresholds}\\\")
\"'"
```

If empty: no threshold alarms configured (may be expected).

---

## Step 7: Alarm Sync Health

### 7a. Unsynced alarms

From Step 2a: unsynced count should be 0 or very low (< 5).

If growing: cloud sync is failing. Check:
- Cloud connectivity (Step 4a cloud_errors)
- Supabase credentials valid
- Network from Pi

### 7b. Resolution sync (cloud → local)

```bash
ssh root@159.223.224.203 "sshpass -p 'SSH_PASSWORD' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'journalctl -u volteria-logging --since \"1 hour ago\" --no-pager | grep -i \"alarm resolution\"'"
```

Expected: `[CLOUD] Synced N alarm resolutions from cloud to local` periodically.

**Note**: `reg_*` threshold alarms are intentionally skipped in resolution sync — controller monitors conditions independently.

---

## Output Format

**Alarm Health: [HEALTHY / ISSUES FOUND]**

| Check | Status | Details |
|-------|--------|---------|
| Unresolved alarms (cloud) | OK (0) / N found | list alarm_types |
| REGISTER_READ_FAILED | OK / N active | device names |
| LOGGING_HIGH_DRIFT | OK / active | drift ms |
| LOGGING_BUFFER_BUILDUP | OK / active | buffer count vs threshold |
| CLOUD_SYNC_OFFLINE | OK / active | offline duration |
| LOGGING_CONSECUTIVE_ERRORS | OK / active | error count |
| not_reporting (cron) | OK / N devices | device names |
| controller_offline (cron) | OK / active | heartbeat age |
| Threshold alarms (reg_*) | OK / N active | conditions |
| Register errors (SharedState) | OK / N devices | device list |
| Local unsynced alarms | OK (0) / N pending | count |
| Local vs cloud sync | OK / mismatch | details |
| Alarm definitions loaded | N definitions | from config |
| Cron jobs active | OK / missing | job names |
| Alarm seeding (post-restart) | OK / not seeded | tracking set status |

---

## Alarm Lifecycle

```
Condition Met (threshold / drift / failure / offline)
    │
    ├─ Cooldown check (300s for threshold, immediate for health)
    │
    ▼
CREATE Alarm
    ├─ Local: insert_alarm() → SQLite (synced_at = NULL)
    ├─ Cloud: sync_alarms() batch (every 180s)
    │         OR sync_alarm_immediately() for critical/major
    │
    ▼
ACTIVE (resolved = false)
    ├─ User can ACKNOWLEDGE via UI
    ├─ Deduplication prevents duplicate creation
    │
    ▼ (Condition clears)
AUTO-RESOLVE
    ├─ Local: resolve_alarms_by_type[_and_device]()
    ├─ Cloud: resolve_alarm_in_cloud() via PATCH
    │
    ▼
RESOLVED (resolved = true, resolved_at = timestamp)
```

## Auto-Resolve Reference

| Alarm Type | Trigger to Resolve | Guard | Code Location |
|------------|-------------------|-------|---------------|
| LOGGING_HIGH_DRIFT | drift < 5000ms | 3 consecutive healthy checks (`== 3`) | service.py:1660 |
| LOGGING_BUFFER_BUILDUP | buffer < threshold | 3 consecutive healthy checks (`== 3`) | service.py:1682 |
| REGISTER_READ_FAILED | device clears failures | register_errors.json empty for device | service.py:1757 |
| CLOUD_SYNC_OFFLINE | cloud becomes reachable | successful sync | service.py:1600 |
| Threshold (reg_*) | value no longer matches condition | evaluator returns empty active_conditions | service.py:1402 |
| not_reporting | device sends new reading | cloud cron detects fresh `last_seen` | migration 082 |
| controller_offline | heartbeat resumes | cloud cron detects fresh heartbeat | migration 095 |

**Critical**: Auto-resolve guards use `== N` (fire once on transition), NOT `>= N` (would fire every cycle).

## Deduplication (3-Tier)

1. **Local SQLite**: `has_unresolved_alarm(site_id, alarm_type, device_id)` — prevents duplicate creation
2. **Cloud check**: `check_unresolved_alarm()` — fallback for critical/major alarms
3. **Cooldown**: Per alarm per device, prevents re-trigger within `cooldown_seconds` (300s default)

## Alarm Matching

- **By `device_id` (UUID)** — immutable, survives device renames (migration 099)
- **Fallback to `device_name`** — for old alarms without device_id
- **Health alarms** (LOGGING_*, CLOUD_*) — match by alarm_type only (site-level, no device)

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Stale alarms after service restart | `_devices_with_register_alarms` tracking set starts empty | Fixed in `251007e`: seeds from SQLite on first health check via `get_unresolved_device_ids_for_alarm_type()`. Verify with journalctl: "Seeded register alarm tracking" |
| REGISTER_READ_FAILED from stale serial lock | FTDI USB adapter hiccup → stale pyserial file descriptor | Fixed: 3-layer auto-reconnect (close old client, pool eviction, reader trigger). Alarms auto-resolve once connection recovers. Old code: manual `systemctl restart volteria-device` |
| Alarm resolved locally, stuck in cloud | `resolve_alarm_in_cloud()` call failed or was skipped | Manually PATCH alarm in Supabase: `resolved=true, resolved_at=now()`. Verify every `resolve_alarms_by_type()` pairs with `resolve_alarm_in_cloud()` |
| `not_reporting` false positives | Cloud sync lag — stale `device_readings` timestamps despite controller being healthy | Dynamic sync batch size (`max(5000, register_count * 200)`) ensures throughput > production. If persists, check network. |
| `controller_offline` when site powered off | Expected — no heartbeat when power is off | No fix needed. Verify alarm auto-resolves when power returns and heartbeat resumes. |
| Threshold alarm not triggering | Register name mismatch between alarm_registers config and SharedState readings | Check alarm_registers in config.json (Step 6b). Name must match device readings exactly. |
| Threshold alarm not triggering (no definitions) | alarm_registers missing thresholds array | Verify Step 6a shows `Config loaded: X alarm definitions` where X > 0 |
| Auto-resolve not firing (health alarms) | Consecutive check counter stuck below 3 | Check for intermittent condition flapping — counter resets on any unhealthy check. Needs 3 *consecutive* healthy checks. |
| Auto-resolve fires every cycle | Guard uses `>= N` instead of `== N` | Bug — should use `== N` to fire once on transition. Check service.py resolve guards. |
| Duplicate alarms in cloud | Cooldown expired (300s default) + condition still true | Normal if condition persists beyond cooldown. Increase cooldown_seconds in alarm config if too noisy. |
| Connection alarm wrong severity | `site_devices.connection_alarm_severity` not set | Default is 'warning'. Override per device in site alarm config UI. Controller alarms use `site_master_devices.controller_alarm_severity` (default 'critical'). |
| Disabled devices triggering `not_reporting` | Cloud cron not filtering by `enabled=true` | Fixed: `check_device_connection_status()` filters `sd.enabled = true`. If stale, check migration 082 is applied. |
| 0 kW device assumed offline by user | 0 output = idle/unloaded, NOT offline | Only truly offline if zero readings in SharedState. Don't create alarms for idle devices. |
| REGISTER_READ_FAILED alarms don't affect Live page | Independent systems | Live page reads from controller via SSH (`register_cli.py`), never checks alarms table. Stale alarms are cosmetic only. |
| Cloud resolve returns success but alarm still unresolved | PATCH matched 0 rows (already resolved or alarm_type mismatch) | `resolve_alarm_in_cloud()` logs success even when no rows matched (HTTP 200 OK). Cross-check cloud alarms table directly. |
| Alarm churn (rapid create/resolve cycles) | Threshold set near value, oscillating readings | Increase cooldown_seconds or adjust threshold to add hysteresis. Check Step 1b for high alarm count in 7 days. |
| `CLOUD_SYNC_OFFLINE` alarm | Pi lost internet for > 1 hour | Alarm auto-resolves on reconnect. If persistent: check Pi network, DNS, Supabase status. |
| Resolution sync skips threshold alarms | By design — `sync_resolved_alarms()` skips `reg_*` alarms | Controller monitors conditions independently. User resolve in UI doesn't affect controller behavior. |
| Cron jobs not running | pg_cron extension disabled or jobs inactive | Check Step 5c. Re-enable with: `UPDATE cron.job SET active = true WHERE jobname = 'check-device-alarms'` |

---

## Cross-References

- **Service health, device connectivity, safe mode**: Use `/check-controller`
- **Buffer, drift, cloud sync, SQLite health**: Use `/check-logging`
- **Calculated field values, register_role pipeline**: Use `/check-calculations`
- **Wizard flow, provisioning, SSH tunnel**: Use `/check-setup`

### Known Behaviors

- **High REGISTER_READ_FAILED count before seeding fix**: Sites with frequent service restarts accumulated many alarms (191 in 7 days for 2 devices) because `_devices_with_register_alarms` started empty on each restart, bypassing deduplication for pre-restart alarms. Fixed in `251007e` — count should stabilize going forward.
- **`resolve_alarm_in_cloud()` logs success even when no alarm exists**: PATCH on 0 matching rows returns HTTP 200. Always cross-check cloud alarms table directly.
- **Alarm duplication despite working dedup**: When alarms duplicate despite `has_unresolved_alarm()` working correctly, check `sync_resolved_alarms()` and cloud→local resolution paths — they may resolve local alarms behind the dedup's back. Controller-managed types (`REGISTER_READ_FAILED`, `LOGGING_HIGH_DRIFT`, etc.) must be in the `_CONTROLLER_MANAGED_TYPES` skip list in `cloud_sync.py`. Fixed in `8a59389`.

<!-- Updated: 2026-02-20 - Added sync_resolved_alarms dedup bypass diagnostic -->
<!-- Created: 2026-02-17 - Comprehensive alarm diagnostic covering 9 alarm types, 3-tier dedup, auto-resolve, cloud cron, threshold config -->
