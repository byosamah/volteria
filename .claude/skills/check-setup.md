# Check Setup - Volteria Controller Provisioning Reference

> Master reference for the 6-step wizard: hardware registration, OS flash, software setup, cloud connection, heartbeat verification, and SSH-based testing.

## Trigger Conditions

Activate this skill when:
- Files touched: `frontend/src/app/admin/controllers/wizard/*`, `controller/scripts/setup-controller.sh`, `controller/scripts/dns-watchdog.sh`, `backend/app/routers/controllers.py`, `backend/app/routers/ssh_tests.py`
- Topics: wizard, controller setup, provision, flash, SSH setup, deploy controller, test controller, register controller, heartbeat verification, setup script, hardware type

---

## 0. Quick Commands

**Check wizard progress**:
```sql
SELECT id, serial_number, status, wizard_step, wizard_started_at, test_results
FROM controllers WHERE serial_number = 'SERIAL' OR id = 'UUID';
```

**Check heartbeat** (is controller reporting?):
```sql
SELECT timestamp, firmware_version, uptime_seconds, cpu_usage_pct, memory_usage_pct
FROM controller_heartbeats WHERE controller_id = 'UUID'
ORDER BY timestamp DESC LIMIT 1;
```

**Run setup script** (on Pi via SSH):
```bash
curl -sSL https://raw.githubusercontent.com/byosamah/volteria/main/controller/scripts/setup-controller.sh | sudo bash
```

**Run SSH tests** (API call):
```
POST /ssh-test/{controller_id}?ssh_port=XXXX
```

**Check tunnel** (on Pi):
```bash
systemctl status volteria-tunnel
journalctl -u volteria-tunnel --since "10 min ago"
```

**Check DNS** (on Pi):
```bash
host google.com
cat /etc/resolv.conf
```

**Check registration** (on Pi):
```bash
cat /etc/volteria/config.yaml | grep -A5 controller
```

---

## 1. Wizard Flow Architecture

```
[1. Hardware Info] → [2. Flash Image] → [3. Software Setup]
       ↓                   ↓                    ↓
  DB: controller row   SD card flash      Pi: setup-controller.sh
                                                ↓
                                         POST /api/controllers/register
                                                ↓
[4. Cloud Connection] ← ← ← ← ← ← Controller registered in DB
       ↓
[5. Verify Online] → Poll controller_heartbeats (5s, 5min timeout)
       ↓
[6. Run Tests] → SSH tests (5 real) + skip remaining if tunnel fails
       ↓
  controller.status = 'ready'
```

### Step Definitions (controller-wizard.tsx :34-41)

| Step | Name | Component | What Happens |
|------|------|-----------|-------------|
| 1 | Hardware Info | `step-hardware-info.tsx` | Create controller row (status: draft) |
| 2 | Flash Image | `step-flash-instructions.tsx` | Guide: Pi Imager → SD card |
| 3 | Software Setup | `step-download-image.tsx` | Run setup script on Pi |
| 4 | Cloud Connection | `step-cloud-connection.tsx` | Verify registration (serial in DB) |
| 5 | Verify Online | `step-verify-online.tsx` | Poll heartbeats, trigger SSH setup |
| 6 | Run Tests | `step-run-tests.tsx` | 5 SSH tests via backend |

### State Management (controller-wizard.tsx :70-82)
- `controllerId`: UUID (null until step 1)
- `controllerData`: `{serial_number, hardware_type_id, firmware_version, notes}`
- `currentStep`: number (1-6)
- `completedSteps`: number[]
- `stepConfirmed`: boolean (per-step gate)
- Progress persisted: `saveWizardProgress()` :96 → Supabase update

### Frontend Files

| File | Purpose |
|------|---------|
| `wizard/page.tsx` | Route + data fetching |
| `wizard/controller-wizard.tsx` | Main orchestrator |
| `wizard/steps/step-hardware-info.tsx` | Serial + hardware type form |
| `wizard/steps/step-flash-instructions.tsx` | Balena Etcher guide |
| `wizard/steps/step-download-image.tsx` | Setup script + NVMe instructions |
| `wizard/steps/step-cloud-connection.tsx` | Registration verification |
| `wizard/steps/step-verify-online.tsx` | Heartbeat polling + SSH setup |
| `wizard/steps/step-run-tests.tsx` | Test runner UI |

---

## 2. Setup Script Breakdown

