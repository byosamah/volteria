# Volteria - Energy Management

> Industrial hybrid power management system for preventing reverse feeding to diesel generators

## Claude Workflow - IMPORTANT

### Database Access (Supabase) - USE THIS METHOD ALWAYS
Claude has **direct access** to the Supabase database via REST API. **NEVER ask the user to run migrations manually.**

**Method: REST API with curl** (works directly, no SSH needed):
```bash
# Query any table
curl -s "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/TABLE_NAME?select=*&limit=10" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzZ3hoemRjdHp0aGNxeHl4ZnhsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTAwOTQ2MywiZXhwIjoyMDgwNTg1NDYzfQ.4iKrB2pv7OVaKv_VY7QoyWQzSPuALcNPNJnD5S3Z74I" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzZ3hoemRjdHp0aGNxeHl4ZnhsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTAwOTQ2MywiZXhwIjoyMDgwNTg1NDYzfQ.4iKrB2pv7OVaKv_VY7QoyWQzSPuALcNPNJnD5S3Z74I"

# Insert data
curl -s -X POST "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/TABLE_NAME" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzZ3hoemRjdHp0aGNxeHl4ZnhsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTAwOTQ2MywiZXhwIjoyMDgwNTg1NDYzfQ.4iKrB2pv7OVaKv_VY7QoyWQzSPuALcNPNJnD5S3Z74I" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzZ3hoemRjdHp0aGNxeHl4ZnhsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTAwOTQ2MywiZXhwIjoyMDgwNTg1NDYzfQ.4iKrB2pv7OVaKv_VY7QoyWQzSPuALcNPNJnD5S3Z74I" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"column": "value"}'

# Update data
curl -s -X PATCH "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/TABLE_NAME?id=eq.UUID" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzZ3hoemRjdHp0aGNxeHl4ZnhsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTAwOTQ2MywiZXhwIjoyMDgwNTg1NDYzfQ.4iKrB2pv7OVaKv_VY7QoyWQzSPuALcNPNJnD5S3Z74I" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzZ3hoemRjdHp0aGNxeHl4ZnhsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTAwOTQ2MywiZXhwIjoyMDgwNTg1NDYzfQ.4iKrB2pv7OVaKv_VY7QoyWQzSPuALcNPNJnD5S3Z74I" \
  -H "Content-Type: application/json" \
  -d '{"column": "new_value"}'

# Delete data
curl -s -X DELETE "https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/TABLE_NAME?id=eq.UUID" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzZ3hoemRjdHp0aGNxeHl4ZnhsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTAwOTQ2MywiZXhwIjoyMDgwNTg1NDYzfQ.4iKrB2pv7OVaKv_VY7QoyWQzSPuALcNPNJnD5S3Z74I" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzZ3hoemRjdHp0aGNxeHl4ZnhsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTAwOTQ2MywiZXhwIjoyMDgwNTg1NDYzfQ.4iKrB2pv7OVaKv_VY7QoyWQzSPuALcNPNJnD5S3Z74I"
```

**Credentials** (stored in `.env`):
- **Supabase URL**: `https://usgxhzdctzthcqxyxfxl.supabase.co`
- **Service Key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzZ3hoemRjdHp0aGNxeHl4ZnhsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTAwOTQ2MywiZXhwIjoyMDgwNTg1NDYzfQ.4iKrB2pv7OVaKv_VY7QoyWQzSPuALcNPNJnD5S3Z74I`
- **Database Password**: `Solar@1996`

**For schema changes (CREATE/ALTER TABLE)**:
- Use Supabase Dashboard SQL Editor: https://supabase.com/dashboard/project/usgxhzdctzthcqxyxfxl/sql
- Create migration file in `database/migrations/` and run via dashboard

### Local Testing & Browser Automation - FULLY AUTOMATED
**Setup complete** - Claude can now run tests automatically.

**Claude runs these commands** (no user action needed):
```bash
# Set PATH for npm access
export PATH="$PATH:/c/Program Files/nodejs"

# Run build verification
cd /c/Users/Hp/volteria/frontend && npm run build

