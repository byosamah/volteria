# Controller - CLAUDE.md

> **Architecture Reference**: See [CONTROL_MASTER.md](./CONTROL_MASTER.md) for comprehensive architecture decisions, design patterns, and knowledge base.

## Purpose
Python-based on-site controller running on Raspberry Pi 5 that:
1. Reads data from load meters, DG controllers, and solar inverters
2. Calculates optimal solar power limit to prevent DG reverse feeding
3. Writes power limits to solar inverters
4. Logs data locally and syncs to cloud (Volteria platform)

## Technology Stack
| Component | Technology |
|-----------|------------|
| OS | Raspberry Pi OS (Debian-based) |
| Language | Python 3.11+ |
| Modbus | pymodbus 3.6+ |
| Local DB | SQLite3 |
| Scheduler | asyncio |
| Config | YAML files |
| Cloud Sync | httpx + Supabase |

## Key Files
```
controller/
├── main.py                  # Entry point (231 lines)
├── config.yaml              # Site configuration (96 lines)
├── control_loop.py          # Main control algorithm (888 lines)
├── alarms.py                # Alarm generation + threshold integration
├── alarm_evaluator.py       # Threshold alarm evaluation (NEW)
├── calculated_fields.py     # Calculated field computations (NEW)
├── safe_mode.py             # Safe mode logic (337 lines)
├── requirements.txt         # Python dependencies
├── storage/
│   ├── __init__.py
│   ├── local_db.py          # SQLite operations
│   ├── cloud_sync.py        # Supabase synchronization
│   └── config_sync.py       # Configuration sync
└── devices/                 # (Currently empty - handlers in control_loop.py)
```

> **Note**: Device-specific handlers (Sungrow, Meatrol, ComAp) are currently embedded within `control_loop.py`. The `devices/` folder is a placeholder for future modularization.

## Services Architecture (5-Layer)

Entry point: `main_v2.py` (use this, not legacy `main.py`)

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5: LOGGING SERVICE                                   │
│  alarm_evaluator, cloud_sync, local_db                      │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: CONTROL SERVICE                                   │
│  algorithm, calculated_fields, safe_mode, state             │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: DEVICE SERVICE                                    │
│  modbus_client, connection_pool, register_reader/writer     │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: CONFIG SERVICE                                    │
│  cache, sync, validator                                     │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: SYSTEM SERVICE (always alive)                     │
│  heartbeat, health_monitor, metrics_collector, ota_updater  │
└─────────────────────────────────────────────────────────────┘
```

### Service Modules

| Service | Path | Files | Purpose |
|---------|------|-------|---------|
| **System** | `services/system/` | 6 | Heartbeat, health, OTA, reboot |
| **Config** | `services/config/` | 4 | Sync, cache, validation |
| **Device** | `services/device/` | 6 | Modbus I/O, connection pool |
| **Control** | `services/control/` | 5 | Algorithm, safe mode, state |
| **Logging** | `services/logging/` | 4 | Local DB, cloud sync, alarms |

### Key Service Files

**System Service** (`services/system/`)
- `heartbeat.py` - Send status to cloud every 30s
- `health_monitor.py` - Track 5-layer service health
- `ota_updater.py` - Firmware update handling
- `reboot_handler.py` - Safe reboot procedures

**Device Service** (`services/device/`)
- `modbus_client.py` - Modbus TCP/RTU communication
- `connection_pool.py` - Connection management
- `register_reader.py` - Read device registers
- `register_writer.py` - Write to inverters

**Control Service** (`services/control/`)
- `algorithm.py` - Zero-feeding calculation
- `safe_mode.py` - Emergency mode logic
- `calculated_fields.py` - Totals, energy metrics

**Logging Service** (`services/logging/`)
- `service.py` - Main logging orchestration with RAM buffering
- `local_db.py` - SQLite storage (control_logs + device_readings tables)
- `cloud_sync.py` - Supabase upload with per-register downsampling
- `alarm_evaluator.py` - Threshold checking

### Logging Architecture (3-Tier with RAM Buffer)

```
Device Service → SharedState (raw readings every ~1s)
       ↓
RAM BUFFER (sample every 1s, max 10,000 readings ~2-3MB)
       ↓
LOCAL SQLITE (flush every 60s = 60x fewer disk writes)
       ↓
