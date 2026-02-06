---
name: check-controller
description: Check Volteria controller architecture, services, SSH access, config sync, safe mode, and live readings. Use when debugging controller issues, understanding service flow, or checking data path.
---

# Check Controller - Volteria Controller Architecture Reference

> Master reference for the 5-layer controller: supervisor, services, SharedState, SSH tunnels, safe mode, and diagnostics.

## Trigger Conditions

Activate this skill when:
- Files touched: `controller/supervisor.py`, `controller/main_v2.py`, `controller/services/system/*`, `controller/services/config/*`, `controller/services/device/*`, `controller/services/control/*`, `controller/common/*`
- Topics: controller services, heartbeat, safe mode, modbus, SSH tunnel, device polling, control loop, operation mode, supervisor, service health, connection pool, SharedState, config sync, live readings, data flow, frontend polling, historical data

---

## 0. Quick Commands

**Identify controller** (always do this first):
```sql
SELECT id, serial_number, ssh_port, ssh_username, ssh_password, hardware_type_id
FROM controllers WHERE serial_number = 'SERIAL_HERE';
```

**SSH access** (from Windows, through DO gateway):
```bash
ssh root@159.223.224.203 "sshpass -p '<ssh_password>' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p <ssh_port> <ssh_username>@localhost '<command>'"
```

**Service status** (run on Pi):
```bash
systemctl is-active volteria-system volteria-config volteria-device volteria-control volteria-logging
```

**SOL532-E16 extra services**:
```bash
systemctl is-active volteria-ups-monitor volteria-watchdog
```