# Run browser tests
cd /c/Users/Hp/volteria/frontend && npm test
```

**What gets tested automatically**:
- ✅ TypeScript compilation (build)
- ✅ Login page loads correctly
- ✅ No console errors on key pages
- ✅ Static assets load properly
- ✅ Authenticated pages (if TEST_PASSWORD set)

**Test files location**: `frontend/tests/e2e/`
**Environment file**: `frontend/.env.local` (contains Supabase credentials)

**Test Account (superadmin)** - USE FOR ALL TESTING:
- Email: `mohkof1106@gmail.com`
- Password: `Solar@1996`

### Pre-Deploy Checklist
1. Run `npm run build` - catches TypeScript/build errors
2. Run `npm test` - catches runtime issues
3. Commit and push to GitHub
4. Deploy to production

### Production Deployment
```bash
# Deploy all changes
git add . && git commit -m "message" && git push origin main
# Then on server (via DigitalOcean console or user SSH):
cd /opt/solar-diesel-controller && git pull && docker-compose up -d --build

# Restart nginx if 502 errors
docker restart sdc-nginx
```

## Live Deployment
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
- **Hardware**: Raspberry Pi 5 with NVMe SSD (SOL564-NVME16-128)
- **Cloud Database**: Supabase (PostgreSQL)
- **Cloud Hosting**: DigitalOcean Droplet
- **Heartbeat**: Controller sends status every 30 seconds; frontend marks offline after 1 minute without heartbeat

## Approved Hardware Types
| Hardware ID | Description | Storage |
|-------------|-------------|---------|
| `SOL564-NVME16-128` | Raspberry Pi 5 - 16GB RAM + 128GB NVMe | NVMe SSD (boot from NVMe) |
| `raspberry_pi_5` | Raspberry Pi 5 (legacy, inactive) | microSD |

## Technology Stack

| Component | Technology | Version |
|-----------|------------|---------|
| Frontend | Next.js (App Router) | 16.0.7 |
| UI Library | React | 19.2.0 |
| Styling | Tailwind CSS | 4.x |
| Backend | FastAPI (Python) | 0.109.0 |
| Database | Supabase (PostgreSQL) | - |
| Controller | Python + pymodbus | 3.11+ |
| Containerization | Docker Compose | - |

## Architecture Overview

### Cloud Infrastructure
```
                    DigitalOcean Droplet (159.223.224.203)
                             Ubuntu 22.04

     +-------------+    +---------------------------+
     |   Nginx     |--->|  Next.js Frontend (:3000) |
     |   (SSL)     |    +---------------------------+
     |  Port 443   |    +---------------------------+
     |             |--->|  FastAPI Backend (:8000)  |
     +-------------+    +---------------------------+

     +-----------------------------------------------+
     |  Docker Compose (manages all services)        |
     +-----------------------------------------------+
                   |
                   v
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
- **FastAPI**: Backend API (9 routers, 77 endpoints)
- **Next.js 16**: Frontend dashboard (30+ pages)

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
- Option A: Load Meter(s) + Inverter (config_mode: meter_inverter)
- Option B: DG Controller(s) + Inverter (config_mode: dg_inverter)
- Option C: All devices (config_mode: full_system)

### Multi-Site Architecture
Projects can contain multiple **Sites**, each with:
- Own control settings (DG reserve, intervals, control method)
- Own devices (meters, inverters, DGs)
- Own master devices for control
- 7-step creation wizard in frontend

### Controller Setup Wizard
7-step wizard at `/admin/controllers/wizard` for registering and configuring new controller hardware:
| Step | Name | Description |
|------|------|-------------|
| 1 | Hardware Info | Enter serial number, select hardware type |
| 2 | Setup Instructions | Run setup script (NVMe boot instructions for NVMe hardware) |
| 3 | Flash Instructions | Guide through Balena Etcher flashing |
| 4 | Network Setup | Configure WiFi/Ethernet connection |
| 5 | Cloud Connection | Generate & download config.yaml |
| 6 | Verify Online | Wait for heartbeat (auto-detect) |
| 7 | Run Tests | Simulated device tests + DG zero feed logic |

