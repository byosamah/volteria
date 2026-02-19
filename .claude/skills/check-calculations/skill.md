---
name: check-calculations
description: Check Volteria site-level calculations (Total Load, Total DG, Total Solar, etc.) and calculated field pipeline. Use when user says "check calculations", "site calculations", "calculated fields", "register role", or wants to verify computed totals, check data flow from register_role to cloud, or diagnose missing/wrong calculated values.
---

# Check Calculations

Diagnose site-level calculated fields: register_role assignment, computation, logging, and cloud data.

## Architecture

```
Register Role (template) → Config Sync (register_role in calculation_config)
    ↓
Config (site_calculations list + controller_device_id)
    ↓
Device Manager: compute_site_calculations() inline → readings.json (zero-lag)
    ↓
Logging Service: samples into buffer → SQLite → Cloud (device_readings table)
    ↓
Historical Data: query by controller device_id
```

Pure functions in `common/site_calculations.py` (shared by device + control services).

## Calculation Types

| Type | Description | Example |
|------|-------------|---------|
| `sum` | Sum register values across devices by register_role | Total Load = sum(load_active_power) |
| `delta` | Completed window total (last - first) per device per time window, summed | Hourly DG Energy = sum(kwh_end - kwh_start) per hour |
| `difference` | One calculated field minus another | DG Power = Load - Solar |
| `cumulative` | Trapezoidal integration of power over time | Energy from power |
| `average` | Average across matching devices | Average temperature |
| `max`/`min` | Peak/minimum across devices | Peak load |

## Delta Fields (DeltaTracker)

Delta fields track kWh counter deltas using a **completed window totals** pattern:

```
14:00:01  DeltaTracker detects hour 13→14 transition
          Computes hour-13 total = latest - first = 28.5 kWh
          Stores completed[hour-13] = 28.5
          Output = 28.5 (stable for ALL of hour 14)
14:00:02  Output = 28.5
...
14:59:59  Output = 28.5
15:00:01  Detects hour 14→15 transition → Output = hour-14 total
```

**Key properties:**
- Output is a **stable constant** for the entire window (not a running total)
- Cloud downsampling picks FIRST reading per bucket → always correct (all readings = same value)
- **Frequencies locked**: 3600s (hourly), 86400s (daily) — frontend dropdown disabled
- **Non-24/7 sites**: State persists across overnight shutdowns (7-day staleness limit). As long as 2+ readings exist in a window, the delta is captured correctly
- **Meter reset handling**: If counter decreases (reset to 0), energy splits into segments: (pre-reset) + (post-reset). No energy silently lost. 1 kWh tolerance for float noise.
- **Offline devices still counted**: Completed window deltas included even when device temporarily offline
- Singleton `_delta_tracker` in `common/site_calculations.py` — **persisted** to tmpfs every 60s + disk on shutdown, restored on startup
- Offline devices' completed deltas always counted in sum (not just devices with fresh readings)

## Register Role Reference

| Role | Device Type | Measurement | Calc Field |
|------|------------|-------------|------------|
| `load_active_power` | load/load_meter | Active power kW | total_load_kw |
| `diesel_generator_active_power` | diesel_generator/dg | Active power kW | total_generator_kw |
| `solar_active_power` | inverter | Active power kW | total_solar_kw |
| `load_kwh_counter` | load/load_meter | Energy counter kWh | hourly/daily_load_energy_kwh |
| `diesel_generator_kwh_counter` | diesel_generator/dg | Energy counter kWh | hourly/daily_dg_energy_kwh |
| `solar_kwh_counter` | inverter | Energy counter kWh | hourly/daily_solar_energy_kwh |

## Step 0: Identify Controller

Same as `/check-logging` Step 0. Get `CONTROLLER_ID`, `SITE_ID`, `SECRET`.

```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/controllers?select=id,serial_number,site_id,status&is_active=eq.true" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

Get SSH password:
```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/controllers?select=ssh_password,ssh_port,ssh_username&id=eq.CONTROLLER_ID" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

## Step 1: Check Config (site_calculations + register_role)

### 1a. Verify project timezone is set

