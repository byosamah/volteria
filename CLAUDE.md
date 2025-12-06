# Solar Diesel Hybrid Controller

## Project References
- Controller: ./controller/CLAUDE.md
- Backend API: ./backend/CLAUDE.md
- Frontend: ./frontend/CLAUDE.md
- Simulator: ./simulator/CLAUDE.md

## Quick Context
- Purpose: Prevent reverse feeding to diesel generators
- Algorithm: Zero-feeding with adjustable DG reserve (min: 0 kW)
- Hardware: Raspberry Pi 5 (current supported hardware)
- Cloud Database: Supabase (PostgreSQL)
- Cloud Hosting: DigitalOcean Droplet ($6-12/mo)
- Heartbeat: Controller sends status every 5 minutes

## Architecture Overview

### On-Site Controller (Raspberry Pi 5)
- Python 3.11+ with pymodbus
- SQLite for local data buffering
- YAML configuration files
- Runs control loop every 1 second (configurable)

### Cloud Platform
- **Supabase**: PostgreSQL database + Auth
- **DigitalOcean**: Hosting ($6-12/mo)
- **FastAPI**: Backend API
- **Next.js 14**: Frontend dashboard

## Key Concepts

### Operation Mode
Currently active: `zero_dg_reverse` (Off-grid - Solar & DG - Zero DG reverse feeding)
- Limits solar output to prevent reverse power flow to diesel generators
- DG reserve is configurable (minimum: 0 kW)

### Device Types
1. **Load Meters** - Measure total site load (e.g., Meatrol ME431)
2. **Solar Inverters** - PV output that can be limited (e.g., Sungrow SG150KTL-M)
3. **DG Controllers** - Monitor diesel generator output (e.g., ComAp InteliGen 500)

### Minimum Configurations
The system can work with:
- Option A: Load Meter(s) + Inverter
- Option B: DG Controller(s) + Inverter
- Option C: All devices (full system)

## Important Files
- `controller/config.yaml` - Site configuration
- `controller/control_loop.py` - Main control logic
- `controller/devices/` - Device handlers (Sungrow, Meatrol, ComAp)
- `simulator/` - Virtual testing environment
