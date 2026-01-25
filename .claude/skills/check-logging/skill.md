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

If issues found: list specific problems with remediations below the table.

## Remediation Guide

| Problem | Cause | Fix |
|---------|-------|-----|
| High buffer | Flush stalled | Check SQLite disk space via SSH |
| Cloud errors | Auth/network | Verify Supabase keys in controller config |
| Freq misses | Stale register names or new registers | Normal briefly after rename; persistent = add `logging_frequency` |
| Unsynced growing | Network/rate | Check internet, restart controller |
| No clock buckets | No device reads | Verify device service is running |
| Empty batches | All filtered | Lower `logging_frequency` values |
| LOGGING_HIGH_DRIFT alarms | Blocking SQLite on event loop | Ensure all `local_db` calls use `_run_db()` wrapper (run_in_executor). Threshold is 5000ms. |
| Drift alarms accumulating | No auto-resolve | After 3 healthy checks, alarms auto-resolve. If not resolving, check `_consecutive_low_drift_checks` logic |

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

<!-- Updated: 2026-01-25 - Added connection alarm severity info -->
