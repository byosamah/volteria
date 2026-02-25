---
name: check-control
description: Check Volteria control algorithm health — load estimation, generator reserve, ramp rate, safe mode, setpoint writes, and Control Status graph data. Use when user says "check control", "control issues", "solar limit wrong", or wants to verify the control pipeline.
---

# Check Control - Volteria Control Algorithm Diagnostic

> Diagnose the control pipeline: load estimation fallback chain, generator reserve, ramp rate, safe mode, inverter write commands, and Control Status dashboard data.

## Trigger Conditions

Activate this skill when:
- Topics: control, solar limit, generator reserve, safe mode, ramp rate, headroom, load source, control status graph, write commands, zero generator feed
- Files touched: `controller/services/control/service.py`, `controller/services/control/algorithm.py`, `controller/services/control/safe_mode.py`, `controller/services/control/state.py`, `controller/services/control/calculated_fields.py`

---

## Control Architecture (7 Layers)

```
L7: SAFE MODE           → full solar shutdown (0%)
L6: EMERGENCY RAMP-DOWN → immediate curtailment
L5: SANITY CHECKS       → NaN, range, impossible values
L4: RAMP RATE LIMITER   → 10%/s up, instant down
L3b: REACTIVE POWER     → PF correction (if enabled, after active power)
L3: SETPOINT CALC       → headroom = load - generator_reserve
L2: LOAD ESTIMATION     → fallback: meters → generators → cached → safe_mode
L1: DATA ACQUISITION    → read SharedState (local, no internet)
```

## Load Estimation Fallback Chain

| Priority | Source | Condition | Accuracy |
|----------|--------|-----------|----------|
| 1 | Load meters | `load_meters_online > 0` and `total_load_kw > 0` | Best |
| 2 | Generator power | `generators_online > 0` and `total_generator_kw > 0` | Good (off-grid: gen = load) |
| 3 | Cached value | `last_known_load < 60s stale` | Degrading |
| 4 | Safe mode | All sources exhausted | N/A (protection) |

## Device Type Sets

Control uses type sets (not single strings):
- **SOLAR_TYPES**: `inverter`, `wind_turbine`, `bess`
- **LOAD_TYPES**: `load_meter`, `load`, `energy_meter`, `subload`
- **DG_TYPES**: `dg`, `diesel_generator`, `diesel_generator_controller`
- **GG_TYPES**: `gas_generator_controller`, `gas_generator`
- **GENERATOR_TYPES**: DG_TYPES | GG_TYPES (union of both)

Control state tracks three power fields:
- `dg_power_kw`: Diesel generators only
- `gg_power_kw`: Gas generators only
- `generator_power_kw`: Total (DG + GG) — used by control algorithm for headroom calculation

---

## Step 0: Identify Controller

If no controller specified, query deployed controllers:

```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/controllers?select=id,serial_number,site_id,ssh_port,ssh_username,ssh_password,status&is_active=eq.true" \
  -H "apikey: SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

- If 1 controller: use it
- If multiple: ask user which one
- Store: `CONTROLLER_ID`, `SITE_ID`, `SSH_PORT`, `SSH_USER`, `SSH_PASSWORD`

SSH pattern (Windows → DO → Pi):
```bash
/c/Windows/System32/OpenSSH/ssh.exe -i "C:/Users/Hp/.ssh/volteria-deploy" root@159.223.224.203 "sshpass -p 'SSH_PASSWORD' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p SSH_PORT SSH_USER@localhost 'COMMAND'"
```

---

## Step 1: Config Match (DB vs Controller)

**Cloud side** — get site settings:
```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/sites?id=eq.SITE_ID&select=operation_mode,dg_reserve_kw,control_interval_ms,safe_mode_enabled,safe_mode_type,safe_mode_timeout_s,grid_connection,config_mode" \
  -H "apikey: SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

**Controller side** — get config.json:
```bash
# SSH command:
cat /run/volteria/state/config.json | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(json.dumps({
    'operation_mode': d.get('operation_mode'),
    'dg_reserve_kw': d.get('dg_reserve_kw'),
    'mode_settings': d.get('mode_settings', {}),
    'control_interval_ms': d.get('control_interval_ms'),
    'safe_mode': d.get('safe_mode', {}),
    'grid_connection': d.get('grid_connection'),
    'config_mode': d.get('config_mode'),
}, indent=2))
"
```

