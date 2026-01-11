# Control Master - Controller Architecture Reference

> This is the knowledge base for the Volteria controller architecture.
> Reference this file when working on controller-related features.

## Implementation Plan Status

**Active Plan**: `.claude/plans/purrfect-jumping-meerkat.md`
**Full Original Plan**: `.claude/plans/compressed-jingling-cocke.md` (98KB, 21 Parts)

### Current Phase: Phase 7 - Deploy to Raspberry Pi
- Phase 1 COMPLETE: All services validated, 17/17 tests passed
- Phase 2 COMPLETE: Database migrations created (058, 059 existed; 068 new)
- Phase 3 COMPLETE: `main_v2.py` entry point created and tested
- Phase 4 COMPLETE: Reboot feature (backend + frontend + controller)
- Phase 5 COMPLETE: Wizard already updated for 5-layer architecture
- Phase 6 DEFERRED: OTA mechanism (lower priority)
- **Next**: Phase 7 - Deploy to Raspberry Pi, Phase 8 - Retire old code

### Quick Command to Continue
```
Continue the controller architecture implementation plan
```

### New Entry Point
Use `main_v2.py` for the new 5-layer architecture:
```bash
python main_v2.py --dry-run    # Validate config
python main_v2.py              # Start all services
python main_v2.py -v           # Verbose/debug mode
```

## Quick Reference

### Service Layers (Bottom to Top)
1. **System Service** - Heartbeat, OTA, health monitoring (ALWAYS alive)
2. **Config Service** - Sync, caching, versioning
3. **Device Service** - Modbus I/O, polling, writes
4. **Control Service** - Zero-feeding algorithm (pluggable operation modes)
5. **Logging Service** - Data logging, cloud sync, alarms

---

## Design Decisions

### Architecture
| Decision | Choice |
|----------|--------|
| IPC Method | Shared files + in-memory state |
| Process Model | Multi-process (separate systemd units) |
| Service Recovery | 3x restart, then alert + safe mode |
| Modbus Location | Part of device_service |
| Migration Strategy | Big bang (no backward compatibility) |

### Operations
| Decision | Choice |
|----------|--------|
| OTA Updates | Manual approval required |
| Reboot | Double confirmation (dialog + type REBOOT) |
| Logging Level | INFO in production |
| Local UI | Phase 2 (deferred) |

### Timezone
| Decision | Choice |
|----------|--------|
| Controller | UTC everywhere |
| Database | TIMESTAMPTZ (UTC) |
| Frontend | Converts to project timezone |
| Project Setting | IANA format (e.g., Asia/Riyadh) |

---

## Config Sync (What Gets Pulled)

The controller syncs ALL configuration from cloud:
- **Site settings**: DG reserve, control interval, safe mode config
- **Operation mode**: Determines which settings are required
- **All devices**: With complete register definitions
- **Registers**: Address, name, type, datatype, scale, unit, poll_interval
- **Calculated fields**: Formulas for totals (solar, load, DG)
- **Alarm definitions**: With site-specific overrides

### Operation Mode Settings
| Setting | zero_dg_reverse | zero_dg_pf | zero_dg_reactive | peak_shaving |
|---------|-----------------|------------|------------------|--------------|
| dg_reserve_kw | Required | Required | - | - |
| target_power_factor | - | Required | - | - |
| max_reactive_kvar | - | - | Required | - |
| peak_threshold_kw | - | - | - | Required |
| battery_reserve_pct | - | - | - | Required |

### Pluggable Operation Modes
New modes can be added by:
1. Create class extending `OperationMode` base class
2. Define `mode_id`, `required_settings`, `required_device_types`
3. Implement `calculate()` method
4. Register in `OPERATION_MODES` dictionary

---

## Logging & Data Strategy

### 3-Tier Logging
| Tier | Interval | Storage |
|------|----------|---------|
| Device Polling | 100ms - 60s (per register) | In-memory buffer |
| Local SQLite | Every 10 seconds | Batched writes |
| Cloud Sync | Every 2 minutes | Supabase PostgreSQL |

### Per-Register Polling
- **Fast (100-500ms)**: Control-critical (active_power_kw, power_limit_pct)
- **Medium (1-5s)**: Monitoring (voltage, current, frequency)
- **Slow (10-60s)**: Diagnostics (daily_energy, device_temp)

