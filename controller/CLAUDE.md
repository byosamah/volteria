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
| Modbus | pymodbus 3.x |
| Local DB | SQLite3 |
| Scheduler | asyncio |
| Config | YAML files |

## Key Files
- `main.py` - Entry point
- `config.yaml` - Site configuration (devices, settings)
- `control_loop.py` - Main control logic
- `modbus_client.py` - Modbus TCP/RTU communication
- `devices/` - Device-specific handlers
  - `base.py` - Base device class
  - `sungrow.py` - Sungrow inverter handler
  - `comap.py` - ComAp DG handler
  - `meatrol.py` - Meatrol meter handler
- `storage/local_db.py` - SQLite operations
- `storage/cloud_sync.py` - Supabase sync

## Control Algorithm (Zero-Feeding)
```python
# Core algorithm
load = sum(load_meter_readings)  # or calculated from DGs
available_headroom = load - DG_RESERVE
solar_limit = max(0, min(available_headroom, TOTAL_INVERTER_CAPACITY))
```

## Device Protocols
| Device | Protocol | Connection |
|--------|----------|------------|
| DG Controllers | Modbus TCP | Direct IP (e.g., 192.168.1.30:502) |
| Solar Inverters | Modbus RTU | Via Netbiter gateway |
| Load Meters | Modbus RTU | Via Netbiter gateway |

## Configuration Example
```yaml
site:
  name: "Stone Crushing Site 1"
  location: "UAE"

control:
  interval_ms: 1000              # Control loop frequency
  dg_reserve_kw: 50              # Minimum DG reserve (min: 0)
  operation_mode: "zero_dg_reverse"

logging:
  local_interval_ms: 1000        # Log locally every 1 second
  cloud_sync_interval_ms: 5000   # Push to cloud every 5 seconds
  local_retention_days: 7

devices:
  load_meters:
    - name: "Load Meter A"
      template: "meatrol_me431"
      protocol: "rtu_gateway"
      gateway_ip: "192.168.1.1"
      slave_id: 2

  inverters:
    - name: "Solar Inverter 1"
      template: "sungrow_150kw"
      protocol: "rtu_gateway"
      gateway_ip: "192.168.1.1"
      slave_id: 1

  generators:
    - name: "DG-1"
      template: "comap_ig500"
      protocol: "tcp"
      ip: "192.168.1.30"
      port: 502
      slave_id: 1

cloud:
  supabase_url: "https://xxx.supabase.co"
  supabase_key: "your-service-role-key"
  sync_enabled: true
```

## Heartbeat & Status
- Controller sends **heartbeat signal every 5 minutes** to cloud
- Status is automatically determined:
  - `online` - Heartbeat received (green signal)
  - `offline` - Heartbeat missed (triggers alarm)
  - `error` - Controller has errors

## Command Verification
After writing to inverter, controller verifies command was accepted:
1. Write command to register
2. Wait 200ms
3. Read back the value
4. Compare written vs read (allow 1% tolerance)
5. If mismatch, trigger `COMMAND_NOT_TAKEN` alarm

## Safe Mode
Optional protection when communication is lost:

**Type 1: Time-based**
- Stops solar if no communication for X seconds

**Type 2: Rolling Average**
- Only triggers if BOTH conditions met:
  1. Solar avg > 80% of load (high reverse risk)
  2. Device stopped communicating for X seconds

## Offline Operation
- Control logic runs **fully locally** - no cloud dependency
- SQLite buffers data when offline (7+ days retention)
- Auto-syncs when connection restored
- No data gaps - timestamps preserved

## Important Notes
- DG reserve cannot be negative (min: 0 kW)
- Controller is registered with unique serial number
- Each site has one registered controller
- Works independently of Volteria cloud platform