**Features:**
- Save & Exit between steps (resume later)
- Status outcomes: "ready" if tests pass, "failed" if tests fail
- Simulated testing (no real hardware needed for verification)
- **NVMe Boot Support**: Step 2 shows NVMe-specific boot configuration when NVMe hardware is selected

### Project vs Site Settings
- **Project level**: Basic info only (name, location, description)
- **Site level**: All operational settings
  - Control method (onsite_controller, gateway_api) + backup method
  - Grid connection (off_grid, on_grid)
  - DG reserve, control intervals, operation mode
  - Logging settings (intervals, retention, cloud/gateway enabled)
  - Safe mode configuration (type, timeout, thresholds, power limit)

### Admin User Management
Admin panel at `/admin/users/` for managing users:
- **Create users**: Invite via email or direct creation with enterprise assignment
- **Edit users**: Update role, enterprise, status, profile
- **Project assignments**: Assign users to projects with can_edit/can_control permissions
- **Access levels**: super_admin, backend_admin, enterprise_admin can manage users

## Important Files
- `controller/config.yaml` - Site configuration
- `controller/control_loop.py` - Main control logic (888 lines)
- `controller/storage/` - Local DB, cloud sync, config sync
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

# Simulator (for testing without hardware)
cd simulator && python run_simulation.py
```

## Deployment Rules & Troubleshooting

### Pre-Deployment Checklist
1. **Commit all changes** before deploying
2. **Push to GitHub** - server pulls from origin
3. **Check current server state** if unsure: `docker-compose ps`

### Deployment Steps (In Order)
```bash
# Step 1: Commit and push
git add . && git commit -m "message" && git push origin main

# Step 2: Deploy to server
sshpass -p '@1996SolaR' ssh root@159.223.224.203 \
  "cd /opt/solar-diesel-controller && git pull && docker-compose up -d --build"

# Step 3: Verify deployment (wait ~2 min for build)
sshpass -p '@1996SolaR' ssh root@159.223.224.203 \
  "docker-compose -f /opt/solar-diesel-controller/docker-compose.yml ps"

# Step 4: If 502 errors, restart nginx
sshpass -p '@1996SolaR' ssh root@159.223.224.203 \
  "docker restart sdc-nginx"
```

### Post-Deployment Verification
| Check | Command | Expected |
|-------|---------|----------|
| All containers running | `docker-compose ps` | 3 containers (backend, frontend, nginx) |
| Backend healthy | Check STATUS column | `healthy` |
| Frontend responding | `curl -s localhost:3000/login` | HTTP 200 |
| Site accessible | Visit https://volteria.org | Login page loads |

### Known Issues & Fixes

#### 502 Bad Gateway
**Cause**: Nginx started before frontend was ready, or frontend container unhealthy
**Fix**:
```bash
docker restart sdc-nginx
```

#### Frontend Shows "unhealthy" But Works
**Cause**: Health check hits `/` which returns 307 redirect (not 200)
**Status**: Known issue, safe to ignore if `/login` returns 200
**Verify**:
```bash
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login
# Should return: 200
```

#### Build Takes Too Long (>5 min)
**Cause**: Server resource constraints
**Fix**: Wait for build to complete, don't interrupt

#### Container Won't Start
**Check logs**:
```bash
docker logs sdc-frontend --tail=50
docker logs sdc-backend --tail=50
```

### Emergency Recovery
If site is completely down:
```bash
# Full restart of all services
sshpass -p '@1996SolaR' ssh root@159.223.224.203 \
  "cd /opt/solar-diesel-controller && docker-compose down && docker-compose up -d --build"