### In-Memory Aggregation
Before writing to SQLite/cloud, readings are aggregated:
- `last` - Most recent value
- `min` - Minimum in period
- `max` - Maximum in period (captures spikes)
- `avg` - Average value
- `count` - Number of samples

### Cloud Sync Modes
The controller supports two cloud sync methods:

| Mode | Config | Endpoint | Use Case |
|------|--------|----------|----------|
| Direct Supabase | `backend_url` not set | `/rest/v1/control_logs` | Simple, fewer hops |
| FastAPI Backend | `backend_url` set | `/api/logs/site/{site_id}/push` | Notifications, validation |

**FastAPI Backend Benefits:**
- Alarm notifications triggered on insert
- Server-side validation
- Audit logging
- Future: rate limiting, quotas

**Config Example:**
```yaml
cloud:
  supabase_url: "https://xxx.supabase.co"
  supabase_key: "your-key"
  backend_url: "https://volteria.org/api"  # Optional: routes through FastAPI
  sync_enabled: true
```

### Cloud Storage (3-Tier Architecture)
| Tier | Retention | Storage | Size |
|------|-----------|---------|------|
| Hot | 48 hours | Supabase PostgreSQL | ~230 MB |
| Warm | 7-90 days | Supabase PostgreSQL (partitioned) | ~2 GB |
| Cold | 90+ days | Supabase Storage (Parquet) | ~4 GB/year |

### Data Volume (80 sites, 160 registers each)
- Per day: 115 MB (57,600 rows)
- Per month: 3.4 GB (1.7M rows)
- Per year: 41 GB → 4 GB with Parquet compression

### Cost
- **Supabase Pro**: $25/mo (stays flat with 3-tier architecture)
- **No TimescaleDB needed** until 200+ sites

---

## Critical Files

### Controller Paths
```
/opt/volteria/
├── controller/
│   ├── services/
│   │   ├── system/      # Layer 1: Always alive
│   │   ├── config/      # Layer 2: Config sync
│   │   ├── device/      # Layer 3: Modbus I/O
│   │   ├── control/     # Layer 4: Control logic
│   │   └── logging/     # Layer 5: Observability
│   ├── common/          # Shared utilities
│   └── supervisor.py    # Service orchestrator
├── data/
│   ├── state/           # Shared state files
│   ├── controller.db    # Local SQLite
│   └── config_history/  # Config versions
└── systemd/             # Service unit files
```

### Shared State Files (`/opt/volteria/data/state/`)
- `config.json` - Current site configuration
- `readings.json` - Latest device readings
- `control_state.json` - Current control output
- `service_health.json` - Service health status
- `commands.json` - Pending cloud commands

### Systemd Services
- `/etc/systemd/system/volteria-*.service`
- System service: `Restart=always` (never dies)
- Other services: `Restart=on-failure` (3x max)

---

## Health & Recovery

### Health Check Protocol
Each service exposes: `GET /health → {"status": "healthy", "uptime": N}`

### Service Recovery Policy
1. Service fails → Auto restart (attempt 1/3)
2. Fails again → Auto restart (attempt 2/3)
3. Fails again → Auto restart (attempt 3/3)
4. Fails 4th time → **Alert + trigger safe mode**

### Safe Mode Trigger
When critical service unrecoverable:
- Control service defaults to safe power limit
- Alert sent to cloud immediately
- Heartbeat shows `service_status: "failed"`

---

## Frontend Integration

### Live Dashboard Feel
- Heartbeats (every 30s) include `live_readings` for real-time display
- Historical data syncs every 2 minutes
- Frontend polls heartbeats every 5-10 seconds

### Reboot Flow (Double Confirmation)
1. Click "Reboot Controller" button
2. First dialog: "This will restart... Continue?"
3. Second dialog: Type "REBOOT" to confirm
4. Command sent to `control_commands` table
5. Controller picks up, executes graceful reboot

---

## Database Tables

### New Tables for Architecture
- `firmware_releases` - OTA update packages
- `controller_updates` - OTA status tracking
- `controller_service_status` - Per-service health

### Logging Tables
- `control_logs` - Hot tier (48 hours)
- `control_logs_archive` - Warm tier (partitioned by month)
- Supabase Storage - Cold tier (Parquet files)

