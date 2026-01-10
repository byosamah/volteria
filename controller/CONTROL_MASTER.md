# Control Master - Controller Architecture Reference

> This is the knowledge base for the Volteria controller architecture.
> Reference this file when working on controller-related features.

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