```

### NEVER Do These
- Don't deploy during active user sessions if possible
- Don't interrupt a running build (causes corrupted images)
- Don't modify files directly on server (always deploy via git)
- Don't skip the nginx restart if you see 502 errors

## Database (Supabase)

### Migration Files (Run in Order)
| Order | File | Purpose |
|-------|------|---------|
| 1 | `001_initial_schema.sql` | Core tables (users, projects, devices) |
| 2 | `002_device_templates.sql` | Device templates (Sungrow, Meatrol, ComAp) |
| 3 | `003_sample_project.sql` | Sample data (optional) |
| 4 | `004_rls_policies.sql` | Row Level Security policies |
| 5 | `005_schema_fixes.sql` | Missing columns fixes |
| 6 | `006_config_sync_tracking.sql` | Configuration sync tracking |
| 7 | `007_enterprises.sql` | Enterprise/multi-tenant support |
| 8 | `008_approved_hardware.sql` | Hardware approval list |
| 9 | `009_controllers_master.sql` | Master controller registry |
| 10 | `010_user_roles_update.sql` | User role enhancements |
| 11 | `011_template_types.sql` | Template type classification |
| 12 | `012_avatar_support.sql` | User avatar/profile pictures |
| 13 | `013_sites_table.sql` | Sites within projects |
| 14a | `014_device_registers.sql` | Device register mappings |
| 14b | `014_uuid_passcodes.sql` | UUID-based access codes |
| 15 | `015_measurement_type.sql` | Measurement type classification |
| 16 | `016_site_control_method.sql` | Site-specific control methods |
| 17 | `017_site_master_devices.sql` | Master devices per site |
| 18 | `018_fix_users_updated_at.sql` | Users table updated_at fix |
| 19 | `019_hardware_detailed_specs.sql` | Detailed hardware specifications |
| 20 | `020_controller_status_lifecycle.sql` | Controller status lifecycle (draft→ready→claimed→deployed→eol) |
| 21 | `021_controller_wizard.sql` | Controller setup wizard tracking (wizard_step, test_results) |
| 22 | `022_notification_preferences.sql` | Notification preferences + notifications tables |
| 23 | `023_control_commands.sql` | Remote control command audit trail |
| 24 | `024_audit_logs.sql` | Comprehensive user action audit logs |
| 25 | `025_add_sol564_nvme_hardware.sql` | NVMe hardware type (SOL564-NVME16-128) |
| 26 | `026_alarms_threshold_type.sql` | Threshold alarm type support |
| 27 | `027_controller_restart.sql` | Controller restart tracking |
| 28 | `028_site_status_fields.sql` | Site status fields |
| 29 | `029_alarm_registers.sql` | Alarm registers |
| 30 | `030_device_alarm_registers.sql` | Device alarm registers |
| 31 | `031_per_project_alarm_notifications.sql` | Per-project alarm notifications |
| 32 | `032_site_test_results.sql` | Site test results |
| 33 | `033_device_readings.sql` | Device readings table |
| 34 | `034_write_register_command.sql` | Write register command |
| 35 | `035_controller_templates.sql` | Controller templates with alarm definitions |
| 36 | `036_alarm_definitions_structure.sql` | Alarm definitions JSONB for device_templates |
| 37 | `037_site_alarm_overrides.sql` | Site-specific alarm threshold overrides |
| 38 | `038_calculated_fields.sql` | Calculated field definitions (totals, energy) |
| 39 | `039_usage_packages.sql` | Data usage packages |
| 40 | `040_usage_snapshots.sql` | Usage tracking snapshots |
| 41 | `041_api_request_logs.sql` | API request logging |
| 42 | `042_data_retention.sql` | Data retention policies |
| 43 | `043_site_dashboards.sql` | Site dashboards + widgets |
| 44 | `044_sensor_device_type.sql` | Sensor device type |
| 45 | `045_visualization_registers.sql` | Visualization register config |
| 46 | `046_controller_template_types.sql` | Controller template types |
| 47 | `047_reseed_device_templates.sql` | Reseed device templates |
| 48 | `048_fix_heartbeat_site_fk.sql` | Fix FK constraints for site/project deletion |
| 49 | `049_add_controller_template_to_master_devices.sql` | Add controller_template_id to site_master_devices |
| 50 | `050_project_devices_registers.sql` | Add registers, alarm_registers columns + make template_id nullable |
| 51 | `051_fix_device_templates_rls.sql` | Fix RLS policies for device_templates + add sensor subtypes to constraint |
| 52 | `052_enterprise_subscription_plan.sql` | Add subscription_plan column to enterprises (starter, advanced, pro) |
| 58 | `058_firmware_releases.sql` | OTA firmware releases for controller updates |
| 59 | `059_controller_updates.sql` | OTA update tracking per controller |
| 62 | `062_rename_project_devices.sql` | Rename project_devices to site_devices, drop project_id column |
| 68 | `068_controller_service_status.sql` | Per-service health tracking (5-layer architecture) |

### Core Tables
| Table | Purpose | RLS |
|-------|---------|-----|
| `users` | User accounts with roles | **Disabled** |
| `projects` | Site configurations | Enabled |
| `sites` | Sites within projects | Enabled |
| `site_devices` | Device connections per site | Enabled |
| `device_templates` | Reusable device definitions | Enabled |
| `control_logs` | Time-series data | Enabled |
| `alarms` | System alarms | Enabled |
| `user_projects` | User-project assignments | Enabled |
| `controller_heartbeats` | Controller status | Enabled |
| `enterprises` | Multi-tenant organizations | Enabled |
| `controllers_master` | Registered controller hardware | Enabled |
| `approved_hardware` | Hardware approval list | Enabled |
| `hardware_detailed_specs` | Device specifications | Enabled |
| `notification_preferences` | User notification settings | Enabled |
| `notifications` | In-app notification queue | Enabled |
| `control_commands` | Remote control audit trail | Enabled |
| `audit_logs` | User action audit logs | Enabled |
| `controller_templates` | Controller template definitions | Enabled |
| `site_alarm_overrides` | Site-specific alarm threshold overrides | Enabled |
| `calculated_field_definitions` | Calculated field formulas | Enabled |
| `site_dashboards` | Custom dashboards per site | Enabled |
| `dashboard_widgets` | Widget configurations for dashboards | Enabled |
| `usage_packages` | Data usage packages | Enabled |
| `usage_snapshots` | Usage tracking snapshots | Enabled |
| `api_request_logs` | API request logging | Enabled |
| `data_retention_policies` | Data retention rules | Enabled |
| `device_readings` | Device reading history | Enabled |
| `firmware_releases` | OTA firmware packages | Enabled |
| `controller_updates` | OTA update tracking | Enabled |
| `controller_service_status` | Per-service health (5-layer) | Enabled |

### User Roles (Hierarchy)
| Role | Level | Permissions |
|------|-------|-------------|
| Super Admin | 6 | All system access |
| Backend Admin | 5 | Backend management |
| Admin | 4 | Create users (except super), manage all projects |
| Enterprise Admin | 3 | Manage enterprise users and projects |
| Configurator | 2 | Edit assigned projects, remote control |
| Viewer | 1 | View logs, download data |

## New Features (Phase 1-5)

### Remote Control (`/projects/[id]/sites/[siteId]/control`)
- Power limit slider (0-100%) with quick presets
- DG reserve adjustment
- Emergency stop with confirmation dialog
- Command history with real-time updates
- Permission-gated (requires `can_control`)

### Reports & Analytics (`/projects/[id]/reports`)
- Energy consumption charts (daily/weekly/monthly)
- Peak load analysis by hour
- Efficiency metrics and solar utilization
- CSV data export (7d, 30d, 90d, all)

### Notification System
- In-app notification bell with real-time updates
- Notification preferences at `/settings/notifications`
- Email settings (critical, warning, info, daily summary)
- Quiet hours configuration

### Audit Logs (`/admin/audit-logs`)
- Complete user action history
- Filterable by user, category, status, date
- Detail view with old/new values
- CSV export capability
- Admin-only access

### Site Dashboard Enhancements
- Power flow chart with time range selector
- Safe mode status indicator
- Device health summary (online/offline counts)
- Config sync status with timestamps

### Controller Templates & Threshold Alarms (Phase 6)
Controller templates define alarm thresholds and calculated fields for Raspberry Pi controllers.

**Admin Page** (`/admin/controller-templates`):
- Super admin only access
- Create/edit/delete controller templates
- Define Modbus registers for logging
- Configure alarm definitions with threshold conditions
- Select calculated fields (Total Solar, Total Load, etc.)

**Site Alarm Configuration** (`/projects/[id]/sites/[siteId]/alarms`):
- View all alarms from controller and device templates
- Enable/disable alarms per site
- Override threshold conditions (e.g., change CPU temp warning from 70°C to 75°C)
- "Customized" badge shows when using non-default values
- "Reset to Default" to restore template settings
- Permission-gated (requires `can_edit`)

**Alarm Definition Structure**:
```typescript
interface AlarmDefinition {
  id: string;                    // "high_cpu_temp"
  name: string;                  // "High CPU Temperature"
  source_type: "device_info" | "modbus_register" | "calculated_field" | "heartbeat";
  source_key: string;            // "cpu_temp_celsius"
  conditions: AlarmCondition[];  // Threshold conditions
  enabled_by_default: boolean;
  cooldown_seconds: number;
}

