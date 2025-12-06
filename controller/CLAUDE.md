# Controller - CLAUDE.md

## Purpose
Python-based on-site controller running on Raspberry Pi 5 that:
1. Reads data from load meters, DG controllers, and solar inverters
2. Calculates optimal solar power limit to prevent DG reverse feeding
3. Writes power limits to solar inverters
4. Logs data locally and syncs to cloud

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
- `storage/local_db.py` - SQLite operations
- `storage/cloud_sync.py` - Supabase sync

## Control Algorithm (Zero-Feeding)
```
load = sum(load_meter_readings)  # or calculated from DGs
available_headroom = load - DG_RESERVE
solar_limit = max(0, min(available_headroom, TOTAL_INVERTER_CAPACITY))
```

## Device Protocols
| Device | Protocol | Connection |
|--------|----------|------------|
| DG Controllers | Modbus TCP | Direct IP |
| Solar Inverters | Modbus RTU | Via Netbiter gateway |
| Load Meters | Modbus RTU | Via Netbiter gateway |

## Configuration Example
```yaml
control:
  interval_ms: 1000
  dg_reserve_kw: 50
  operation_mode: "zero_dg_reverse"

devices:
  load_meters:
    - name: "Load Meter A"
      template: "meatrol_me431"
      protocol: "rtu_gateway"
      gateway_ip: "192.168.1.1"
      slave_id: 2
```

## Important Notes
- DG reserve cannot be negative (min: 0 kW)
- Controller sends heartbeat to cloud every 5 minutes
- If offline, data piles up in SQLite and syncs on reconnect
- Command verification: reads back after writing to confirm