**Health endpoints** (run on Pi — check ALL 5, don't skip any):
```bash
curl http://127.0.0.1:8081/health | python3 -m json.tool  # System
curl http://127.0.0.1:8082/health | python3 -m json.tool  # Config ← often skipped, verify!
curl http://127.0.0.1:8083/health | python3 -m json.tool  # Device
curl http://127.0.0.1:8084/health | python3 -m json.tool  # Control
curl http://127.0.0.1:8085/health | python3 -m json.tool  # Logging
```

**SharedState** (run on Pi — check tmpfs first, fallback to disk):
```bash
# Production (tmpfs):
cat /run/volteria/state/readings.json | python3 -m json.tool
cat /run/volteria/state/control_state.json | python3 -m json.tool
cat /run/volteria/state/config.json | python3 -m json.tool | head -50
# Fallback (disk): /opt/volteria/data/state/
```

**Logs** (run on Pi):
```bash
journalctl -u volteria-control --since "1 hour ago" | grep -i error
journalctl -u volteria-device -f   # Live tail
```

**SSH tunnel** (run on Pi):
```bash
systemctl status volteria-tunnel
```

**SQLite pending** (run on Pi):
```bash
sqlite3 /opt/volteria/data/controller.db "SELECT COUNT(*) FROM device_readings WHERE synced_at IS NULL"
```

---

## 1. Architecture Reference

### 5-Layer Service Architecture

```
Supervisor (main_v2.py → supervisor.py)
    ↓ spawns 5 subprocesses in order
┌──────────────────────────────────────────────────────────┐
│  Layer 5: LOGGING (8085)  - Data logging, cloud sync     │
├──────────────────────────────────────────────────────────┤
│  Layer 4: CONTROL (8084)  - Zero-feeding algorithm       │
├──────────────────────────────────────────────────────────┤
│  Layer 3: DEVICE  (8083)  - Modbus I/O, polling          │
├──────────────────────────────────────────────────────────┤
│  Layer 2: CONFIG  (8082)  - Cloud sync, caching          │
├──────────────────────────────────────────────────────────┤
│  Layer 1: SYSTEM  (8081)  - Heartbeat, OTA, health       │
└──────────────────────────────────────────────────────────┘
    ↕ SharedState (file-based IPC, atomic writes)
```

### Service Definitions (supervisor.py :29-35)

| Service | Port | Critical | Module | Purpose |
|---------|------|----------|--------|---------|
| system | 8081 | Yes | `services.system.service` | Heartbeat, OTA, health |
| config | 8082 | Yes | `services.config.service` | Cloud sync, caching |
| device | 8083 | Yes | `services.device.service` | Modbus I/O, polling |
| control | 8084 | Yes | `services.control.service` | Zero-feeding algorithm |
| logging | 8085 | **No** | `services.logging.service` | Data logging, cloud sync |

### Supervisor Constants (supervisor.py :38-41)

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_RESTART_ATTEMPTS` | 3 | Max retries before safe mode |
| `RESTART_COOLDOWN_S` | 10 | Delay between restart attempts |
| `HEALTH_CHECK_INTERVAL_S` | 10 | Monitor loop frequency |
| `STARTUP_TIMEOUT_S` | 30 | Wait for service healthy |

### Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `supervisor.py` | 434 | Service orchestration |
| `main_v2.py` | 270 | Entry point, config load |
| `services/system/service.py` | - | Heartbeat, health, OTA |
| `services/system/heartbeat.py` | - | 30s heartbeat sender |
| `services/system/health_monitor.py` | - | Service health tracking |
| `services/system/ota_updater.py` | - | Firmware updates |
| `services/config/service.py` | - | Config sync (hourly) |
| `services/config/sync.py` | - | Fetch site config |
| `services/device/service.py` | - | Device management |
| `services/device/connection_pool.py` | - | Modbus TCP + serial connection reuse |
| `services/device/modbus_client.py` | - | ModbusTcpClient + ModbusSerialClient |
| `services/device/register_reader.py` | - | Register polling |
| `services/device/register_writer.py` | - | Inverter writes |
| `services/device/device_manager.py` | - | Online/offline tracking |
| `services/control/service.py` | - | Control loop (1000ms) |
| `services/control/algorithm.py` | - | Operation mode calcs |
| `services/control/safe_mode.py` | - | Safe mode handler |
| `services/logging/service.py` | 1415 | Logging orchestration |
| `services/logging/local_db.py` | 549 | SQLite storage |
| `services/logging/cloud_sync.py` | 532 | Supabase upload |
| `services/logging/alarm_evaluator.py` | 218 | Threshold checking |
| `common/state.py` | - | SharedState atomic I/O |
| `common/config.py` | - | Config parser |
| `common/scheduler.py` | 225 | Precise timing loops |

### Function Map

**supervisor.py (Supervisor)**:
- `start()` :183 - Start supervisor + all services
- `_start_all_services()` :219 - Layer-by-layer startup (2s gaps)
- `_stop_all_services()` :246 - Reverse-order graceful stop
- `_monitor_loop()` :266 - Health check every 10s
- `_handle_service_failure()` :299 - Restart policy (3x max)
- `_trigger_safe_mode()` :339 - Write safe_mode_override.json

**main_v2.py**:
- `load_config()` :37 - Load YAML config
- `validate_config()` :61 - Validate controller.id + cloud credentials
- `main_async()` :155 - Write config to SharedState, start Supervisor

---

## 2. SharedState Communication

File-based IPC with atomic writes (`common/state.py`).

### Write Pattern
```python
# 1. Write to .tmp file
# 2. fsync() to disk
# 3. Atomic rename (filesystem guarantees)
```

### Cache
- 100ms TTL in-memory (`_cache_ttl = 0.1`)
- Reduces disk I/O on frequent reads

### State Files

| File | Writer | Readers | Content |
|------|--------|---------|---------|
| `readings.json` | device | control, logging | Per-register values |
| `config.json` | config | device, control, logging, register_cli | Site configuration |
| `control_state.json` | control | logging, system | Algorithm output |
| `service_health.json` | all | system | Health status |
| `safe_mode_override.json` | supervisor | control | Safe mode trigger |
| `controller_config.json` | main_v2 | all | Boot config from YAML |
| `config_status.json` | config | device, control, logging | Change notification |

### Path Resolution (tmpfs vs disk)

**CRITICAL**: Scripts executed via SSH (outside systemd) don't have `VOLTERIA_STATE_DIR` env var.

`common/state.py` resolves STATE_DIR as follows:
1. If `VOLTERIA_STATE_DIR` env var set → use it (systemd services)
2. Else if Windows → `controller/data/state/` (development)
3. Else if `/run/volteria/state` exists → use tmpfs (production, preferred)
4. Else → `/opt/volteria/data/state/` (fallback disk)

**All config readers must use `get_config()` from `common.state`** — never hardcode paths. This ensures:
- Services (systemd) read from tmpfs via env var
- SSH scripts (register_cli.py) read from tmpfs via existence check
- User changes IP in UI → config syncs → all readers see new settings automatically

### Config Change Notification
1. Config service writes new config + `config_status.json` with new version
2. Other services detect change via `is_config_changed()`
3. Each service acknowledges: `acknowledge_config_change(service_name)`
4. Required acknowledgers: `{"device", "control", "logging"}`

---

## 3. Config Sync Process

### Timing & Triggers

| Trigger | Interval | Source |
|---------|----------|--------|
| Periodic sync | 3600s (hourly) | `service.py:36` `SYNC_INTERVAL_SECONDS` |
| Command poll | 5s | `service.py:422` `_command_poll_loop()` |
| Manual sync | On demand | `POST /sync` on port 8082 (`service.py:591`) |
| Cloud command | On demand | `sync_config` in `control_commands` table |

### What Gets Synced (service.py :178-194)

Config service fetches from Supabase and extracts **meaningful fields** for change detection:
- `devices` (all device configs)
- `calculated_fields`
- `site_level_alarms` + `alarm_overrides`
- `logging` settings (frequencies)
- `safe_mode` settings
- `dg_reserve_kw`, `operation_mode`, `control_interval_ms`

### Change Detection (MD5 Hash)

```
Fetch cloud config → Extract meaningful fields
    → JSON serialize (sorted keys) → MD5 hash
    → Compare with previous hash
    → If different: write config + notify services
    → If same: skip (no unnecessary reloads)
```

- Uses `hashlib.md5()` with consistent JSON ordering (`service.py:193`)
- Logs hash preview (first 8 chars) when change detected (`service.py:200`)
- Ignores timestamp-only changes (e.g., `updated_at` on device status updates)

### Local Cache

| Path | Purpose |
|------|---------|
| `/opt/volteria/data/state/config.json` | SharedState (atomic write, 100ms TTL) |
| `/opt/volteria/data/config_history/` | Versioned history |
| `v_<timestamp>.json` | Individual version files |

- **Retention**: Last 5 versions (`cache.py:34`, `max_versions=5`)
- **Rollback**: Can revert to previous versions (`cache.py:147-173`)

### Hot-Reload Flow

```
Config service writes config.json + config_status.json (new version)
    ↓
Services detect change via is_config_changed() (hash comparison)
    ↓
Each service reloads config and acknowledges
    ↓
Required acknowledgers: {"device", "control", "logging"}
    ↓
Config clears changed flag when all 3 acknowledge
```

- Notification: `state.py:285` `notify_config_changed(version)`
- Acknowledgment: `state.py:255` `acknowledge_config_change(service_name)`
- Device service: clears stale reading buffers on reload (renamed registers get fresh poll keys)

### Offline Operation

- **Startup**: Loads cached config before attempting cloud sync (`service.py:217-218`)
- **Cache load order**: SharedState first → latest version file fallback (`cache.py:77-101`)
- **Full operation**: All 5 services run normally with cached config (control loop, Modbus polling, logging)
- **Cloud unavailable**: Service continues with last-known config, retries on next interval

### Diagnostic Commands

```bash
# Check current config version & last sync
cat /opt/volteria/data/state/config_status.json | python3 -m json.tool

# Check config content (truncated)
cat /opt/volteria/data/state/config.json | python3 -m json.tool | head -80

# Check config history versions
ls -la /opt/volteria/data/config_history/

# Force immediate sync
curl -X POST http://127.0.0.1:8082/sync

# Check config service health
curl http://127.0.0.1:8082/health | python3 -m json.tool

# Check for sync errors in logs
journalctl -u volteria-config --since "1 hour ago" | grep -iE "error|hash|changed"
```

### Config Synced Feedback (service.py :394-420)

After successful sync, updates cloud:
- `sites.config_synced_at` — timestamp of last successful sync
- `sites.controller_config_version` — current config version hash

---

## 4. SSH Tunnel Architecture

### Reverse SSH Tunnel
```
Raspberry Pi ──outbound SSH──> DigitalOcean (159.223.224.203)
                                    ↕
                               Port XXXX:localhost:22
```

### Systemd Service (`volteria-tunnel.service`)
- Binary: `/usr/bin/sshpass` + `/usr/bin/ssh`
- User: `volteria`
- Password: `VoltTunnel@2026`
- Params: `ServerAliveInterval 30`, `ServerAliveCountMax 3`, `ExitOnForwardFailure yes`
- Restart: always, 10s delay

### Credential Lookup
```sql
SELECT id, serial_number, ssh_port, ssh_username, ssh_password
FROM controllers WHERE serial_number = 'SERIAL';
```

### SSH Access Pattern (from Windows)
```bash
ssh root@159.223.224.203 "sshpass -p '<ssh_password>' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p <ssh_port> <ssh_username>@localhost '<command>'"
```

---

## 5. Safe Mode

> **Note**: Safe mode and control_state features are still in development. Skip these during diagnostics unless specifically requested.

### Triggers
1. **Supervisor** (supervisor.py :334-337): Critical service fails 3x restart attempts
2. **Time-based**: Device offline > `timeout_s` seconds
3. **Rolling average**: Solar > `threshold_pct`% of load AND device offline > timeout

### Behavior
- Writes `safe_mode_override.json`: `{active: true, reason, triggered_at, triggered_by}`
- Control service reads this → defaults to safe power limit (0%)
- Alert sent via heartbeat (`safe_mode_active: true`)
- **Recovery**: Manual only (no auto-recovery from supervisor-triggered safe mode)

### Settings (from site config)
- `safe_mode_type`: `time_based` or `rolling_average`
- `safe_mode_timeout_s`: Device offline threshold
- `safe_mode_rolling_window_min`: Window for average calculation
- `safe_mode_threshold_pct`: Solar danger threshold (default 80%)
- `safe_mode_power_limit_kw`: Safe limit when triggered

---

## 6. Operation Modes

| Mode | Key Settings | Description |
|------|-------------|-------------|
| `zero_dg_reverse` | `dg_reserve_kw` | Prevent DG reverse feeding |
| `zero_dg_pf` | `dg_reserve_kw`, `target_power_factor` | + power factor control |
| `zero_dg_reactive` | `dg_reserve_kw`, `max_reactive_kvar` | + reactive power limit |
| `peak_shaving` | `peak_threshold_kw`, `battery_reserve_pct` | Battery + peak shaving |

### Config Modes (device availability)
- `meter_inverter`: Load meters + inverters only
- `dg_inverter`: DG controllers + inverters only
- `full_system`: All device types present

### Core Algorithm
```python
load = sum(load_meter_readings)
available_headroom = load - dg_reserve_kw
solar_limit = max(0, min(available_headroom, total_inverter_capacity))
solar_limit_pct = (solar_limit / capacity) * 100
# Write to inverter register 5008
```

---

## 7. Deployment/Update Flow

### Remote Update
```
POST /api/controllers/{id}/update
    → Backend validates controller_secret
    → SSH to controller: git pull + systemctl restart volteria-*
```

### Git Pull Permission Errors
If `git pull` fails with permission errors, check ownership first:
```bash
# Fix .git ownership (common issue: some files owned by root)
sudo chown -R voltadmin:voltadmin /opt/volteria/.git

# Then pull normally
cd /opt/volteria && git fetch origin main && git pull origin main
```

If permission issues persist (e.g., `.claude` directory), update specific files only:
```bash
cd /opt/volteria && git fetch origin main && git checkout origin/main -- controller/services/config/sync.py
```
This bypasses problematic directories while updating the needed file.

### Reboot (Double Confirmation in UI)
```
POST /api/controllers/{id}/reboot
    → SSH: sudo reboot
    → Systemd auto-starts services on boot
```

### OTA Flow
check hourly → download → verify SHA256 → wait approval → apply → verify health → rollback if unhealthy

---

## 8. Validation Rules

| Rule | Why |
|------|-----|
| Start order: system→config→device→control→logging | Dependency chain |
| 2s delay between service starts (supervisor.py :233,244) | Race condition prevention |
| Critical service failure = safe mode | Prevent reverse feeding without control |
| Logging is non-critical | Data loss acceptable, reverse feeding not |
| Stale readings deleted on device failure | Prevent stale data logged as current |
| Poll states cleared on config reload | Renamed registers get fresh poll keys |
| Config fetched fresh each sync cycle | No stale frequency/mode data |
| SharedState atomic writes | Readers never see partial data |
| Health check timeout: 5s (supervisor.py :129) | Prevent blocking monitor loop |
| Max 3 restart attempts | Prevent infinite restart loops |
| DG reserve minimum: 0 kW | Never negative |
| Write verification: 200ms delay + 1% tolerance | Confirm inverter accepted command |
| Connection pool idle timeout: 300s | Cleanup stale Modbus connections |
| SQLite calls via `_run_db()` in thread pool | Never block asyncio event loop |
| Orphan alarms auto-resolved on config change | Prevents stale alarms when registers removed |
| Alarm condition in separate column | Never embed condition in message field |
| RTU Direct: asyncio.Lock per serial port | Prevent bus contention on RS-485 |
| SOL532-E16: watchdog feed every 30s | System reboots if service hangs >60s |
| SOL532-E16: UPS monitor on GPIO16 | Graceful shutdown on power loss |
| Config readers use `get_config()` | Never hardcode paths — tmpfs/disk resolution varies by context |
| SSH scripts prefer tmpfs over disk | `common/state.py` checks tmpfs existence when env var not set |
| All services need `/run/volteria` in `ReadWritePaths` | `ProtectSystem=strict` blocks tmpfs writes without it |

---

## 9. Diagnostic Protocol

### Step-by-Step Workflow

1. **Check heartbeat** (is controller online?):
   ```sql
   SELECT timestamp FROM controller_heartbeats
   WHERE controller_id = 'UUID' ORDER BY timestamp DESC LIMIT 1;
   ```

2. **SSH to controller** and check services:
   ```bash
   systemctl is-active volteria-system volteria-config volteria-device volteria-control volteria-logging
   ```

3. **Check health endpoints**:
   ```bash
   for port in 8081 8082 8083 8084 8085; do
     echo "Port $port: $(curl -s http://127.0.0.1:$port/health | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status","error"))')";
   done
   ```

4. **Check SharedState** (are readings flowing?):
   ```bash
   cat /opt/volteria/data/state/readings.json | python3 -m json.tool
   ```

5. **Check service logs** (errors in last hour):
   ```bash
   journalctl -u volteria-system --since "1 hour ago" | grep -iE "error|critical|fail"
   journalctl -u volteria-config --since "1 hour ago" | grep -iE "error|critical|fail"
   journalctl -u volteria-device --since "1 hour ago" | grep -iE "error|critical|fail"
   journalctl -u volteria-control --since "1 hour ago" | grep -iE "error|critical|fail"
   journalctl -u volteria-logging --since "1 hour ago" | grep -iE "error|critical|fail"
   ```

6. **Live tail** (follow one service):
   ```bash
   journalctl -u volteria-control -f
   journalctl -u volteria-device -f
   ```

7. **Check SSH tunnel**:
   ```bash
   systemctl status volteria-tunnel
   journalctl -u volteria-tunnel --since "10 min ago"
   ```

8. **Check SQLite backlog** (prefer HTTP endpoint — sqlite3 CLI often fails with exit code 8 "database locked" while logging service runs):
   ```bash
   # PREFERRED: Use logging stats endpoint (always works, no lock contention)
   curl -s http://127.0.0.1:8085/stats | python3 -c "import json,sys; d=json.load(sys.stdin)['database']; print(f'Unsynced readings: {d[\"unsynced_device_readings\"]}, Unsynced alarms: {d[\"unsynced_alarms\"]}, DB size: {d[\"db_size_bytes\"]/1024/1024:.0f} MB')"
   # FALLBACK: Direct sqlite3 (may fail with exit code 8)
   sqlite3 /opt/volteria/data/controller.db "SELECT COUNT(*) FROM device_readings WHERE synced_at IS NULL"
   sqlite3 /opt/volteria/data/controller.db "SELECT COUNT(*) FROM alarms WHERE synced_at IS NULL"
   ```

9. **Check safe mode state**:
   ```bash
   cat /opt/volteria/data/state/safe_mode_override.json 2>/dev/null || echo "No safe mode file"
   ```

10. **Check system resources**:
    ```bash
    df -h /opt/volteria/data/          # Disk usage
    free -m                             # Memory
    uptime                              # Load average
    cat /sys/class/thermal/thermal_zone0/temp  # CPU temp (millidegrees)
    ```

11. **Check network/DNS**:
    ```bash
    getent hosts google.com             # DNS working? (always available)
    curl -s -o /dev/null -w "%{http_code}" https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/  # Cloud reachable?
    nmcli con show --active             # Active network connections
    ```

12. **Check config version**:
    ```bash
    cat /opt/volteria/data/state/config_status.json | python3 -m json.tool
    cat /etc/volteria/config.yaml | head -20
    ```

13. **Logging service detailed stats**:
    ```bash
    curl -s http://127.0.0.1:8085/stats | python3 -m json.tool
    curl -s http://127.0.0.1:8085/debug | python3 -m json.tool
    ```

14. **Recent boot logs** (after restart/reboot):
    ```bash
    journalctl -b -u volteria-system --no-pager | head -50
    ```

15. **Compare service ReadWritePaths** (for permission errors like "Read-only file system"):
    ```bash
    grep -h ReadWritePaths /etc/systemd/system/volteria-*.service
    # All services should have /run/volteria - if one is missing, that's the bug
    ```

16. **Clear old logs after fix** (for clean verification):
    ```bash
    sudo journalctl --rotate && sudo journalctl --vacuum-time=1s
    # Then monitor for new issues with a clean slate
    ```

### Common Issues

| Symptom | Check | Fix |
|---------|-------|-----|
| All services down | SSH tunnel first | Restart tunnel, check network |
| Control unhealthy | readings.json empty | Check device service / Modbus gateway |
| Config not syncing | Supabase connectivity | `curl https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/` from Pi |
| Safe mode active | `cat safe_mode_override.json` | Identify failed service, manual restart |
| Device offline | Modbus connectivity | Check gateway IP, slave ID, cable |
| Readings not syncing | SQLite pending count | Check cloud_sync errors in logging logs |
| High drift alarms | `curl :8085/stats` | Check SD card I/O, CPU load |
| SQLite CLI locked (exit code 8) | Logging service holds DB | Use `curl :8085/stats` for unsynced counts, DB size instead |
| Repeated "Resolved alarm" log spam | Auto-resolve guard `>= N` fires every cycle | Should use `== N` to fire once on transition (fixed 2026-02-06) |
| Live Registers "not reporting" | Compare tmpfs vs disk config IPs | Ensure `register_cli.py` uses `get_config()` from SharedState |
| High CPU + restart loop | `journalctl -u volteria-supervisor` for "Read-only file system" | Update service file: add `/run/volteria` to `ReadWritePaths` |

### SOL532-E16 Specific Issues

| Symptom | Check | Fix |
|---------|-------|-----|
| RTU Direct device offline | `lsof /dev/ttyACMX` | Check serial port access, permissions |
| Serial timeouts | `mbpoll` manual test | Verify baudrate, parity, slave ID |
| UPS monitor not running | `systemctl status volteria-ups-monitor` | Check gpiod, GPIO16 access |
| Watchdog not running | `systemctl status volteria-watchdog` | Check /dev/watchdog exists |
| 4G not connecting | `mmcli -m 0 --simple-status` | Check SIM, APN config |
| Auto-reboot loops | Watchdog timeout | Check service health, increase timeout |

---

## 10. Observability Metrics

### Per-Service
- **System**: `_consecutive_heartbeat_failures` (max 5 → critical)
- **Config**: `_sync_interval_s` (3600), `_last_sync_time`
- **Device**: `_connections` count, per-device `consecutive_failures` (offline at 3)
- **Control**: `_control_interval_ms` (1000), `execution_time_ms` per loop
- **Logging**: `_sample_drift_ms`, `_flush_drift_ms`, `_buffer_peak_24h`, `_cloud_error_count`

### Logging Service Endpoints
| Endpoint | Returns |
|----------|---------|
| `GET :8085/stats` | Buffer stats, timing, scheduler metrics, error counts |
| `GET :8085/debug` | Register frequencies, downsample results, diagnostics |

---

## 11. Raspberry Pi File Paths

| Path | Purpose |
|------|---------|
| `/opt/volteria/` | Installation root |
| `/opt/volteria/controller/` | Python source (git repo) |
| `/opt/volteria/data/` | SQLite DB + persistent data |
| `/opt/volteria/data/state/` | SharedState JSON (fallback) |
| `/run/volteria/state/` | SharedState JSON (tmpfs, production) |
| `/opt/volteria/venv/` | Python virtualenv |
| `/opt/volteria/updates/` | OTA staging area |
| `/opt/volteria/backup/` | Pre-update backups |
| `/etc/volteria/config.yaml` | Controller configuration |
| `/etc/volteria/env` | Environment variables |
| `/var/log/volteria/` | Log files |

### SOL532-E16 Specific Paths

| Path | Purpose |
|------|---------|
| `/dev/ttyACM0` | RS-232 serial port |
| `/dev/ttyACM1-3` | RS-485 serial ports (3 ports) |
| `/dev/watchdog` | Hardware watchdog device |
| `/sys/class/gpio/gpio16/value` | UPS power status (1=OK, 0=loss) |
| `/etc/udev/rules.d/99-volteria-serial.rules` | Serial port permissions |
| `/opt/volteria/controller/scripts/ups-monitor.py` | UPS monitor script |
| `/opt/volteria/controller/scripts/watchdog-feeder.sh` | Watchdog feeder script |

---

## 12. SOL532-E16 (R2000) Specifics

### Extra Services
| Service | Port | Purpose |
|---------|------|---------|
| volteria-ups-monitor | N/A | GPIO16 power loss detection → graceful shutdown |
| volteria-watchdog | N/A | Hardware watchdog feeder (60s timeout) |

### RTU Direct Protocol (Serial Modbus)
SOL532-E16 supports direct RS-485/RS-232 connections without gateway.

**Serial Port Paths**:
| Port | Device | Purpose |
|------|--------|---------|
| `/dev/ttyACM0` | RS-232 | Legacy serial devices |
| `/dev/ttyACM1` | RS-485 #1 | Modbus RTU devices |
| `/dev/ttyACM2` | RS-485 #2 | Modbus RTU devices |
| `/dev/ttyACM3` | RS-485 #3 | Modbus RTU devices |

**Connection Pool Keys**: `(port, baudrate)` → one asyncio.Lock per serial port

**RTU Direct Device Config**:
```yaml
devices:
  load_meters:
    - name: "Load Meter 1"
      template: "meatrol_me431"
      protocol: "rtu_direct"
      serial_port: "/dev/ttyACM1"
      baudrate: 9600
      parity: "N"
      stopbits: 1
      slave_id: 1
