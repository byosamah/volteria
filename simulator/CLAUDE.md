# Simulator - CLAUDE.md

## Purpose
Virtual testing environment for Volteria controller that simulates:
1. Diesel generators (ComAp InteliGen 500)
2. Solar inverters (Sungrow)
3. Load meters (Meatrol ME431)
4. Network communication (Modbus TCP/RTU)

## Why Use Simulator
- Test control logic without physical hardware
- Simulate various scenarios (high load, communication loss, etc.)
- Develop and debug safely before field deployment
- Validate zero-feeding algorithm
- Train new operators safely

## Key Files
- `virtual_site.py` - Complete site simulation
- `virtual_dg.py` - DG controller simulator
- `virtual_inverter.py` - Solar inverter simulator
- `virtual_meter.py` - Load meter simulator
- `scenarios/` - Pre-configured test scenarios
- `run_simulation.py` - Start simulation

## Simulated Devices

### Virtual DG (ComAp-like)
- Simulates generator output (active power, voltage, frequency)
- Responds to Modbus TCP requests
- Can simulate faults and communication loss
- Configurable rated power

### Virtual Inverter (Sungrow-like)
- Accepts power limit commands (0-100%)
- Simulates actual power output based on limit
- Supports command verification (read-back)
- Simulates PV irradiance variations

### Virtual Load Meter (Meatrol-like)
- Simulates 3-phase power readings
- Responds to Modbus RTU requests
- Configurable load profiles
- Can simulate load fluctuations

## Scenarios
| Scenario | Description |
|----------|-------------|
| `normal_operation.py` | Steady load with solar contribution |
| `high_load.py` | Load exceeds solar capacity |
| `communication_loss.py` | Simulate device offline |
| `rapid_changes.py` | Fast load fluctuations |
| `morning_ramp.py` | Solar ramp-up at sunrise |
| `cloud_passing.py` | Intermittent solar dips |

## Usage
```bash
# Start simulator with default config
python run_simulation.py

# Run with specific scenario
python run_simulation.py --scenario high_load

# Run controller against simulator
python ../controller/main.py --config simulator_config.yaml

# Run both together
python run_simulation.py &
python ../controller/main.py --config simulator_config.yaml
```

## Modbus Addresses (Same as Real Devices)
| Device | Port | Protocol | Address |
|--------|------|----------|---------|
| Virtual DGs | 502 | Modbus TCP | 127.0.0.1:502 |
| Virtual Inverter | 502 | Modbus RTU via TCP | 127.0.0.1:502 |
| Virtual Meters | 502 | Modbus RTU via TCP | 127.0.0.1:502 |

## Simulator Configuration
```yaml
# simulator_config.yaml
site:
  name: "Simulated Site"

devices:
  dgs:
    - name: "Virtual DG-1"
      ip: "127.0.0.1"
      port: 502
      rated_kva: 800

  inverters:
    - name: "Virtual Solar"
      slave_id: 1
      rated_kw: 150

  meters:
    - name: "Virtual Load Meter"
      slave_id: 2

scenario:
  base_load_kw: 300
  solar_capacity_kw: 150
  load_variation_pct: 10
```

## Testing Zero-Feeding Algorithm
1. Start simulator with known load (e.g., 400 kW)
2. Set DG reserve (e.g., 50 kW)
3. Expected solar limit = 400 - 50 = 350 kW
4. If solar capacity is 150 kW, limit should be 100%
5. Verify inverter receives correct limit command

## Integration with Controller
The simulator uses the same Modbus registers as real devices, so the controller code works unchanged:

```
┌──────────────────┐    Modbus TCP/RTU    ┌──────────────────┐
│    Controller    │◄───────────────────►│    Simulator     │
│  (control_loop)  │                     │  (virtual_site)  │
└──────────────────┘                     └──────────────────┘
```

## Important Notes
- Simulator runs on localhost by default
- Use simulator_config.yaml for controller when testing
- All Modbus registers match real device specifications
- Time can be accelerated for faster testing
- Logs show all Modbus transactions for debugging