interface AlarmCondition {
  operator: ">" | ">=" | "<" | "<=" | "==" | "!=";
  value: number;
  severity: "info" | "warning" | "major" | "critical";
  message: string;
}
```

**Calculated Fields**:
| Field | Type | Description |
|-------|------|-------------|
| `total_solar_kw` | sum | Sum of all inverter outputs |
| `total_load_kw` | sum | Sum of all load meters |
| `total_dg_kw` | sum | Sum of all DG outputs |
| `implied_dg_kw` | difference | Load - Solar (implied DG) |
| `daily_solar_kwh` | cumulative | Solar energy today |
| `daily_load_kwh` | cumulative | Load energy today |

### Site Dashboard System (Phase 7)
Custom dashboards with drag-drop widget placement for site monitoring.

**Dashboard Page** (`/projects/[id]/sites/[siteId]/dashboard`):
- Responsive grid-based canvas
- 6 widget types for data visualization
- Edit mode for widget positioning and configuration
- Live data polling every 5 seconds (pauses when tab hidden)

**Widget Types**:
| Type | Description |
|------|-------------|
| `value_display` | Single register value with unit and label |
| `chart` | Line/area/bar chart with time range selection |
| `icon` | Status icon with color thresholds |
| `status_indicator` | Online/offline device status |
| `alarm_list` | Recent alarms with severity filtering |
| `text` | Custom text/markdown display |

**Widget Configuration**:
Each widget has configurable properties:
- Position (row, column) and size (width, height)
- Data source (device, register)
- Display options (colors, thresholds, labels)
- Time ranges for charts (1h, 6h, 24h, 7d)

### Historical Data (Phase 7)
Historical data viewer for analyzing past readings.

**Historical Data Page** (`/historical-data`):
- Date range picker with presets (24h, 7d, 30d, custom)
- Device and register selection
- Data visualization with recharts
- CSV export with selected columns
- Smart polling with Page Visibility API

### Data Usage & Retention (Phase 7)
Data usage monitoring and retention policies.

**Admin Data Usage** (`/admin/data-usage`):
- Usage statistics per project/site
- Package management
- Retention policy configuration

## Environment Variables

### Required for Build (Next.js)
```
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Required for Runtime (Backend & Frontend API Routes)
```
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_KEY=your-service-key
```

## Important Notes

1. **Next.js Environment Variables**: `NEXT_PUBLIC_*` variables are baked at BUILD time, not runtime. Must be passed as Docker build args.

2. **Row Level Security**: The `users` table has RLS **DISABLED** to prevent infinite recursion. All other tables have RLS enabled with simple authenticated-user policies.

3. **Offline Operation**: Controller works fully independently without internet. Data buffers locally and syncs on reconnect.

4. **Database Migrations**: Always run migrations in order (001 through 048). See `database/migrations/` folder.

5. **httpx Version**: Backend requires `httpx==0.24.1` (newer versions break Supabase compatibility).

6. **Controller Heartbeats**: Heartbeats are tied to `controller_id`, NOT to sites/projects. Controllers show online/offline status independently of site assignment. Deleting a site/project sets `site_id`/`project_id` to NULL but preserves heartbeat history.

7. **Invite Flow**: User invites use URL fragments (`#access_token=...`), handled specially by the login page.
- NEVER EVER OVER ENGINEERING
- NEVER EVER HARDCODING
- NEVER EVER FALLBACK SYSTEM
- NEVER EVER CACHING