```

### RTU Direct Diagnostics

```bash
# Check serial port access
ls -la /dev/ttyACM*
groups volteria  # Should include dialout

# Check for device contention (only one process should access each port)
lsof /dev/ttyACM1

# Test Modbus connectivity manually (install mbpoll if needed)
mbpoll -a 1 -b 9600 -P none -t 3 -r 1 -c 5 /dev/ttyACM1

# Check device service for serial errors
journalctl -u volteria-device --since "10 min ago" | grep -iE "serial|ttyACM|timeout"
```

### RTU Direct Common Issues

| Issue | Check | Fix |
|-------|-------|-----|
| Permission denied on /dev/ttyACM* | `groups volteria` | `usermod -aG dialout volteria`, restart services |
| Timeout on all reads | `mbpoll -a X -b Y /dev/ttyACM1` | Check wiring, slave ID, baudrate |
| Intermittent timeouts | `lsof /dev/ttyACMX` | Ensure single process access per port |
| Wrong data values | Check parity/stopbits | Match device settings exactly |
| Bus contention errors | Multiple devices on same port | Verify unique slave IDs |

### UPS Monitor Diagnostics

```bash
# Check service
systemctl status volteria-ups-monitor
journalctl -u volteria-ups-monitor --since "10 min ago"

# Check GPIO16 state (1=power OK, 0=power loss)
cat /sys/class/gpio/gpio16/value