**File**: `controller/scripts/setup-controller.sh` (752 lines)

### Execution Order (main() :720-748)

| # | Function | Line | Purpose |
|---|----------|------|---------|
| 1 | `check_root()` | :55 | Verify running as root |
| 2 | `check_requirements()` | :81 | OS, arch, memory validation |
| 3 | `install_dependencies()` | :111 | apt: python3, git, autossh, sshpass, nmgr |
| 4 | `configure_network()` | :131 | Timezone Asia/Dubai, persistent DNS on WiFi |
| 5 | `setup_controller_code()` | :248 | Git clone (fresh) or git pull (update) |
| 6 | `install_dns_watchdog()` | :166 | Cron 5min + daily 1am timer |
| 7 | `create_directories()` | :207 | /opt/volteria/*, /var/log/volteria |
| 8 | `setup_python_env()` | :291 | Venv + pip install requirements.txt |
| 9 | `create_volteria_user()` | :342 | System user + dialout group |
| 10 | `configure_tmpfs_state()` | :229 | RAM-based state dir (/run/volteria/state) |
| 11 | `setup_sudoers()` | :363 | volteria + voltadmin permissions |
| 12 | `generate_config()` | :427 | /etc/volteria/config.yaml |
| 13 | `create_env_file()` | :312 | /etc/volteria/env |
| 14 | `install_systemd_services()` | :392 | Enable 6 services |
| 15 | `disable_cloud_init()` | :414 | Prevent shutdown issues |
| 16 | `setup_ssh_tunnel()` | :480 | Tunnel template (port TBD) |
| 17 | `register_controller()` | :532 | POST /register + tunnel start |
| 18 | `start_services()` | :609 | Layer-by-layer start (3s/2s gaps) |
| 19 | `verify_installation()` | :645 | systemctl + health checks |
| 20 | `print_summary()` | :682 | Summary output |

### Hardware Detection (detect_hardware() :72-78)
```bash
if [[ -b /dev/nvme0n1 ]]; then
    echo "SOL564-NVME16-128"   # NVMe present
else
    echo "raspberry_pi_5"       # Standard Pi 5
fi
```

### Serial Number (get_serial_number() :63-69)
- Source: `/proc/cpuinfo` Serial field, last 17 chars
- Fallback: `unknown-$(hostname)`

### Network Configuration (configure_network() :131-163)
- Timezone: `Asia/Dubai`
- WiFi DNS: detect active connection via `nmcli`, set `8.8.8.8 8.8.4.4`
- Ethernet: NOT configured (manual per site)

### DNS Resilience
- **Cron watchdog** (`dns-watchdog.sh`): every 5 min, `host google.com` → restart NetworkManager if broken
- **Daily timer**: 1am conditional NetworkManager restart (systemd timer)
- **Zero-impact**: Only acts when DNS is actually broken

---

## 3. SSH Tunnel Establishment

### Setup Flow (setup_ssh_tunnel() :480-508)
1. Create `volteria-tunnel.service` template with placeholder `SSH_TUNNEL_PORT`
2. User: `volteria`, Password: `VoltTunnel@2026`
3. Central server: `159.223.224.203`
4. SSH params: `ServerAliveInterval 30`, `ServerAliveCountMax 3`, `ExitOnForwardFailure yes`

### Port Allocation (register_controller() :532-606)
1. Setup script calls `POST /api/controllers/register`
2. Backend assigns unique `ssh_tunnel_port` from available range
3. Response: `{controller_id, ssh_tunnel_port, supabase_key, supabase_url}`
4. Script runs `sed -i "s/SSH_TUNNEL_PORT/${SSH_PORT}/"` on service file :582
5. `systemctl enable + start volteria-tunnel.service` :586-588

### Wizard SSH Setup (step-verify-online.tsx)
- After heartbeat detected, frontend calls `POST /api/controllers/{id}/ssh-setup`
- Returns: `{ssh_tunnel_port, ssh_username, central_server}`
- Sets `sshSetupStatus`: pending → setting_up → complete/error

### Access Pattern
```bash
# From Windows (through DO gateway):
ssh root@159.223.224.203 "sshpass -p '<password>' ssh -o StrictHostKeyChecking=no -p <port> voltadmin@localhost '<command>'"
```

---

## 4. Registration & Heartbeat Verification

### Controller Registration API
**Endpoint**: `POST /api/controllers/register` (backend/app/routers/controllers.py)

**Request**:
```json
{
  "serial_number": "10000000abcdef01",
  "hardware_type": "raspberry_pi_5",
  "firmware_version": "2.0.0"
}
```

**Response**:
```json
{
  "controller_id": "uuid",
  "ssh_tunnel_port": 2231,
  "supabase_key": "eyJ...",
  "supabase_url": "https://usgxhzdctzthcqxyxfxl.supabase.co"
}
```

### Heartbeat Verification (step-verify-online.tsx)
- **Poll interval**: 5 seconds
- **Timeout**: 5 minutes
- **Query**: `controller_heartbeats WHERE controller_id = ? ORDER BY timestamp DESC LIMIT 1`
- **Accept**: timestamp within last 10 minutes

### HeartbeatData Structure
```json
{
  "timestamp": "2026-01-24T12:00:00Z",
  "firmware_version": "2.0.0",
  "uptime_seconds": 45,
  "cpu_usage_pct": 32.1,
  "memory_usage_pct": 58.4,
  "metadata": {
    "services": {"system": "healthy", "config": "healthy", ...},
    "config_version": "2026-01-24T10:30:00Z"
  }
}
```

### Database Columns (controllers table)

| Column | Type | Purpose |
|--------|------|---------|
| `wizard_step` | integer | Current step (1-6), NULL if complete |
| `wizard_started_at` | timestamp | When wizard started |
| `test_results` | jsonb | Test results per category |
| `status` | text | draft → ready → claimed → deployed → eol |
| `serial_number` | text | Pi serial from /proc/cpuinfo |
| `hardware_type_id` | uuid | FK to approved_hardware |
| `ssh_port` | integer | Tunnel port on central server |
| `ssh_username` | text | SSH login user |
| `ssh_password` | text | SSH password |

---

## 5. Test Suite

**Backend**: `backend/app/routers/ssh_tests.py` (355 lines)

### SSH Connection Config (ssh_tests.py :22-25)
- Host: `host.docker.internal` (Docker → host machine)
- User: `voltadmin`
- Password: `Solar@1996`
- Timeout: 15s
- Library: paramiko

### 5 Real Tests

| # | Test | Function | Line | What It Checks |
|---|------|----------|------|----------------|
| 1 | `ssh_tunnel` | `test_ssh_tunnel()` | :98 | `echo 'tunnel_ok'` via SSH |
| 2 | `service_health` | `test_service_health()` | :126 | `systemctl is-active` for 5 services |
| 3 | `communication` | `test_cloud_communication()` | :173 | curl Supabase API from Pi |
| 4 | `config_sync` | `test_config_sync()` | :216 | config.yaml exists + has content |
| 5 | `ota_check` | `test_ota_mechanism()` | :253 | System service active + firmware API |

### Test Execution Flow (ssh_tests.py :305-354)
```
POST /ssh-test/{controller_id}?ssh_port=XXXX
    → Test 1: SSH tunnel (GATE — if fails, skip rest)
    → Test 2-5: Run sequentially via SSH
    → Return: SSHTestResponse {results[], total_duration_ms}
```

### Result Status Flow
- All pass → controller `status = "ready"`, `wizard_step = NULL`
- Any fail → controller `status = "failed"`, can retry
- Tunnel fail → remaining tests = "skipped"

### API Response Model
```json
{
  "controller_id": "uuid",
  "ssh_port": 2231,
  "results": [
    {"name": "ssh_tunnel", "status": "passed", "message": "...", "duration_ms": 1200},
    {"name": "service_health", "status": "passed", "message": "All 5 services running", "duration_ms": 800}
  ],
  "total_duration_ms": 5400
}
```

---

## 6. Adding New Hardware Types

### What to Modify

1. **Setup script** (`setup-controller.sh` :72-78):
   ```bash
   detect_hardware() {
       if [[ -b /dev/nvme0n1 ]]; then
           echo "SOL564-NVME16-128"
       elif [[ -f /sys/firmware/devicetree/base/model ]] && grep -q "NEW_DEVICE" /sys/firmware/devicetree/base/model; then
           echo "new_hardware_type"
       else
           echo "raspberry_pi_5"
       fi
   }
   ```

2. **Database** (`approved_hardware` table):
   ```sql
   INSERT INTO approved_hardware (name, hardware_type, cpu_cores, memory_mb, storage_gb, features)
   VALUES ('New Device Name', 'new_hardware_type', 4, 4096, 128, '{"ups": true, "nvme": true}');
   ```

3. **Wizard UI** (`step-download-image.tsx`):
   - Add hardware-specific instructions (e.g., UPS configuration, boot settings)
   - Check `hardwareType` prop to show/hide relevant sections

4. **Package selection** (future):
   - If hardware has UPS → enable UPS monitoring service
   - If hardware has specific I/O → configure GPIO/serial ports
   - Deploy different `config.yaml` defaults based on type

### Hardware Features (stored in `approved_hardware.features` JSONB)
- `ups`: boolean — has integrated UPS
- `nvme`: boolean — has NVMe storage
- `gpio_count`: number — available GPIO pins
- `serial_ports`: number — RS-485/RS-232 ports
- `ethernet_ports`: number — RJ45 ports

---

## 7. Validation Rules

| Rule | Why |
|------|-----|
| Setup script must run as root | System-level changes (users, services, network) |
| Serial from /proc/cpuinfo | Unique Pi identifier, survives reflash |
| WiFi connection name detected dynamically :140 | Varies between OS images |
| DNS watchdog zero-impact when healthy | Only acts if `host google.com` fails |
| SSH tunnel port unique per controller | Prevents port conflicts on central server |
| Heartbeat timeout 5 min in wizard | Allows slow first boot + registration |
| Config auto-generated (not downloaded) | Setup script creates from registration response |
| Tunnel test is gate for other tests :330 | SSH prerequisite for remote execution |
| `wizard_step` persisted to DB :96 | Resume support after browser refresh |
| NVMe detection before package selection | Wrong image = boot failure |
| cloud-init disabled :414 | Prevents kernel panic on reboot |
| Config preserved if exists :434 | Re-runs don't overwrite working config |
| Git clone depth 1 :274 | Minimize download size |

---

## 8. Troubleshooting

### Common Failures Per Step

| Step | Failure | Check | Fix |
|------|---------|-------|-----|
| 1 | Duplicate serial | `controllers` table | Reset `wizard_step` on existing record |
| 3 | Script fails early | `apt-get update` works? | Check Pi internet, DNS |
| 3 | pip install fails | Python version | Ensure Python 3.11+, check venv |
| 3 | git clone fails | Network from Pi | Check DNS, proxy settings |
| 4 | Registration fails | API reachable? | `curl https://volteria.org/api/health` from Pi |
| 4 | No serial in DB | Script ran? | Check `/etc/volteria/config.yaml` exists |
| 5 | No heartbeat | Services running? | `systemctl status volteria-system` on Pi |
| 5 | SSH setup fails | Port allocated? | Check `ssh_port` in controllers table |
| 6 | Tunnel test fails | Tunnel active? | `systemctl status volteria-tunnel` on Pi |
| 6 | Services not active | Crash logs? | `journalctl -u volteria-device -n 50` |
| 6 | Cloud comm fails | DNS on Pi? | `host google.com` / check resolv.conf |
| 6 | Config not synced | Site assigned? | Config only syncs after site assignment |

### Post-Wizard Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Controller goes offline | WiFi drops | Check DNS watchdog, `nmcli con show` |
| Tunnel disconnects | Server firewall | Check port open on 159.223.224.203 |
| Services crash on boot | Bad config | `journalctl -b -u volteria-*` |
| Config won't sync | No site assigned | Assign controller to site in admin panel |

---

## 9. Observability

### Wizard Progress Metrics
- `wizard_step` in controllers table (1-6, NULL = complete)
- `wizard_started_at` timestamp
- `test_results` JSONB (per-test pass/fail/skip)
- `status` transitions: draft → ready → claimed → deployed

### Setup Script Output (print_summary() :682)
- Version, Serial, Hardware type
- All 5 services + tunnel status
- Health endpoint responses
- Remote access command

### Heartbeat Metrics (during verification)
- `uptime_seconds`: confirms fresh boot (low = just started)
- `cpu_usage_pct`, `memory_usage_pct`: system load
- `metadata.services`: per-service health status

---

## 10. Related Skills

- **`check-controller`**: After wizard completes — ongoing diagnostics, service architecture, SharedState, safe mode
- **`check-logging`**: Logging service deep dive — RAM buffer, SQLite, cloud sync, downsampling, drift
