# Documentation - CLAUDE.md

## Purpose
Project documentation for Volteria - Energy Management system including:
1. Hardware setup guides
2. Modbus register references
3. Deployment instructions
4. **Database setup guide**
5. Troubleshooting guides

## 🟢 Live Deployment

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

### How to Run Migrations

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Open each migration file in order
3. Copy/paste and run each one
4. Verify tables in **Table Editor**

### Quick Setup (Fresh Install)

If starting fresh, run these in Supabase SQL Editor:

```sql
-- Step 1: Run 001_initial_schema.sql (creates all tables)
-- Step 2: Run 005_schema_fixes.sql (adds missing columns)
-- Step 3: Run 004_rls_policies.sql (sets up RLS correctly)
-- Step 4: Run 002_device_templates.sql (adds device templates)
```

### Database Tables

| Table | Purpose | RLS |
|-------|---------|-----|
| `users` | User accounts with roles | Disabled |
| `projects` | Site configurations | Enabled |
| `project_devices` | Devices per project | Enabled |
| `device_templates` | Reusable device definitions | Enabled |
| `user_projects` | User-project assignments | Enabled |
| `control_logs` | Time-series data | Enabled |
| `alarms` | System alarms | Enabled |
| `controller_heartbeats` | Controller status | Enabled |

### RLS Configuration

**CRITICAL**: The `users` table has RLS **DISABLED** to prevent infinite recursion.

All other tables have simple policies:
- Authenticated users can read all data
- Authenticated users can insert/update/delete
- Service role has full access

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

### SSH Access Denied
**Fix**: Use sshpass with password
```bash
brew install sshpass
sshpass -p 'password' ssh user@host
```

### GitHub Pull Fails on Server
**Cause**: Private repository
**Fix**: Make repository public or use deploy keys

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
| Register | Description | Access | Scale |
|----------|-------------|--------|-------|
| 5006 | Inverter Control | Write | 0xCF=Start, 0xCE=Stop |
| 5007 | Power Limit Enable | Write | 0xAA=Enable, 0x55=Disable |
| 5008 | Power Limit (%) | Write | 0-100 |
| 5031 | Active Power | Read | 0.1 kW |
| 5038 | Inverter State | Read | Code |

### Meatrol ME431
| Register | Description | Units | Data Type |
|----------|-------------|-------|-----------|
| 1000 | Voltage Phase A | V | float32 |
| 1016 | Current Phase A | A | float32 |
| 1032 | Total Active Power | W | float32 |
| 1056 | Power Factor | - | float32 |
| 1066 | Grid Frequency | Hz | float32 |

### ComAp InteliGen 500
- Registers TBD (need ComAp documentation)
- Uses GenConfig software for register mapping

---

## Key Documents

### hardware_setup.md
- Raspberry Pi 5 setup instructions
- USB-RS485 adapter configuration
- Network setup

### modbus_registers.md
- Complete register references for all devices

### deployment.md
- Controller deployment to Raspberry Pi
- Cloud platform setup (Supabase + DigitalOcean)
- SSL certificate configuration