# Check if gpiod is working
python3 -c "import gpiod; print(gpiod.is_gpiochip_device('/dev/gpiochip0'))"
```

**UPS Shutdown Sequence** (on power loss):
1. GPIO16 goes LOW → detected within 100ms
2. Stop volteria-logging (Layer 5)
3. Stop volteria-control (Layer 4)
4. Stop volteria-device (Layer 3)
5. Stop volteria-config (Layer 2)
6. Stop volteria-system (Layer 1)
7. Execute `sudo poweroff` (total <15s)

### Hardware Watchdog Diagnostics

```bash
# Check service
systemctl status volteria-watchdog
journalctl -u volteria-watchdog --since "10 min ago"

# Check watchdog device
ls -la /dev/watchdog

# Check if being fed (should see writes every 30s)
journalctl -u volteria-watchdog -f
```

**Watchdog Behavior**: Write to `/dev/watchdog` every 30s. If no write for 60s → automatic reboot.

### 4G Connectivity Diagnostics

```bash
# Check modem detection
mmcli -L                          # List modems
mmcli -m 0 --simple-status        # Connection status

# Check signal strength
mmcli -m 0 | grep "signal quality"

# Check NetworkManager profile
nmcli con show volteria-4g

# Check active connection
nmcli con show --active

# Test connectivity
ping -I wwan0 -c 3 google.com
```

**4G Common Issues**:
| Issue | Check | Fix |
|-------|-------|-----|
| Modem not detected | `mmcli -L` | Check SIM inserted, reboot |
| Connection fails | `mmcli -m 0 --simple-status` | Check APN in config.yaml |
| No internet through 4G | `ip route` | Check default route priority |
| 4G overrides Ethernet | `nmcli con show volteria-4g` | Check priority is 400 |

---

## 13. Live Readings Data Flow

### End-to-End Path

```
Device (Modbus) → RegisterReader → SharedState (readings.json) [1s poll]
       ↓
  RAM Buffer [sample every 1s, max 10,000]
       ↓
  SQLite (flush every 60s, WAL mode)
       ↓
  Cloud Sync (every 180s, per-register downsampling)
       ↓
  Supabase (device_readings + control_logs tables)
       ↓
  Frontend API (GET /api/dashboards/[siteId]/live-data)
       ↓
  Dashboard Canvas (polls every 30s, configurable per dashboard)