CLOUD SYNC (every 180s, downsampled per-register)
```

**Key Settings** (from site config via config service):
| Setting | Default | Description |
|---------|---------|-------------|
| `local_sample_interval_s` | 1 | Sample into RAM buffer |
| `local_flush_interval_s` | 60 | Flush RAM to SQLite |
| `cloud_sync_interval_s` | 180 | Sync batch to Supabase |
| `logging_frequency` | per-register | Cloud data density (1-3600s) |

**Per-Register Downsampling**:
- Each register can have different `logging_frequency` (set in device config)
- Local SQLite keeps full 1s resolution
- Cloud receives downsampled data (e.g., 60s = 1 reading/min)
- All registers sync together in one HTTP batch

### Running Services

```bash
python main_v2.py              # Start all 5 services
python main_v2.py --dry-run    # Validate config only
python main_v2.py -v           # Verbose/debug mode
```

## Control Algorithm (Zero-Feeding)
```python
# Core algorithm
load = sum(load_meter_readings)           # or calculated from DGs
available_headroom = load - DG_RESERVE    # What solar can provide
solar_limit = max(0, min(available_headroom, TOTAL_INVERTER_CAPACITY))
solar_limit_pct = (solar_limit / capacity) * 100

# Write to inverter
write_register(5007, 0xAA)        # Enable power limiting
write_register(5008, solar_limit_pct)  # Set limit percentage
```

## Control Loop Flow
```
Every 1 second (configurable):
1. Read load from all load meters (Modbus)
2. Read current solar output from inverters
3. Check safe mode conditions
4. Calculate solar limit based on available headroom
5. Write limit to all inverters
6. Verify command was accepted (read-back)
7. Log to local SQLite database

Every 30 seconds:
8. Send heartbeat to cloud

Every 5 seconds:
9. Upload pending logs/alarms to cloud
```

## Alarm Types
| Type | Severity | Description |
|------|----------|-------------|
| `COMMUNICATION_LOST` | Critical | Device stopped responding |
| `CONTROL_ERROR` | Critical | Error in control logic |
| `SAFE_MODE_TRIGGERED` | Warning | Safe mode activated |
| `NOT_REPORTING` | Warning | Device not sending data |
| `WRITE_FAILED` | Critical | Modbus write command failed |
| `COMMAND_NOT_TAKEN` | Critical | Inverter rejected limit command |
| `THRESHOLD_ALARM` | Variable | Template-defined threshold exceeded |

## Device Protocols
| Device | Protocol | Connection |
|--------|----------|------------|
| DG Controllers | Modbus TCP | Direct IP (e.g., 192.168.1.30:502) |
| Solar Inverters | Modbus RTU | Via Netbiter gateway (gateway_ip:gateway_port) |
| Load Meters | Modbus RTU | Via Netbiter gateway |

## Configuration Example
```yaml
site:
  id: "site-uuid-here"
  name: "Stone Crushing Site 1"
  location: "UAE"

site_controller:
  serial_number: "RPI5-SIM-001"
  hardware_type: "raspberry_pi_5"
  firmware_version: "1.0.0"

control:
  interval_ms: 1000              # Control loop frequency
  dg_reserve_kw: 50              # Minimum DG reserve (min: 0)
  operation_mode: "zero_dg_reverse"

logging:
  local_interval_ms: 1000        # Log locally every 1 second
  cloud_sync_interval_ms: 5000   # Push to cloud every 5 seconds
  local_retention_days: 7

safe_mode:
  enabled: true
  type: "rolling_average"        # or "time_based"
  timeout_s: 30                  # Device offline timeout
  rolling_window_minutes: 3
  threshold_pct: 80              # Solar danger threshold

devices:
  load_meters:
    - name: "Load Meter A"
      template: "meatrol_me431"
      protocol: "rtu_gateway"
      gateway_ip: "192.168.1.1"
      gateway_port: 502
      slave_id: 2
      measurement_type: "load"

  inverters:
    - name: "Solar Inverter 1"
      template: "sungrow_150kw"
      protocol: "rtu_gateway"
      gateway_ip: "192.168.1.1"
      gateway_port: 502
      slave_id: 1
      measurement_type: "solar"
      rated_power_kw: 150

  generators:
    - name: "DG-1"
      template: "comap_ig500"
      protocol: "tcp"
      ip: "192.168.1.30"
      port: 502
      slave_id: 1
      measurement_type: "generator"
      rated_power_kva: 800

cloud:
  supabase_url: "https://xxx.supabase.co"
  supabase_key: "your-service-role-key"
  backend_url: "https://volteria.org/api"  # Optional: FastAPI backend for site endpoints
  sync_enabled: true
