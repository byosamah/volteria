# Simulator - CLAUDE.md

## Purpose
Virtual testing environment that simulates:
1. Diesel generators (ComAp InteliGen 500)
2. Solar inverters (Sungrow)
3. Load meters (Meatrol ME431)
4. Network communication (Modbus TCP/RTU)

## Why Use Simulator
- Test control logic without physical hardware
- Simulate various scenarios (high load, communication loss, etc.)
- Develop and debug safely before field deployment
- Validate zero-feeding algorithm

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

### Virtual Inverter (Sungrow-like)
- Accepts power limit commands (0-100%)
- Simulates actual power output based on limit
- Supports command verification (read-back)

### Virtual Load Meter (Meatrol-like)
- Simulates 3-phase power readings
- Responds to Modbus RTU requests
- Configurable load profiles

## Scenarios
- `normal_operation.py` - Steady load with solar contribution
- `high_load.py` - Load exceeds solar capacity
- `communication_loss.py` - Simulate device offline
- `rapid_changes.py` - Fast load fluctuations

## Usage
```python
# Start simulator
python run_simulation.py

# Run with specific scenario
python run_simulation.py --scenario high_load

# Run controller against simulator
python ../controller/main.py --config simulator_config.yaml
```

## Modbus Addresses (Same as Real Devices)
| Device | Port | Protocol |
|--------|------|----------|
| Virtual DGs | 502 | Modbus TCP |
| Virtual Inverter | 502 | Modbus RTU via TCP |
| Virtual Meters | 502 | Modbus RTU via TCP |