```

### Frontend Polling

**Dashboard Canvas** (`dashboard-canvas.tsx`):
- **Default interval**: 30s (configurable via `site_dashboards.refresh_interval_seconds`)
- **Page Visibility API**: Pauses polling when tab hidden, refetches on tab visible
- **Cleanup**: Clears interval on component unmount

**Live Power Display** (`live-power-display.tsx`):
- **Supabase Realtime**: postgres_changes subscription on `control_logs` table
- **Stale detection**: Every 10s checks if data > 30s old
- **Page Visibility**: Pauses stale check when tab hidden

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/dashboards/[siteId]/live-data` | GET | Latest readings + device status + site aggregates |
| `/api/historical` | GET | Aggregated time-series (uses RPC) |
| `/api/controllers/[id]/registers` | POST | On-demand register read via SSH (not polling) |

### Live Registers API (On-Demand Reads)

**Flow**: Frontend → Backend → SSH → `register_cli.py` → Modbus device

```
POST /api/controllers/{id}/registers
    → Backend validates controller_secret
    → SSH to Pi: python register_cli.py read --device-id X --addresses Y
    → register_cli.py reads device config from SharedState (get_config())
    → Connects to device using config IP/port/slave_id
    → Returns JSON with readings or error
```

**CRITICAL**: `register_cli.py` must use `get_config()` from `common.state` (not hardcoded paths) to read device connection settings. This ensures it reads from tmpfs (latest synced config) even when executed via SSH (outside systemd).