```

## Command Line Interface
```bash
# Start with default config
python main.py

# Custom config file
python main.py --config my_site.yaml

# Dry run (print config and exit)
python main.py --dry-run

# Verbose logging
python main.py --verbose
```

## Storage System

### Local Database (SQLite)
Located at `data/controller.db`

**Tables:**
- `control_logs` - Time-series control data with sync status
- `alarms` - Alarm events with sync status

**Key Features:**
- Automatic table creation on first run
- Tracks sync status (synced/pending)
- Batch retrieval for cloud sync
- Data retention cleanup (configurable days)

### Cloud Sync
- Uploads in batches of 100 records
- Retry with exponential backoff (1s, 2s, 4s)
- Marks records as synced after successful upload
- Heartbeat every 30 seconds

## Heartbeat & Status
- Controller sends **heartbeat signal every 30 seconds** to cloud
- Status is automatically determined:
  - `online` - Heartbeat received (green signal)
  - `offline` - Heartbeat missed (triggers alarm)
  - `error` - Controller has errors

**Heartbeat Payload:**
```json
{
  "site_id": "uuid",
  "firmware_version": "1.0.0",
  "uptime_seconds": 3600,
  "cpu_usage_pct": 45.2,
  "memory_usage_pct": 62.1
}
```

## Command Verification
After writing to inverter, controller verifies command was accepted:
1. Write command to register
2. Wait 200ms
3. Read back the value
4. Compare written vs read (allow 1% tolerance)
5. If mismatch, trigger `COMMAND_NOT_TAKEN` alarm

## Safe Mode

### Type 1: Time-based
- Triggers when ANY device stops responding for X seconds
- Simple: if offline_duration > timeout → safe mode
- Sets solar limit to 0%

### Type 2: Rolling Average (Recommended)
- Triggers only when BOTH conditions met:
  1. Solar avg > 80% of load (high reverse risk)
  2. Device stopped communicating for X seconds
- Keeps 10-minute rolling window of power readings
- Fewer false alarms, context-aware

## Modbus Registers (Key)

### Sungrow Inverter
| Register | Description | Access |
|----------|-------------|--------|
| 5007 | Power Limit Switch | Write (0xAA=Enable, 0x55=Disable) |
| 5008 | Power Limit % | Write (0-100) |
| 5031 | Active Power | Read (0.1 kW scale) |

### Meatrol Meter
| Register | Description | Data Type |
|----------|-------------|-----------|
| 1032 | Total Active Power | float32 (W) |

## Offline Operation
- Control logic runs **fully locally** - no cloud dependency
- SQLite buffers data when offline (7+ days retention)
- Auto-syncs when connection restored
- No data gaps - timestamps preserved

## Dependencies (requirements.txt)
```
pymodbus>=3.6.0
supabase>=2.0.0
pyyaml>=6.0.0
apscheduler>=3.10.0
httpx>=0.27.0
python-json-logger>=2.0.0
python-dotenv>=1.0.0
```

## Important Notes

1. **DG reserve cannot be negative** (minimum: 0 kW)

2. **Controller is registered** with unique serial number

3. **Each site has one registered controller**

4. **Works independently** of Volteria cloud platform

5. **Measurement types** classify device readings:
   - `load` - Total site load
   - `sub_load` - Sub-metered load
   - `solar` - Solar output
   - `generator` - DG output
   - `fuel` - Fuel level

6. **Config modes** (determined by available devices):
   - `meter_inverter` - Load meters + inverters
   - `dg_inverter` - DG controllers + inverters
   - `full_system` - All device types present

## Key Architecture Decisions

### Device Type Enum
`controller/common/config.py` DeviceType enum must include ALL device types from database/frontend.
- Controller **skips devices** with unrecognized device_type (won't poll, log, or sync)
- When adding new types to frontend/database, also add to this enum
- Types only affect control logic classification, not Modbus communication

**Current types** (as of 2026-02-03):
- Power: `inverter`, `wind_turbine`, `bess`
- Generators: `diesel_generator_controller`, `diesel_generator`, `gas_generator_controller`
- Metering: `energy_meter`, `capacitor_bank`
- Sensors: `fuel_level_sensor`, `fuel_flow_meter`, `temperature_humidity_sensor`, `solar_radiation_sensor`, `wind_sensor`
- Industrial: `belt_scale`
- Generic: `other_hardware`
- Legacy: `load_meter`, `dg`, `sensor`

### Config Hot-Reload
- Services compare config content hash every 15 seconds
- Atomic file writes prevent partial reads (write to .tmp, then rename)

### Logging Service Principle
**Log what device service wrote, not what config says should exist.**
- Iterates SharedState readings directly
- Handles register renames gracefully

### Cloud Sync
- Clock-aligned downsampling (900s freq → :00, :15, :30, :45)
- Upload-then-mark pattern (never mark synced unless upload succeeded)
- `on_conflict` query param required for Supabase upserts

### PostgREST Upserts
```
POST /rest/v1/device_readings?on_conflict=device_id,register_name,timestamp
```
Without `on_conflict`, entire batch fails if ANY record is duplicate.

### Device Read Failures
- When device read fails, stale readings are deleted from SharedState
- Prevents old data from being logged as current
- Device marked offline in cloud (`is_online: false`)

### Connection Alarm Settings
- Per-device `connection_alarm_enabled` controls alarm generation
- Alarm created by cloud cron job (not controller) when device stops reporting
- Controller only updates `is_online` and `last_seen` fields

### SQLite + Asyncio (CRITICAL)
- `local_db` uses synchronous `sqlite3` — all calls block the event loop
- All `local_db.*` calls from async code MUST use `await self._run_db(method, *args)` (runs in thread pool via `run_in_executor`)
- NEVER call `local_db` methods directly from async functions — causes 15-22s event loop stalls on Pi SD card I/O

### Transient Alarm Auto-Resolve
- LOGGING_HIGH_DRIFT, LOGGING_BUFFER_BUILDUP auto-resolve after 3 consecutive healthy checks
- Uses `local_db.resolve_alarms_by_type()` to bulk-resolve + resync to cloud
- Prevents alarm spam accumulation for conditions that self-heal
- **CRITICAL**: Every `resolve_alarms_by_type()` call MUST be followed by `cloud_sync.resolve_alarm_in_cloud(alarm_type)` — local-only resolution leaves cloud alarms permanently stuck as Active

### ServiceLoggerAdapter Compatibility
<!-- Updated: 2026-02-10 -->
- `get_service_logger()` returns a `ServiceLoggerAdapter`, not a raw `logging.Logger`
- ServiceLoggerAdapter IS directly compatible with Logger interface (has .info, .warning, .error, etc.)
- Pass logger directly to functions expecting `logging.Logger` — do NOT use `logger._logger` (attribute doesn't exist)
- **Shutdown-only errors**: `_logger` bugs may only surface during shutdown (final loop iteration after SIGTERM). Health endpoint reports healthy during normal operation — always check `journalctl` for exit code 1 failures.

```python
# CORRECT usage
logger = get_service_logger("my_service")
logger.info("message")  # Works directly