**Expected**: DB values == controller config values. Key check: `dg_reserve_kw` in config matches DB.

| Check | Healthy | Warning |
|-------|---------|---------|
| operation_mode match | DB == controller | Mismatch (sync needed) |
| dg_reserve_kw match | DB == controller | Mismatch (known bug if mode_settings only) |
| control_interval_ms match | DB == controller | Mismatch |
| safe_mode settings match | All fields match | Any mismatch |

---

## Step 2: Device Type Matching

**Controller side** — check control_state:
```bash
cat /run/volteria/state/control_state.json | python3 -c "
import sys,json; d=json.load(sys.stdin)
print('load_meters_online:', d.get('load_meters_online'))
print('generators_online:', d.get('generators_online'))
print('inverters_online:', d.get('inverters_online'))
print('load_source:', d.get('load_source'))
"
```

**Compare with device service readings**:
```bash
cat /run/volteria/state/readings.json | python3 -c "
import sys,json; d=json.load(sys.stdin)
status = d.get('status', {})
online = sum(1 for s in status.values() if s.get('is_online'))
print(f'Total devices online: {online}')
for did, s in status.items():
    print(f'  {did[:8]}: online={s.get(\"is_online\")}')
"
```

**Expected**: control_state online counts should match device service online counts by type.

| Check | Healthy | Critical |
|-------|---------|----------|
| load_meters_online | > 0 (or no meters configured) | 0 when meters exist + online in readings |
| generators_online | > 0 (or no gens configured) | 0 when gens exist + online in readings |
| Type mismatch | Counts match device service | Counts = 0 while devices online (legacy string bug) |

---

## Step 3: Control State Health

```bash
cat /run/volteria/state/control_state.json | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(json.dumps(d, indent=2))
"
```

| Field | Healthy | Warning | Critical |
|-------|---------|---------|----------|
| total_load_kw | > 0 | 0 (no load detected) | Negative (impossible in off-grid) |
| load_source | `load_meter` | `generator_fallback` or `cached` | `safe_mode` or `none` |
| dg_reserve_kw | Matches DB setting | Different from DB | 0 when should be non-zero |
| available_headroom_kw | > 0 | 0 or negative (solar = 0%) | N/A |
| solar_limit_pct | 0-100 dynamic | Stuck at 0% or 100% > 5min | N/A |
| execution_time_ms | < 100 | 100-500 | > 500 (system overloaded) |
| ramp_limited | Occasionally true | Always true (oscillating) | N/A |
| write_success | true | false (investigate) | false + write_error |

---

## Step 4: Ramp Rate

Check if ramp rate is causing issues:
```bash
# Watch control_state for 10 seconds
for i in $(seq 1 10); do
  cat /run/volteria/state/control_state.json | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f\"limit={d.get('solar_limit_pct',0):.1f}% ramp={d.get('ramp_limited',False)} load={d.get('total_load_kw',0):.1f}kW src={d.get('load_source','?')}\")
"
  sleep 1
done
```

**Expected**: `solar_limit_pct` should track load changes smoothly. `ramp_limited=true` during ramp-up is normal.

Constants: `MAX_RAMP_UP_PCT_PER_SEC = 10.0` (10 seconds 0→100%), `MAX_RAMP_DOWN_PCT_PER_SEC = 100.0` (instant curtailment).

---

## Step 5: Safe Mode

```bash
cat /run/volteria/state/safe_mode_state.json 2>/dev/null || echo "No safe mode state"
cat /run/volteria/state/safe_mode_trigger.json 2>/dev/null || echo "No external trigger"
```

| Check | Healthy | Warning |
|-------|---------|---------|
| safe_mode_active | false | true (check reason) |
| safe_mode_reason | null | Any value (investigate) |
| External trigger | File absent | File present with triggered=true |

Safe mode reasons:
- "Device offline for Xs" — device communication failure
- "High reverse risk: solar X% of load, device offline" — rolling average threshold
- "No reliable load data (all sources exhausted)" — load fallback chain failed
- "External trigger" — supervisor triggered (service crash)

---

## Step 6: Write Commands Queue

```bash
cat /run/volteria/state/write_commands.json 2>/dev/null | python3 -c "
import sys,json; d=json.load(sys.stdin)
cmds = d.get('commands', [])
print(f'Pending commands: {len(cmds)}')
for c in cmds[-5:]:
    print(f'  {c.get(\"command\")} → {c.get(\"device_id\",\"?\")[:8]} val={c.get(\"value\")} at {c.get(\"timestamp\",\"?\")[-8:]}')
" 2>/dev/null || echo "No write commands file"
```

