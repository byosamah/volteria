# Simulator - CLAUDE.md

## Purpose
Virtual testing environment for Volteria controller that simulates:
1. Diesel generators (ComAp InteliGen 500)
2. Solar inverters (Sungrow SG150KTL-M)
3. Load meters (Meatrol ME431)
4. Network communication (Modbus TCP/RTU)

## Why Use Simulator
- Test control logic without physical hardware
- Simulate various scenarios (high load, communication loss, etc.)
- Develop and debug safely before field deployment
- Validate zero-feeding algorithm
- Train new operators safely

## Key Files
```
simulator/
├── run_simulation.py          # Entry point & Modbus server (8,257 bytes)
├── virtual_site.py            # Complete site simulation (8,802 bytes)
├── virtual_dg.py              # DG controller simulator (7,006 bytes)
├── virtual_inverter.py        # Solar inverter simulator (10,700 bytes)
├── virtual_meter.py           # Load meter simulator (7,402 bytes)
├── requirements.txt           # Python dependencies
└── scenarios/                 # Test scenarios (placeholder - empty)
```

## Simulated Devices

### Virtual DG (ComAp-like)
- Simulates generator output (active power, voltage, frequency)
- Responds to Modbus TCP requests
- Can simulate faults and communication loss
- Configurable rated power (default: 800 kVA)

**Registers:**
| Register | Description | Unit |
|----------|-------------|------|
| 100 | Active Power | kW |
| 102 | Voltage L1 | V |
| 104 | Current L1 | A |
| 106 | Frequency | Hz |
| 108 | Running Hours | hours |
| 110 | Engine State | code (0=Off, 1=Running, 2=Fault) |
| 112 | GCB Status | code (0=Open, 1=Closed) |

### Virtual Inverter (Sungrow-like)
- Accepts power limit commands (0-100%)
- Simulates actual power output based on limit
- Supports command verification (read-back)
- Simulates PV irradiance variations
- Rated power: 150 kW (configurable)

**Registers:**
| Register | Description | Access |
|----------|-------------|--------|
| 5006 | Inverter Control | Write (0xCF=Start, 0xCE=Stop, 0xBB=E-Stop) |
| 5007 | Power Limit Enable | Write (0xAA=Enable, 0x55=Disable) |
| 5008 | Active Power Limit | Write (0-100%) |
| 5031 | Active Power Output | Read (0.1 kW scale) |
| 5038 | Inverter State | Read (code) |
| 5011 | AC Output Voltage | Read (0.1 V scale) |
| 5012 | AC Output Current | Read (0.1 A scale) |
| 5001 | DC Voltage | Read (0.1 V scale) |
| 5002 | DC Current | Read (0.01 A scale) |

### Virtual Load Meter (Meatrol-like)
- Simulates 3-phase power readings
- Responds to Modbus RTU requests
- Configurable load profiles
- Can simulate load fluctuations

**Registers:**
| Register | Description | Data Type |
|----------|-------------|-----------|
| 1000 | Voltage Phase A | float32 (V) |
| 1016 | Current Phase A | float32 (A) |
| 1032 | Total Active Power | float32 (W) |
| 1056 | Power Factor | float32 |
| 1066 | Grid Frequency | float32 (Hz) |

## Usage

### Start Simulator
```bash
# Default configuration
python run_simulation.py

# Set initial load (kW)
python run_simulation.py --load 300

# Set available solar (kW)
python run_simulation.py --solar 150

# Run specific scenario
python run_simulation.py --scenario high_load
```

### Run Controller Against Simulator
```bash
# Terminal 1: Start simulator
python run_simulation.py

# Terminal 2: Start controller with simulator config
python ../controller/main.py --config simulator_config.yaml
```

## Modbus Server Configuration

**Default Settings:**
| Parameter | Value |
|-----------|-------|
| Host | 0.0.0.0 (all interfaces) |
| Port | **5020** (non-standard to avoid conflicts) |
| Protocol | Modbus TCP |