# WRONG - attribute doesn't exist
logger._logger.info("message")  # AttributeError!
```

### Health Auto-Resolve Thresholds
<!-- Updated: 2026-02-06 -->
- `ALERT_DRIFT_MS = 5000` — drift above this triggers LOGGING_HIGH_DRIFT alarm
- Auto-resolve after exactly 3 consecutive healthy checks (drift < 5000ms)
- Uses `== 3` guard (not `>= 3`) so resolve fires once on transition, not every cycle
- Uses `resolve_alarms_by_type()` for bulk resolution + cloud resync

### Modbus Transaction ID Mismatches
- pymodbus `transaction_id` errors (e.g., "request ask for transaction_id=X but got id=1") are normal with TCP Modbus gateways
- Typically <0.01% of reads — no fix needed unless frequency increases significantly
- Caused by gateway counter resets or TCP connection reuse

### Orphan Alarm Auto-Resolution
When alarm registers are removed from config:
- Config sync compares old vs new alarm definition IDs
- Missing definitions = orphaned alarm types
- `resolve_alarms_by_type()` called for each orphaned type
- Log indicator: `[CONFIG] Auto-resolved X orphan alarm(s): alarm_id`

### SSH Tunnel Recovery (CRITICAL)
<!-- Updated: 2026-02-02 -->
- Tunnel watchdog runs every minute via cron (`/usr/local/bin/tunnel-watchdog.sh`)
- **Process running ≠ tunnel working** — must check journalctl for "remote port forwarding failed"
- When WiFi drops and reconnects, DO server may hold stale port in CLOSE_WAIT state
- Watchdog SSHes to DO server and runs `sudo fuser -k PORT/tcp` to clear stale port
- Manual recovery: `ssh root@159.223.224.203 "fuser -k 10000/tcp"` then restart tunnel on Pi