| Check | Healthy | Warning | Critical |
|-------|---------|---------|----------|
| Pending commands | 0-2 | 3-10 (slow consumption) | > 10 (device service not consuming) |
| Command age | < 5s | 5-30s | > 30s (stuck) |

---

## Step 7: Control Logs (Cloud)

Check if control data is flowing to cloud (for Control Status graph):
```bash
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/control_logs?site_id=eq.SITE_ID&select=timestamp,solar_limit_pct,total_load_kw,load_source&order=timestamp.desc&limit=5" \
  -H "apikey: SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

| Check | Healthy | Warning |
|-------|---------|---------|
| Recent logs | Within last 5 min | No logs or > 10 min old |
| load_source | Populated | Missing (old controller code) |

---

## Step 8: Service Health

```bash
systemctl status volteria-control --no-pager
journalctl -u volteria-control --no-pager -n 20 --since "5 minutes ago"
```

Look for:
- `Config loaded: N devices` — verify device count
- `Config change detected` — recent hot-reload
- `ZeroGenFeed:` — algorithm debug output
- `Safe mode TRIGGERED` — safe mode events
- Any ERROR lines

---

## Output Format

```
**Control Health: [HEALTHY / ISSUES FOUND]**

| Check | Status | Details |
|-------|--------|---------|
| Config match | OK/Warning | DB vs controller values |
| Device types | OK/Critical | Online counts match |
| Load estimation | OK/Warning | Source: load_meter/generator_fallback/cached/safe_mode |
| Generator reserve | OK/Critical | DB=X, Controller=Y |
| Solar limit | OK/Warning | Current: X%, headroom: Y kW |
| Ramp rate | OK/Warning | Normal / oscillating |
| Safe mode | OK/Warning | Active: yes/no, reason |
| Write commands | OK/Critical | Pending: N |
| Control logs | OK/Warning | Flowing / stale |
| Service health | OK/Critical | Running / errors |
```

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| All online counts = 0 | Legacy device type strings | Update `calculated_fields.py` type sets |
| dg_reserve wrong on controller | mode_settings conditionally populated | Read from top-level `config.dg_reserve_kw` |
| Solar stuck at 0% | load < reserve, or safe mode | Check headroom = load - reserve |
| Solar stuck at 100% | No inverters configured | Expected — nothing to limit |
| No control data on dashboard | control_state not logged to cloud | Check logging service + control_logs table |
| load_source = "none" | No devices online, no cache | All sources failed — check device service |
| Ramp always limited | Setpoint oscillating fast | Check load stability, increase reserve |
| Write commands piling up | Device service not consuming | Check volteria-device service health |
| New config block empty `{}` | Config service hasn't re-synced | Restart `volteria-config` to force re-sync |
| Reactive power kvar = 0 | Feature disabled or no load meters | Check `reactive_power_enabled` in config + load meter reactive power registers |

---

## Simulation (Testing Algorithm with Fake Devices)

To test the algorithm with different inverter capacities without real hardware:

1. **Add fake inverter** to `site_devices`:
```bash
curl -s -X POST "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/site_devices" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"site_id": "SITE_ID", "name": "Test Inverter", "device_type": "inverter", "rated_power_kw": 100, "enabled": true, "protocol": "tcp", "ip_address": "192.168.1.99", "port": 502, "slave_id": 1}'
```

2. **Trigger config sync** → wait ~20s → check `control_state.json`
3. **Modify** `rated_power_kw` (PATCH) → sync → verify `solar_limit_pct` changes
4. **Clean up**: DELETE the test device → sync → verify `solar_capacity_kw` back to 0

**Expected results** (with load ~650 kW, reserve 100 kW, headroom ~550 kW):
- 100 kW capacity → limit 100% (headroom > capacity)
- 1000 kW capacity → limit ~55% (headroom < capacity)
- 2000 kW capacity → limit ~27% (headroom << capacity)

---

## Cross-References

- `/check-controller` — Service health, SSH, config sync
- `/check-logging` — Data flow, SQLite, cloud sync
- `/check-alarms` — Safe mode alarms, threshold alarms
- `/check-calculations` — Site-level totals (register_role)

<!-- Updated: 2026-02-25 (added L3b reactive power layer, troubleshooting entries) -->
