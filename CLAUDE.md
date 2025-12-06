# Volteria - Energy Management

> Industrial hybrid power management system for preventing reverse feeding to diesel generators

## 🟢 Live Deployment
- **URL**: https://volteria.org
- **Server**: DigitalOcean Droplet (159.223.224.203)
- **GitHub**: https://github.com/byosamah/volteria (public)

## Project References
- Controller: ./controller/CLAUDE.md
- Backend API: ./backend/CLAUDE.md
- Frontend: ./frontend/CLAUDE.md
- Simulator: ./simulator/CLAUDE.md
- Documentation: ./docs/CLAUDE.md

## Quick Context
- **Purpose**: Prevent reverse feeding to diesel generators
- **Algorithm**: Zero-feeding with adjustable DG reserve (min: 0 kW)
- **Hardware**: Raspberry Pi 5 (current supported hardware)
- **Cloud Database**: Supabase (PostgreSQL)
- **Cloud Hosting**: DigitalOcean Droplet
- **Heartbeat**: Controller sends status every 5 minutes

## Architecture Overview

### Cloud Infrastructure
```
┌─────────────────────────────────────────────────────────────┐
│              DigitalOcean Droplet (159.223.224.203)         │
│                       Ubuntu 22.04                          │
│                                                             │
│  ┌─────────────┐    ┌─────────────────────────────┐        │
│  │   Nginx     │───▶│  Next.js Frontend (:3000)   │        │
│  │   (SSL)     │    └─────────────────────────────┘        │
│  │  Port 443   │    ┌─────────────────────────────┐        │
│  │             │───▶│  FastAPI Backend (:8000)    │        │
│  └─────────────┘    └─────────────────────────────┘        │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Docker Compose (manages all services)                  ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
         │
         ▼
   https://volteria.org
```

### On-Site Controller (Raspberry Pi 5)
- Python 3.11+ with pymodbus
- SQLite for local data buffering
- YAML configuration files
- Runs control loop every 1 second (configurable)

### Cloud Platform
- **Supabase**: PostgreSQL database + Auth + RLS
- **DigitalOcean**: Hosting (Droplet)
- **Docker**: Containerized deployment
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
- `docker-compose.yml` - Container orchestration
- `deploy/` - Nginx config, SSL, deployment scripts

## Deployment Commands

### Deploy to Production
```bash
# SSH to server and pull latest changes
sshpass -p '@1996SolaR' ssh root@159.223.224.203 \
  "cd /opt/solar-diesel-controller && git pull && docker-compose up -d --build"
```

### Local Development
```bash
# Frontend
cd frontend && npm run dev

# Backend
cd backend && uvicorn app.main:app --reload
```

## Database (Supabase)

### Migration Files (Run in Order)
| Order | File | Purpose |
|-------|------|---------|
| 1 | `database/migrations/001_initial_schema.sql` | Core tables |
| 2 | `database/migrations/005_schema_fixes.sql` | Missing columns |
| 3 | `database/migrations/004_rls_policies.sql` | RLS policies |
| 4 | `database/migrations/002_device_templates.sql` | Device templates |

### Core Tables
| Table | Purpose | RLS |
|-------|---------|-----|
| `users` | User accounts with roles | **Disabled** |
| `projects` | Site configurations | Enabled |
| `project_devices` | Device connections | Enabled |
| `device_templates` | Reusable device definitions | Enabled |
| `control_logs` | Time-series data | Enabled |
| `alarms` | System alarms | Enabled |
| `user_projects` | User-project assignments | Enabled |
| `controller_heartbeats` | Controller status | Enabled |

### User Roles
| Role | Permissions |
|------|-------------|
| Super Admin | All |
| Admin | Create users (except super), manage projects |
| Configurator | Edit assigned projects, remote control |
| Viewer | View logs, download data |

## Environment Variables

### Required for Build (Next.js)
```
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Required for Runtime (Backend)
```
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_KEY=your-service-key
```

## ⚠️ Important Notes

1. **Next.js Environment Variables**: `NEXT_PUBLIC_*` variables are baked at BUILD time, not runtime. Must be passed as Docker build args.

2. **Row Level Security**: The `users` table has RLS **DISABLED** to prevent infinite recursion. All other tables have RLS enabled with simple authenticated-user policies.

3. **Offline Operation**: Controller works fully independently without internet. Data buffers locally and syncs on reconnect.

4. **Database Migrations**: Always run migrations in order. See `database/migrations/` folder.
