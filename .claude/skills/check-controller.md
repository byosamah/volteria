# Check Controller - Volteria Controller Architecture Reference

> Master reference for the 5-layer controller: supervisor, services, SharedState, SSH tunnels, safe mode, and diagnostics.

## Trigger Conditions

Activate this skill when:
- Files touched: `controller/supervisor.py`, `controller/main_v2.py`, `controller/services/system/*`, `controller/services/config/*`, `controller/services/device/*`, `controller/services/control/*`, `controller/common/*`
- Topics: controller services, heartbeat, safe mode, modbus, SSH tunnel, device polling, control loop, operation mode, supervisor, service health, connection pool, SharedState

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

**Health endpoints** (run on Pi):
```bash
curl http://127.0.0.1:8081/health | python3 -m json.tool  # System
curl http://127.0.0.1:8082/health | python3 -m json.tool  # Config
curl http://127.0.0.1:8083/health | python3 -m json.tool  # Device
curl http://127.0.0.1:8084/health | python3 -m json.tool  # Control
curl http://127.0.0.1:8085/health | python3 -m json.tool  # Logging
```

**SharedState** (run on Pi):
```bash
cat /opt/volteria/data/state/readings.json | python3 -m json.tool
cat /opt/volteria/data/state/control_state.json | python3 -m json.tool
cat /opt/volteria/data/state/config.json | python3 -m json.tool | head -50
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
| `services/device/connection_pool.py` | - | Modbus connection reuse |
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
| `config.json` | config | device, control, logging | Site configuration |
| `control_state.json` | control | logging, system | Algorithm output |
| `service_health.json` | all | system | Health status |
| `safe_mode_override.json` | supervisor | control | Safe mode trigger |
| `controller_config.json` | main_v2 | all | Boot config from YAML |
| `config_status.json` | config | device, control, logging | Change notification |

### Config Change Notification
1. Config service writes new config + `config_status.json` with new version
2. Other services detect change via `is_config_changed()`
3. Each service acknowledges: `acknowledge_config_change(service_name)`
4. Required acknowledgers: `{"device", "control", "logging"}`

---

## 3. SSH Tunnel Architecture

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

## 4. Safe Mode

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

## 5. Operation Modes

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

## 6. Deployment/Update Flow

### Remote Update
```
POST /api/controllers/{id}/update
    → Backend validates controller_secret
    → SSH to controller: git pull + systemctl restart volteria-*
```

### Reboot (Double Confirmation in UI)
```
POST /api/controllers/{id}/reboot
    → SSH: sudo reboot
    → Systemd auto-starts services on boot
```

### OTA Flow
check hourly → download → verify SHA256 → wait approval → apply → verify health → rollback if unhealthy

---

## 7. Validation Rules

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

---

## 8. Diagnostic Protocol

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

8. **Check SQLite backlog**:
   ```bash
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
    host google.com                     # DNS working?
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

---

## 9. Observability Metrics

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

## 10. Raspberry Pi File Paths

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

---

## 11. Related Skills

- **`check-logging`**: Deep dive into logging service (RAM buffer, SQLite, cloud sync, downsampling, alarm evaluation, drift tracking)
- **`check-setup`**: Controller provisioning flow (wizard, setup script, registration, SSH tunnel setup, testing)