> **Note**: The simulator uses port **5020** instead of the standard Modbus port 502 to avoid conflicts with other services.

## Default Site Configuration
```yaml
site:
  name: "Simulated Site"
  base_load_kw: 300
  solar_capacity_kw: 150
  load_variation_pct: 10

devices:
  load_meters:
    - name: "Load Meter A"
      slave_id: 2
    - name: "Load Meter B"
      slave_id: 3

  inverters:
    - name: "Virtual Solar"
      slave_id: 1
      rated_kw: 150

  dgs:
    - name: "Virtual DG-1"
      rated_kva: 800
    # ... up to 8 DGs
```

## Simulator Architecture

### SimulatorDataStore
- Maps Modbus slave IDs to virtual devices
- Routes Modbus requests to correct device
- Maintains energy balance: `load = dg_power + solar_power`

### SimulatorServer
- Starts Modbus TCP server on port 5020
- Creates slave contexts for each device
- Handles Modbus protocol layer
- Provides device identification metadata

### Energy Balance Logic
```python
# The simulation maintains energy balance
load = dg_power + solar_power

# When solar is limited:
available_solar = min(solar_capacity, solar_limit_pct * rated_power / 100)
dg_power = load - available_solar
```

## Scenarios

> **Note**: The `scenarios/` folder is currently a placeholder. Scenario files are planned but not yet implemented. You can simulate scenarios manually by adjusting parameters.

### Planned Scenarios
| Scenario | Description |
|----------|-------------|
| `normal_operation` | Steady load with solar contribution |
| `high_load` | Load exceeds solar capacity |
| `communication_loss` | Simulate device offline |
| `rapid_changes` | Fast load fluctuations |
| `morning_ramp` | Solar ramp-up at sunrise |
| `cloud_passing` | Intermittent solar dips |

### Manual Scenario Testing
```bash
# High load scenario (load > solar capacity)
python run_simulation.py --load 400 --solar 150

# Low load scenario (solar can cover everything)
python run_simulation.py --load 100 --solar 150

# Communication loss (stop/restart simulator)
# Controller should enter safe mode
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
┌──────────────────┐    Modbus TCP    ┌──────────────────┐
│    Controller    │◄────────────────►│    Simulator     │
│  (control_loop)  │    port 5020     │  (virtual_site)  │
└──────────────────┘                  └──────────────────┘
```

## Controller Configuration for Simulator
```yaml
# simulator_config.yaml
site:
  name: "Simulated Site"

devices:
  load_meters:
    - name: "Load Meter A"
      template: "meatrol_me431"
      protocol: "tcp"
      ip: "127.0.0.1"
      port: 5020           # Simulator port
      slave_id: 2

  inverters:
    - name: "Solar Inverter 1"
      template: "sungrow_150kw"
      protocol: "tcp"
      ip: "127.0.0.1"
      port: 5020           # Simulator port
      slave_id: 1
      rated_power_kw: 150

  generators:
    - name: "DG-1"
      template: "comap_ig500"
      protocol: "tcp"
      ip: "127.0.0.1"
      port: 5020           # Simulator port
      slave_id: 10

control:
  dg_reserve_kw: 50
  interval_ms: 1000
```

## Dependencies (requirements.txt)
```
pymodbus>=3.6.0
```

## Important Notes

1. **Port 5020**: Simulator uses non-standard port to avoid conflicts with real Modbus services.

2. **Same Registers**: All Modbus registers match real device specifications.

3. **Energy Balance**: Simulation maintains physical energy balance (load = DG + solar).

4. **Localhost Default**: Simulator runs on localhost by default for development.

5. **Modbus Logging**: Enable verbose logging to see all Modbus transactions for debugging.

6. **Time Acceleration**: Future feature - accelerate time for faster testing.

7. **Scenarios Placeholder**: The scenarios folder exists but contains no files yet. Manual parameter adjustment is the current method for scenario testing.
