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

| Type | Phase | Description | Example |
|------|-------|-------------|---------|
| `sum` | 1 | Sum register values across devices by register_role | Total Load = sum(load_active_power) |
| `delta` | 2 | Last - first reading over time window, then sum | Daily Energy = sum(kwh_end - kwh_start) |
| `difference` | 2 | One calculated field minus another | DG Power = Load - Solar |
| `cumulative` | 2 | Trapezoidal integration of power over time | Energy from power |
| `average` | 2 | Average across matching devices | Average temperature |
| `max`/`min` | 2 | Peak/minimum across devices | Peak load |

## Register Role Reference

| Role | Device Type | Measurement | Calc Field |
|------|------------|-------------|------------|
| `load_active_power` | load/load_meter | Active power kW | total_load_kw |
| `diesel_generator_active_power` | diesel_generator/dg | Active power kW | total_generator_kw |
| `solar_active_power` | inverter | Active power kW | total_solar_kw |
| `load_kwh_counter` | load/load_meter | Energy counter kWh | (Phase 2: daily_load_energy) |
| `diesel_generator_kwh_counter` | diesel_generator/dg | Energy counter kWh | (Phase 2: daily_dg_energy) |
| `solar_kwh_counter` | inverter | Energy counter kWh | (Phase 2: daily_solar_energy) |

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

### 1a. Verify config has site_calculations

SSH to controller and check config:
```bash
ssh root@159.223.224.203 "sshpass -p 'SECRET' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'python3 -c \"import json; c=json.load(open(\\\"/run/volteria/state/config.json\\\")); print(json.dumps(c.get(\\\"site_calculations\\\", []), indent=2))\"'"
```

Expected: List of calculations with `field_id`, `name`, `register_role`, `type`, `unit`.

If empty: calculated fields not selected on controller device OR config sync hasn't run.

### 1b. Verify controller_device_id

```bash
ssh root@159.223.224.203 "sshpass -p 'SECRET' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'python3 -c \"import json; c=json.load(open(\\\"/run/volteria/state/config.json\\\")); print(c.get(\\\"controller_device_id\\\"))\"'"
```

Expected: UUID of the Site Controller from `site_master_devices`.

### 1c. Verify register_roles on device registers

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

### 1d. Verify virtual controller device in config

Check that a `site_controller` device exists in the devices list (needed for logging whitelist):
```bash
ssh root@159.223.224.203 "sshpass -p 'SECRET' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'python3 -c \"import json; c=json.load(open(\\\"/run/volteria/state/config.json\\\")); [print(json.dumps(d, indent=2)) for d in c.get(\\\"devices\\\", []) if d.get(\\\"device_type\\\") == \\\"site_controller\\\"]\"'"
```

## Step 2: Verify readings.json (zero-lag inline computation)

Site calculations are computed inline in `device_manager.update_shared_state()` using current readings (not via control_state). Verify the controller device appears with calculated values:

```bash
ssh root@159.223.224.203 "sshpass -p 'SECRET' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'python3 -c \"import json; r=json.load(open(\\\"/run/volteria/state/readings.json\\\")); cid=\\\"CONTROLLER_DEVICE_ID\\\"; print(json.dumps(r[\\\"devices\\\"].get(cid, \\\"NOT FOUND\\\"), indent=2))\"'"
```

Expected:
```json
{
  "readings": {
    "Total Load Active Power": {"value": 180.3, "unit": "kW"},
    "Total Generator Active Power": {"value": 95.0, "unit": "kW"}
  }
}
```

If NOT FOUND: device_manager not injecting. Check `controller_device_id` in config (Step 1b) and device service logs: `journalctl -u volteria-device --since "5 min ago" | grep -i "site_calc\|common.site_calc"`.

## Step 3: Check SQLite

```bash
ssh root@159.223.224.203 "sshpass -p 'SECRET' ssh -o StrictHostKeyChecking=no -p SSH_PORT SSH_USER@localhost \
  'sqlite3 /opt/volteria/data/controller.db \"SELECT register_name, value, timestamp FROM device_readings WHERE device_id = \\\"CONTROLLER_DEVICE_ID\\\" ORDER BY id DESC LIMIT 10\"'"
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

## Output Format

**Site Calculations: [HEALTHY / ISSUES FOUND]**

| Check | Status | Details |
|-------|--------|---------|
| Config: site_calculations | OK/Missing | X calculations defined |
| Config: controller_device_id | OK/Missing | UUID present |
| Config: register_roles assigned | OK/Missing | X roles across Y devices |
| Config: virtual controller device | OK/Missing | site_controller in devices list |
| control_state: computed values | OK/Zero/Missing | field values |
| readings.json: controller device | OK/Missing | device injected with readings |
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
| "Calc type not yet implemented" log | Using delta/difference (Phase 2) | Only `sum` implemented in Phase 1 |

## Cross-References

- **Data pipeline issues**: Use `/check-logging` for buffer, sync, and cloud diagnostics
- **Device connectivity**: Use `/check-controller` for Modbus, safe mode, service health
- **Register names/types**: Check device templates in frontend

<!-- Updated: 2026-02-15 - Zero-lag architecture: site calcs computed in device_manager, not control_state -->
