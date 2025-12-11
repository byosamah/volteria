# Documentation - CLAUDE.md

## Purpose
Project documentation for Volteria - Energy Management system including:
1. **Database setup guide** (migrations, tables, RLS)
2. Hardware setup guides
3. Modbus register references
4. Deployment instructions
5. Troubleshooting guides

## Live Deployment

### Production URLs
- **Web Dashboard**: https://volteria.org
- **API Backend**: https://volteria.org/api

### Server Details
- **Provider**: DigitalOcean Droplet
- **IP**: 159.223.224.203
- **OS**: Ubuntu 22.04
- **Services**: Docker, Nginx, Let's Encrypt SSL

### Deploy Command
```bash
sshpass -p '@1996SolaR' ssh root@159.223.224.203 \
  "cd /opt/solar-diesel-controller && git pull && docker-compose up -d --build"
```

---

## Database Setup (Supabase)

### Migration Files - Run in Order

| Order | File | Purpose |
|-------|------|---------|
| 1 | `001_initial_schema.sql` | Core tables (users, projects, devices, etc.) |
| 2 | `002_device_templates.sql` | Device templates (Sungrow, Meatrol, ComAp) |
| 3 | `003_sample_project.sql` | Sample project for testing (optional) |
| 4 | `004_rls_policies.sql` | Row Level Security policies |
| 5 | `005_schema_fixes.sql` | Missing columns fixes |
| 6 | `006_config_sync_tracking.sql` | Configuration sync tracking |
| 7 | `007_enterprises.sql` | Enterprise/multi-tenant support |
| 8 | `008_approved_hardware.sql` | Hardware approval list |
| 9 | `009_controllers_master.sql` | Master controller registry |
| 10 | `010_user_roles_update.sql` | User role enhancements (6 roles) |
| 11 | `011_template_types.sql` | Template type classification |
| 12 | `012_avatar_support.sql` | User avatar/profile pictures |
| 13 | `013_sites_table.sql` | Sites within projects (multi-site) |
| 14a | `014_device_registers.sql` | Device register mappings |
| 14b | `014_uuid_passcodes.sql` | UUID-based access codes |
| 15 | `015_measurement_type.sql` | Measurement type classification |
| 16 | `016_site_control_method.sql` | Site-specific control methods |
| 17 | `017_site_master_devices.sql` | Master devices per site |
| 18 | `018_fix_users_updated_at.sql` | Users table updated_at trigger fix |
| 19 | `019_hardware_detailed_specs.sql` | Detailed hardware specifications |
| 20 | `020_controller_status_lifecycle.sql` | Controller status lifecycle (draft→ready→claimed→deployed→eol) |
| 21 | `021_controller_wizard.sql` | Controller wizard tracking (wizard_step, test_results) |

### How to Run Migrations

1. Go to **Supabase Dashboard** > **SQL Editor**
2. Open each migration file in order (001 through 021)
3. Copy/paste and run each one
4. Verify tables in **Table Editor**

### Quick Setup (Fresh Install)

If starting fresh, run these in Supabase SQL Editor:

```sql
-- Step 1: Run 001_initial_schema.sql (creates all core tables)
-- Step 2: Run 005_schema_fixes.sql (adds missing columns)
-- Step 3: Run 004_rls_policies.sql (sets up RLS correctly)
-- Step 4: Run 002_device_templates.sql (adds device templates)
-- Step 5: Run remaining migrations 006-021 in order
```

### Database Tables

#### Core Tables
| Table | Purpose | RLS |
|-------|---------|-----|
| `users` | User accounts with roles | **Disabled** |
| `projects` | Site configurations | Enabled |
| `sites` | Sites within projects | Enabled |
| `project_devices` | Devices per project | Enabled |
| `device_templates` | Reusable device definitions | Enabled |
| `user_projects` | User-project assignments | Enabled |

#### Monitoring Tables
| Table | Purpose | RLS |
|-------|---------|-----|
| `control_logs` | Time-series data | Enabled |
| `alarms` | System alarms | Enabled |
| `controller_heartbeats` | Controller status | Enabled |

#### Enterprise Tables
| Table | Purpose | RLS |
|-------|---------|-----|
| `enterprises` | Multi-tenant organizations | Enabled |
| `controllers_master` | Registered hardware | Enabled |
| `approved_hardware` | Hardware approval list | Enabled |
| `hardware_detailed_specs` | Device specifications | Enabled |

### RLS Configuration

**CRITICAL**: The `users` table has RLS **DISABLED** to prevent infinite recursion.

All other tables have simple policies:
- Authenticated users can read all data
- Authenticated users can insert/update/delete
- Service role has full access

### User Roles (6 levels)
| Role | Level | Description |
|------|-------|-------------|
| `super_admin` | 6 | Full system access |
| `backend_admin` | 5 | Backend management |
| `admin` | 4 | Create users, manage all projects |
| `enterprise_admin` | 3 | Manage enterprise users & projects |
| `configurator` | 2 | Edit assigned projects, remote control |
| `viewer` | 1 | View logs, download data |

### Admin User Management
Access at `/admin/users/` for roles: super_admin, backend_admin, enterprise_admin
- Create users via invite email or direct creation
- Assign users to enterprises
- Manage project assignments with permissions (can_edit, can_control)
- Edit user profiles, roles, and status

---

## Troubleshooting

### Login Not Working (placeholder.supabase.co error)
**Cause**: Next.js bakes NEXT_PUBLIC_* at build time, not runtime
**Fix**: Pass as Docker build args:
```yaml
# docker-compose.yml
frontend:
  build:
    args:
      - NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
      - NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
```