```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/projects?id=eq.PROJECT_ID&select=id,name,timezone" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

Expected: `"timezone": "Asia/Dubai"` (or appropriate IANA timezone). **If null**, delta field windows use UTC instead of local time — fix with `PATCH projects SET timezone = 'Asia/Dubai'`. Timezone is on `projects` table, NOT `sites`.

**After fixing timezone**: Restart config service (`systemctl restart volteria-config`) — timezone change alone doesn't trigger config hash change.

### 1b. Verify config has site_calculations

SSH to controller and check config:
```bash
ssh root@159.223.224.203 "sshpass -p 'SECRET' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'python3 -c \"import json; c=json.load(open(\\\"/run/volteria/state/config.json\\\")); print(json.dumps(c.get(\\\"site_calculations\\\", []), indent=2))\"'"
```

Expected: List of calculations with `field_id`, `name`, `register_role`, `type`, `unit`.

If empty: calculated fields not selected on controller device OR config sync hasn't run.

### 1c. Verify controller_device_id

```bash
ssh root@159.223.224.203 "sshpass -p 'SECRET' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'python3 -c \"import json; c=json.load(open(\\\"/run/volteria/state/config.json\\\")); print(c.get(\\\"controller_device_id\\\"))\"'"
```

Expected: UUID of the Site Controller from `site_master_devices`.

### 1d. Verify register_roles on device registers

```bash
ssh root@159.223.224.203 "sshpass -p 'SECRET' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'python3 -c \"
import json
c=json.load(open(\\\"/run/volteria/state/config.json\\\"))
for d in c.get(\\\"devices\\\", []):
    roles = [(r[\\\"name\\\"], r.get(\\\"register_role\\\")) for r in d.get(\\\"registers\\\", []) + d.get(\\\"visualization_registers\\\", []) if r.get(\\\"register_role\\\") and r.get(\\\"register_role\\\") != \\\"none\\\"]
    if roles:
        print(f\\\"{d[\\\"name\\\"]} ({d[\\\"device_type\\\"]}): {roles}\\\")
\"'"
```

Expected: Each device with assigned register_roles showing correct role names.

### 1e. Verify virtual controller device in config

Check that a `site_controller` device exists in the devices list (needed for logging whitelist):
```bash
ssh root@159.223.224.203 "sshpass -p 'SECRET' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'python3 -c \"import json; c=json.load(open(\\\"/run/volteria/state/config.json\\\")); [print(json.dumps(d, indent=2)) for d in c.get(\\\"devices\\\", []) if d.get(\\\"device_type\\\") == \\\"site_controller\\\"]\"'"
```

## Step 2: Verify readings.json (zero-lag inline computation)

Site calculations live in `readings.json` (virtual controller device), **NOT** in `control_state.json`. Never check control_state for calculated field values.

```bash
ssh root@159.223.224.203 "sshpass -p 'SECRET' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'python3 -c \"import json; r=json.load(open(\\\"/run/volteria/state/readings.json\\\")); cid=\\\"CONTROLLER_DEVICE_ID\\\"; print(json.dumps(r[\\\"devices\\\"].get(cid, \\\"NOT FOUND\\\"), indent=2))\"'"
```

Expected:
```json
{
  "readings": {
    "Total Load Active Power": {"value": 567.0, "unit": "kW"},
    "Hourly DG Energy Production": {"value": 24.0, "unit": "kWh"},
    "Daily Load Energy Consumption": {"value": 0.0, "unit": "kWh"}
  }
}
```

If NOT FOUND: device_manager not injecting. Check `controller_device_id` in config (Step 1b) and device service logs: `journalctl -u volteria-device --since "5 min ago" | grep -i "site_calc\|common.site_calc"`.

### Step 2b: Verify delta field stability (not running total)

For delta fields, sample twice with a gap to confirm values are stable:
```bash
ssh root@159.223.224.203 "sshpass -p 'SECRET' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'python3 -c \"
import json, time
def get_energy():
    r = json.load(open(\\\"/run/volteria/state/readings.json\\\"))
    vc = r[\\\"devices\\\"].get(\\\"CONTROLLER_DEVICE_ID\\\", {}).get(\\\"readings\\\", {})
    return {k: v[\\\"value\\\"] for k, v in vc.items() if \\\"Energy\\\" in k}
v1 = get_energy(); print(f\\\"Sample 1: {v1}\\\")
time.sleep(5)
v2 = get_energy(); print(f\\\"Sample 2: {v2}\\\")
print(\\\"PASS: Stable\\\" if v1 == v2 else \\\"FAIL: Running total detected!\\\")
\"'"
```

Expected: Both samples identical (completed window totals are constant within a window).
If FAIL: Old DeltaTracker code still deployed — verify `_completed` exists in `site_calculations.py`.

### Step 2c: Verify DeltaTracker persistence

Check that DeltaTracker state is being saved (tmpfs key + disk file):
```bash
ssh root@159.223.224.203 "sshpass -p 'SECRET' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'python3 -c \"
import json, os
tmpfs = \\\"/run/volteria/state/delta_tracker.json\\\"
disk = \\\"/opt/volteria/data/delta_tracker_state.json\\\"
for label, path in [(\\\"tmpfs\\\", tmpfs), (\\\"disk\\\", disk)]:
    if os.path.exists(path):
        d = json.load(open(path))
        trackers = sum(len(v) for v in d.get(\\\"state\\\", {}).values())
        completed = sum(len(v) for v in d.get(\\\"completed\\\", {}).values())
        print(f\\\"{label}: {trackers} trackers, {completed} completed, saved_at={d.get(\\\"saved_at\\\", \\\"?\\\")}\\\")
    else:
        print(f\\\"{label}: NOT FOUND\\\")
\"'"
```

Expected: tmpfs file recent (<60s), disk file present after at least one graceful shutdown. If tmpfs missing, device service isn't saving periodically — check logs for errors.

## Step 3: Check SQLite

**Note:** Must use `sudo -u volteria sqlite3` — bare `sqlite3` or `-readonly` flag fails with "attempt to write a readonly database" when run as voltadmin.

```bash
ssh root@159.223.224.203 "sshpass -p 'SECRET' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'sudo -u volteria sqlite3 /opt/volteria/data/controller.db \"SELECT register_name, value, timestamp FROM device_readings WHERE device_id = \\\"CONTROLLER_DEVICE_ID\\\" ORDER BY id DESC LIMIT 10\"'"
```

Expected: Recent rows with calculated field names (Total Load, Total Generator Power, etc.).

## Step 4: Check Cloud

```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/device_readings?device_id=eq.CONTROLLER_DEVICE_ID&order=timestamp.desc&limit=10&select=register_name,value,timestamp,unit" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

Expected: Cloud has recent calculated field readings matching SQLite data.

## Step 5: Check DB Definitions

Verify `calculated_field_definitions` have `register_role` in `calculation_config`:
```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/calculated_field_definitions?scope=eq.controller&select=field_id,name,calculation_type,calculation_config,unit" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

Check that sum-type fields have `register_role` in their `calculation_config`.

## Step 6: Cross-Check Individual Devices vs Calculated Totals

For delta fields, verify the site-level total matches the sum of individual device kWh counter deltas. Query cloud `device_readings` for each device's kWh counter at hour boundaries, compute `end - start` per device, and compare against the calculated field value.

```bash
# Get individual device kWh counters at hour boundaries (adjust device_ids and timestamps)
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/device_readings?device_id=in.(DEV1,DEV2)&register_name=eq.COUNTER_REGISTER&timestamp=in.(START_UTC,END_UTC)&order=device_id,timestamp.asc&select=device_id,value,timestamp" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

Expected: Sum of per-device deltas matches calculated field value within ~1 kWh (residual from 3s lookahead shifting the window edge by ~3s vs cloud's clock-aligned timestamps). Larger gaps (scaling with device count) indicate DeltaTracker window gap bug — verify `new_first = device_state["latest"]` in `site_calculations.py`.

## Output Format

**Site Calculations: [HEALTHY / ISSUES FOUND]**

| Check | Status | Details |
|-------|--------|---------|
| Config: site_calculations | OK/Missing | X calculations defined |
| Config: controller_device_id | OK/Missing | UUID present |
| Config: register_roles assigned | OK/Missing | X roles across Y devices |
| Config: virtual controller device | OK/Missing | site_controller in devices list |
| readings.json: controller device | OK/Missing | device injected with readings |
| readings.json: delta stability | OK/Running total | Sample twice, values should match |
| DeltaTracker persistence | OK/Missing | tmpfs + disk state files present and recent |
| SQLite: calculated fields logged | OK/No data | X recent rows |
| Cloud: data synced | OK/No data | X recent rows |

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Total is 0 but devices have readings | register_role not assigned | Check template registers, assign role via frontend |
| site_calculations empty in config | Fields not selected on controller | Enable in Site Calculations tab of controller edit |
| controller_device_id missing | site_master_devices row missing | Create controller master device for this site |
| Calcs not in readings.json | Device manager not computing inline | Check device service logs, verify config has site_calculations + controller_device_id |
| Calcs not in SQLite | Logging service not sampling | Check virtual controller device in config devices list (whitelist) |
| Calcs not in cloud | Not synced yet or field not in config | Check `/check-logging` for sync health |
| Wrong register_role mapping | calculation_config missing register_role | Update `calculated_field_definitions.calculation_config` in DB |
| logging_frequency not applied | Config sync reads from wrong table | Verify `site_master_devices.calculated_fields` has correct `logging_frequency_seconds`, then check controller config `site_calculations[].logging_frequency` matches. Fix is in `sync.py` line 415: must read from `selection` (per-device) not `defn` (global). |
| Delta fields show 0 after restart | No persisted state or state too old (>7d) | Check tmpfs/disk state files (Step 2c). Staleness limit is 7 days (supports non-24/7 sites). If state file missing, check disk write errors in device service logs |
| Delta values changing every second | Old running-total DeltaTracker deployed | Verify `_completed` dict exists in `site_calculations.py` on Pi |
| Hourly delta frequency not 3600 | DB or config mismatch | Check `calculated_field_definitions.logging_frequency_seconds` and `site_master_devices.calculated_fields` JSONB |
| One offline device breaks all calcs | Should not happen | Offline devices: sum fields skip gracefully, delta fields still include completed window totals |
| Hourly/daily delta undercount | Old code: offline devices or restart state loss | Verify commit `00311fb` deployed — adds persistence + offline device counting |
| Device showing 0 kW assumed offline | 0 output ≠ offline | 0 kW/kVA means idle/unloaded, NOT offline. Only truly offline if zero readings in SharedState. Verify from Live Registers page before declaring offline |
| Delta windows misaligned (UTC not local) | `projects.timezone` is null | Set timezone on projects table (not sites). Restart config service after — not in hash |
| Delta values identical for different fields | Likely partial window after restart | Wait for first full completed window. Old running-total data proves mapping correct if values differ |
| Delta undercount scaling with device count | Old DeltaTracker gap: `first = value` instead of `first = old_latest` | Verify `new_first = device_state["latest"]` in `site_calculations.py`. Gap = ~1 kWh/device/hour with integer counters |
| Timezone change shows partial values | Window key changed mid-hour | Expected — first values after timezone change are from a partial window |
| Cloud verification shows mismatch | Timestamp misalignment | Calculated fields may log at different frequency (e.g., 5s) than source registers (e.g., 60s). Verify from SharedState (real-time) or align to minute boundaries where both have data. |
| Cloud shows wrong delta after restart | Logging service sampled before DeltaTracker transition wrote to readings.json | One-time artifact of restart — next full hour will be correct. Verify via readings.json (real-time) not cloud (hourly sample). The 3s lookahead mitigates but doesn't guarantee the race. |
| Daily field shows too many data points | Initial deployment junk: first sync batch ran before config loaded logging_frequency | Query cloud to confirm recent days are correct (1/day). DELETE non-midnight entries for the deployment date only. Not a code bug — virtual controller device propagates logging_frequency correctly via `sync.py` lines 487-510. |

## Verification Best Practices

- **Query cloud data pattern FIRST for data density issues**: Before investigating code, check if recent days are correct (1/day for daily, 1/hour for hourly). If recent data is fine but old data has bursts, it's initial deployment junk — cleanup, not a code fix.
- **Prefer Pi SQLite (1s) over cloud for cross-checks**: SQLite has 1s resolution for ALL registers. Cloud is downsampled (5s/60s/600s/3600s). For definitive verification, query SQLite directly.
- **Use temp Python scripts for complex queries**: `cat > /tmp/check.py << 'PYEOF' ... PYEOF && sudo -u volteria python3 /tmp/check.py` — avoids bash escaping issues with multi-table joins.
- **Device ID → name mapping from config**: Always read from `config.json` device list. Never guess DG1/DG2/DG3/DG4 order from device ID strings — the mapping is arbitrary.

## Cross-References

- **Data pipeline issues**: Use `/check-logging` for buffer, sync, and cloud diagnostics
- **Device connectivity**: Use `/check-controller` for Modbus, safe mode, service health
- **Register names/types**: Check device templates in frontend
- **"Calculations causing register failure?"**: No — calculations are read-only SharedState consumers. Data flows one direction: Modbus read → SharedState → calculations. Calculations CANNOT cause register read failures. Check `/check-controller` for Modbus/serial issues instead.
- **"Can backfill corrupt delta values?"**: No — backfill is safe. `on_conflict=ignore-duplicates` prevents overwriting existing cloud readings. Newest-first sync gets correct values first. Fill-gaps phase sends old readings but duplicate timestamps are silently ignored. Delta values are stable within a window (every reading = same value), so no "wrong" reading can be picked.

<!-- Updated: 2026-02-19 - Robust DeltaTracker: 7-day staleness, meter reset handling, non-24/7 support, backfill safety note -->
<!-- Updated: 2026-02-18 - Initial deployment junk data troubleshooting, query cloud data first for density issues, virtual controller device frequency propagation confirmed -->
<!-- Updated: 2026-02-18 - Added note: calculations are read-only consumers, cannot cause register failures -->
<!-- Updated: 2026-02-17 - Added verification best practices (Pi SQLite 1s, temp scripts, device ID mapping), idle vs offline troubleshooting entry -->