---

## OTA Update Flow

1. Backend publishes new version → `firmware_releases` table
2. System service checks for updates (hourly)
3. Download to `/opt/volteria/updates/`
4. Verify SHA256 checksum
5. Update status: `downloading` → `ready`
6. **Wait for manual approval** (admin clicks "Apply Update")
7. Stop services (except system)
8. Apply update
9. Restart services
10. Health check
11. Report success/failure
12. Rollback if health check fails

---

## Quick Reference Commands

### Check Service Status
```bash
systemctl status volteria-*
```

### View Service Logs
```bash
journalctl -u volteria-control -f
```

### Manual Service Restart
```bash
sudo systemctl restart volteria-control
```

### Check Shared State
```bash
cat /opt/volteria/data/state/readings.json | jq
```

### Force Config Sync
```bash
# Via control_commands table or local API
curl -X POST http://localhost:8082/sync
```

---

## SSH Remote Access

Controllers maintain a persistent reverse SSH tunnel to the central server (159.223.224.203).
This allows Claude Code and admins to SSH into any registered controller.

### How It Works
1. Controller establishes reverse SSH tunnel using `autossh`
2. Tunnel connects controller's port 22 to a unique port on central server (2230-2299)
3. SSH credentials stored in `controllers` table
4. Access via central server: `ssh -p {port} {username}@localhost`

### Database Columns (controllers table)
| Column | Description |
|--------|-------------|
| `ssh_tunnel_port` | Unique port on central server (e.g., 2223) |
| `ssh_username` | SSH username on controller |
| `ssh_password` | SSH password (encrypted in production) |
| `ssh_tunnel_active` | Whether tunnel is currently active |
| `ssh_last_connected_at` | Last successful SSH connection |

### Access Command Pattern
```bash
# From central server (159.223.224.203)
sshpass -p '{password}' ssh -p {port} {username}@localhost '<command>'

# Full command from anywhere with SSH access to central server
ssh root@159.223.224.203 "sshpass -p '{password}' ssh -p {port} {username}@localhost '<command>'"
```

### Example: Access Controller by Serial Number
```bash
# 1. Look up controller
curl -s "https://volteria.org/api/controllers/lookup?serial=3c1107e535ee5f4d" \
  -H "Authorization: Bearer {token}"

# 2. Use returned connection command
ssh root@159.223.224.203 "sshpass -p 'Solar@1996' ssh -p 2223 mohkof1106@localhost 'uptime'"
```

### API Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/controllers/lookup?serial=X` | GET | Find controller by serial, get SSH details |
| `/api/controllers/[id]/ssh` | GET | Get SSH credentials for controller |
| `/api/controllers/[id]/ssh` | PUT | Update SSH credentials |
| `/api/controllers/[id]/ssh-setup` | POST | Allocate SSH port during wizard setup |

### Wizard Integration
When a new controller comes online (Step 6: Verify Online):
1. Wizard detects heartbeat
2. Automatically calls `/api/controllers/[id]/ssh-setup`
3. Allocates unique port from 2230-2299 range
4. Stores credentials in database
5. Shows SSH port to admin

### Systemd Service (on controller)
```ini
# /etc/systemd/system/volteria-tunnel.service
[Unit]
Description=Volteria SSH Reverse Tunnel
After=network-online.target

[Service]
User=mohkof1106
Type=simple
ExecStart=/usr/bin/autossh -M 0 -N \
  -o "ServerAliveInterval 30" \
  -o "ServerAliveCountMax 3" \
  -R {port}:localhost:22 root@159.223.224.203
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

---

## Troubleshooting

### Service Won't Start
1. Check logs: `journalctl -u volteria-{service} -n 50`
2. Check config: `/opt/volteria/data/state/config.json`
3. Check permissions: files owned by `volteria` user

### No Heartbeats
1. Check system service: `systemctl status volteria-system`
2. Check network: `ping supabase-url`
3. Check credentials: `/etc/volteria/env`

### Device Offline
1. Check device service logs
2. Check Modbus connectivity: `ping {device_ip}`
3. Check registers in config

### Safe Mode Triggered
1. Check which service failed
2. Review logs for root cause
3. Fix issue, restart service
4. Safe mode auto-recovers when service healthy