### Infinite Recursion in RLS
**Error**: `infinite recursion detected in policy for relation "users"`
**Cause**: RLS policy on users table references itself
**Fix**: Run `004_rls_policies.sql` which disables RLS on users table

### Project Creation Fails (500 Error)
**Cause**: Missing RLS policies
**Fix**: Run `004_rls_policies.sql`

### Missing Column Errors
**Error**: `column "X" does not exist`
**Fix**: Run `005_schema_fixes.sql`

### Invite Email Not Working
**Cause**: Missing SUPABASE_SERVICE_KEY in frontend container
**Fix**: Add to docker-compose.yml frontend environment

### Invite Redirect Wrong Page
**Cause**: Supabase uses URL fragments (#access_token), not query params
**Fix**: The login page now detects and handles invite tokens in URL fragment

### SSH Access Denied
**Fix**: Use sshpass with password
```bash
brew install sshpass
sshpass -p 'password' ssh user@host
```

### GitHub Pull Fails on Server
**Cause**: Private repository
**Fix**: Make repository public or use deploy keys

### httpx Version Error
**Error**: `TypeError` or Supabase client issues
**Cause**: httpx version incompatibility
**Fix**: Pin `httpx==0.24.1` in requirements.txt

---

## Hardware Reference

### Raspberry Pi 5 (Current)
- **Order**: https://www.raspberrypi.com/products/raspberry-pi-5/
- **Accessories needed**:
  - Active Cooler (~$5)
  - Industrial enclosure (~$50-80)
  - USB-RS485 adapter (~$20)
  - 27W USB-C power supply

### Future Hardware (Planned)
- Elastel EG500 - Industrial-rated
- Revolution Pi RevPi - DIN rail certified

---

## Modbus Quick Reference

### Sungrow Inverter (SG150KTL-M)
| Register | Description | Access | Scale/Value |
|----------|-------------|--------|-------------|
| 5006 | Inverter Control | Write | 0xCF=Start, 0xCE=Stop, 0xBB=E-Stop |
| 5007 | Power Limit Enable | Write | 0xAA=Enable, 0x55=Disable |
| 5008 | Power Limit (%) | Write | 0-100 |
| 5011 | AC Output Voltage | Read | 0.1 V |
| 5012 | AC Output Current | Read | 0.1 A |
| 5031 | Active Power | Read | 0.1 kW |
| 5038 | Inverter State | Read | Code |
| 5001 | DC Voltage | Read | 0.1 V |
| 5002 | DC Current | Read | 0.01 A |

### Meatrol ME431
| Register | Description | Units | Data Type |
|----------|-------------|-------|-----------|
| 1000 | Voltage Phase A | V | float32 |
| 1016 | Current Phase A | A | float32 |
| 1032 | Total Active Power | W | float32 |
| 1056 | Power Factor | - | float32 |
| 1066 | Grid Frequency | Hz | float32 |

### ComAp InteliGen 500
| Register | Description | Units | Notes |
|----------|-------------|-------|-------|
| 100 | Generator Active Power | kW | Main power reading |
| 102 | Generator Voltage L1 | V | Phase voltage |
| 104 | Generator Current L1 | A | Phase current |
| 106 | Generator Frequency | Hz | Grid frequency |
| 108 | Running Hours | hours | Engine runtime |
| 110 | Engine State | code | 0=Off, 1=Running, 2=Fault |
| 112 | GCB Status | code | 0=Open, 1=Closed |

---

## Alarm Types

| Alarm Type | Severity | Description |
|------------|----------|-------------|
| `communication_lost` | Critical | Device stopped responding |
| `control_error` | Critical | Error in control logic |
| `safe_mode_triggered` | Warning | Safe mode activated |
| `not_reporting` | Warning | Device not sending data |
| `controller_offline` | Critical | Controller stopped heartbeat |
| `write_failed` | Critical | Modbus write failed |
| `command_not_taken` | Critical | Inverter rejected limit command |

---

## Key Documents

> **Note**: The following documentation files are planned but not yet created. Information is consolidated in CLAUDE.md files.

### hardware_setup.md (Planned)
- Raspberry Pi 5 setup instructions
- USB-RS485 adapter configuration
- Network setup

### modbus_registers.md (Planned)
- Complete register references for all devices
- Data types and scaling factors
- Read/write permissions

### deployment.md (Planned)
- Controller deployment to Raspberry Pi
- Cloud platform setup (Supabase + DigitalOcean)
- SSL certificate configuration
- Docker container management

---

## Control Algorithm Reference

### Zero-Feeding Algorithm
```python
# Core algorithm (simplified)
load = sum(load_meter_readings)           # Total site load
available_headroom = load - DG_RESERVE    # What solar can provide
solar_limit = min(available_headroom, TOTAL_INVERTER_CAPACITY)
solar_limit_pct = (solar_limit / capacity) * 100

# Write limit to inverter(s)
write_register(5007, 0xAA)  # Enable limiting
write_register(5008, solar_limit_pct)
```

### Safe Mode Triggers
1. **Time-based**: Device offline > X seconds
2. **Rolling Average**: Solar > 80% of load AND device offline

### Config Modes
| Mode | Required Devices |
|------|------------------|
| `meter_inverter` | Load Meter(s) + Inverter(s) |
| `dg_inverter` | DG Controller(s) + Inverter(s) |
| `full_system` | All devices |
