# Controller - CLAUDE.md

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

Every 5 minutes:
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
- Heartbeat every 5 minutes

## Heartbeat & Status
- Controller sends **heartbeat signal every 5 minutes** to cloud
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