**Common Issue**: "Device not reporting back" despite device being online
- **Cause**: Script reading stale disk config with old IP instead of tmpfs with new IP
- **Fix**: `register_cli.py` now uses SharedState pattern (same as logging service)

### Live Data Response Shape

```json
{
  "registers": { "[device_id]": { "[register_name]": { "value", "unit", "timestamp" } } },
  "device_status": { "[device_id]": { "is_online", "last_seen", "name" } },
  "site_aggregates": { "total_load_kw", "solar_output_kw", "dg_power_kw", "solar_limit_pct" }
}
```

### Historical Data RPC

**Function**: `get_historical_readings()` (migration 079)

**Auto-aggregation**:
| Date Range | Mode | Resolution |
|------------|------|------------|
| < 24 hours | `raw` | Original timestamps |
| 24h – 7 days | `hourly` | Grouped by hour (min/max/avg) |
| > 7 days | `daily` | Grouped by day (min/max/avg) |

**Limits**: 500,000 rows per query (all modes)

### Debugging at Each Stage

```bash
# 1. SharedState: Is device reading?
cat /opt/volteria/data/state/readings.json | python3 -m json.tool

# 2. SQLite: Is it buffered?
sqlite3 /opt/volteria/data/controller.db \
  "SELECT device_id, register_name, value, timestamp FROM device_readings ORDER BY id DESC LIMIT 5"

# 3. SQLite: Is it synced to cloud?
sqlite3 /opt/volteria/data/controller.db \
  "SELECT COUNT(*) as pending FROM device_readings WHERE synced_at IS NULL"

# 4. Cloud: Did it reach Supabase? (run from any machine)
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/device_readings?device_id=eq.DEVICE_UUID&order=timestamp.desc&limit=5" \
  -H "apikey: SERVICE_KEY" | python3 -m json.tool

# 5. Frontend: Check browser Network tab for:
#    GET /api/dashboards/[siteId]/live-data (should fire every 30s)
```

### Cross-Reference

- **Controller → SQLite → Cloud**: See `check-logging` for detailed SQLite buffer, downsampling, and cloud sync mechanics
- **Config that controls density**: Per-register `logging_frequency` (default 60s) → how many readings reach cloud

---

## 14. Related Skills

- **`check-logging`**: Deep dive into logging service (RAM buffer, SQLite, cloud sync, downsampling, alarm evaluation, drift tracking)
- **`check-setup`**: Controller provisioning flow (wizard, setup script, registration, SSH tunnel setup, testing, SOL532-E16 hardware-specific setup)

<!-- Updated: 2026-01-28 - Added supervisor restart loop fix, ReadWritePaths diagnostic step -->
