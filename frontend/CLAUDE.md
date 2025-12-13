# Frontend Dashboard - CLAUDE.md

## Purpose
Next.js 16 web dashboard for Volteria - Energy Management system providing:
1. User authentication (Supabase Auth with invite flow)
2. Project/site management with multi-site architecture
3. Device configuration and templates
4. Real-time monitoring dashboard with power flow charts
5. Alarms and control logs viewing with resolve functionality
6. Remote control panel (power limits, DG reserve, emergency stop)
7. Reports & analytics with data export
8. Notification system (in-app + email preferences)
9. Admin panel (enterprises, controllers, hardware, audit logs)

## Live URL
- **Production**: https://volteria.org
- **Local Dev**: http://localhost:3000

## Technology Stack
| Component | Technology | Version |
|-----------|------------|---------|
| Framework | Next.js (App Router) | 16.0.7 |
| UI Library | React | 19.2.0 |
| Language | TypeScript | 5.x |
| Styling | Tailwind CSS | 4.x |
| UI Components | shadcn/ui (Radix) | Latest |
| Charts | recharts | 2.x |
| Icons | lucide-react | 0.556.0 |
| Notifications | sonner | 2.0.7 |
| Auth | Supabase Auth (SSR) | 0.8.0 |
| Database | Supabase (PostgreSQL) | 2.86.2 |
| Deployment | Docker + Nginx | - |

## Key Files
- `src/app/` - App Router pages (30+ pages)
- `src/components/` - Reusable UI components (50+ total)
- `src/lib/supabase/` - Supabase client config (server, client)
- `src/lib/types.ts` - TypeScript type definitions
- `middleware.ts` - Auth middleware for route protection
- `next.config.ts` - Next.js configuration
- `Dockerfile` - Multi-stage Docker build

## Pages Structure
```
src/app/
├── page.tsx                           # Main dashboard (stats, projects, alarms)
├── layout.tsx                         # Root layout with providers
├── globals.css                        # Tailwind + custom styles
├── login/page.tsx                     # Login + invite token handling
│
├── auth/
│   ├── callback/page.tsx              # OAuth/magic link code exchange
│   └── set-password/page.tsx          # New user password setup (after invite)
│
├── projects/
│   ├── page.tsx                       # Projects list with search/filter
│   ├── new/page.tsx                   # Create new project
│   └── [id]/
│       ├── page.tsx                   # Project dashboard
│       ├── settings/page.tsx          # Project settings
│       ├── reports/page.tsx           # Reports & analytics dashboard
│       └── sites/
│           ├── new/page.tsx           # 7-step site creation wizard
│           │   └── steps/             # Wizard step components
│           └── [siteId]/
│               ├── page.tsx           # Site dashboard (with charts)
│               ├── settings/page.tsx  # Site settings
│               ├── control/page.tsx   # Remote control panel
│               ├── devices/
│               │   └── new/page.tsx   # Add device to site
│               └── master-devices/
│                   └── new/page.tsx   # Add master device
│
├── devices/page.tsx                   # Global device management
├── alarms/page.tsx                    # Alarms viewer with filtering
├── controllers/page.tsx               # My Controllers (enterprise users)
├── account/page.tsx                   # User profile & avatar
├── settings/
│   ├── page.tsx                       # User settings hub
│   └── notifications/page.tsx         # Notification preferences
├── claim/page.tsx                     # Controller claiming flow
│
├── admin/                             # Admin-only pages
│   ├── enterprises/
│   │   ├── page.tsx                   # Enterprise list
│   │   ├── loading.tsx                # Loading skeleton
│   │   └── [id]/page.tsx              # Enterprise details (cascade deletes users)
│   ├── controllers/
│   │   ├── page.tsx                   # Controller registry
│   │   ├── loading.tsx                # Loading skeleton
│   │   └── wizard/                    # Controller setup wizard (7 steps)
│   │       ├── page.tsx               # Wizard page route
│   │       ├── controller-wizard.tsx  # Main wizard component
│   │       └── steps/                 # Step components (1-7)
│   ├── users/                         # User management (super_admin, backend_admin, enterprise_admin)
│   │   ├── page.tsx                   # User list with CRUD, project assignments
│   │   └── loading.tsx                # Loading skeleton
│   ├── hardware/
│   │   ├── page.tsx                   # Approved hardware list with delete (super_admin)
│   │   └── loading.tsx                # Loading skeleton
│   └── audit-logs/page.tsx            # Audit logs dashboard (admin only)
│
├── debug/
│   └── auth/page.tsx                  # Debug auth endpoint
│
└── api/                               # Next.js API Routes (6 routes)
    ├── controllers/
    │   └── heartbeats/route.ts        # Heartbeat polling for connection status
    └── admin/
        ├── invite/route.ts            # Send email invitations
        └── users/
            ├── route.ts               # List users, create user
            └── [id]/
                ├── route.ts           # Get/Update/Delete user
                └── projects/
                    ├── route.ts       # List/Assign user projects
                    └── [projectId]/route.ts  # Remove project assignment
```

## Site Creation Wizard (7 Steps)
Located at `/projects/[id]/sites/new/`:
1. **Basic Info** - Name, location, description
2. **Control Method** - onsite_controller or gateway_api, backup method
3. **Grid & Operation** - Grid connection (off/on-grid), operation mode
4. **Control Settings** - DG reserve, control interval
5. **Logging Settings** - Intervals, retention, cloud/gateway toggles
6. **Safe Mode** - Enabled, type, timeout, thresholds, power limit
7. **Review & Create** - Summary and confirmation

## Controller Setup Wizard (7 Steps)
Located at `/admin/controllers/wizard/` - guides admins through physical setup of new controller hardware:

| Step | Component | Description |
|------|-----------|-------------|
| 1 | `step-hardware-info.tsx` | Serial number, hardware type, firmware version |
| 2 | `step-download-image.tsx` | Setup script + NVMe boot instructions (hardware-specific) |
| 3 | `step-flash-instructions.tsx` | Balena Etcher guide with visual steps |
| 4 | `step-network-setup.tsx` | Ethernet (recommended) or WiFi configuration |
| 5 | `step-cloud-connection.tsx` | Generate & download config.yaml |
| 6 | `step-verify-online.tsx` | Wait for heartbeat with auto-detect (5min timeout) |
| 7 | `step-run-tests.tsx` | Run 6 simulated tests + DG zero feed logic |

**Key Features:**
- **Save & Exit**: Progress saved between steps, can resume later
- **Progress Indicator**: Visual stepper showing completed/current/pending steps
- **Heartbeat Polling**: Step 6 polls for controller heartbeats every 5 seconds
- **Simulated Tests**: Tests run with simulated devices (no real hardware needed)
- **Status Outcomes**: "ready" if all tests pass, "failed" if any test fails
- **NVMe Boot Support**: Step 2 detects NVMe hardware types and shows 4-step NVMe boot configuration guide

**Database Columns** (added by `021_controller_wizard.sql`):
- `wizard_step` - Current step (1-7), NULL if complete
- `wizard_started_at` - When wizard was started
- `test_results` - JSONB with test results per category

## Site Settings Fields
Full list of editable fields in `/projects/[id]/sites/[siteId]/settings/`:
- **Basic**: name, location, description, controller_serial_number
- **Control Method**: control_method, control_method_backup
- **Grid/Operation**: grid_connection, operation_mode
- **Control**: dg_reserve_kw, control_interval_ms
- **Logging**: logging_local_interval_ms, logging_cloud_interval_ms, logging_local_retention_days, logging_cloud_enabled, logging_gateway_enabled
- **Safe Mode**: safe_mode_enabled, safe_mode_type, safe_mode_timeout_s, safe_mode_rolling_window_min, safe_mode_threshold_pct, safe_mode_power_limit_kw

## Dashboard Widgets
- **Controller Status**: Combined widget showing "X online - Y offline"
- Color coded: green for online, red for offline
- Same pattern on Dashboard (`/`) and Project Detail (`/projects/[id]`)

### Controller Master List (`/admin/controllers`)
Live connection status for all registered controllers:
- **Smart Polling**: Fetches heartbeats every 30 seconds (pauses when tab hidden via Page Visibility API)
- **Connection Column**: First column showing online/offline status
- **Visual Indicators**: Green pulsing dot (online), red dot (offline)
- **Refresh Button**: Manual refresh with spinning animation feedback
- **Offline Threshold**: 1 minute (controller marked offline if no heartbeat in 1 min)
- **API Route**: `GET /api/controllers/heartbeats` returns latest heartbeat timestamp per controller_id

## Components Structure
```
src/components/
├── layout/
│   ├── dashboard-layout.tsx           # Main layout with sidebar
│   ├── sidebar.tsx                    # Desktop navigation
│   ├── mobile-header.tsx              # Mobile hamburger + notification bell
│   ├── mobile-sidebar.tsx             # Mobile Sheet drawer
│   └── mobile-nav-context.tsx         # Mobile menu state
│
├── projects/
│   ├── project-card.tsx               # Project summary card
│   └── sync-status.tsx                # Sync status indicator (last sync time)
│
├── devices/
│   ├── device-list.tsx                # Project devices (with online status)
│   ├── device-templates-list.tsx      # Available templates
│   ├── master-device-list.tsx         # Master devices list
│   ├── register-form.tsx              # Modbus register config
│   └── template-form-dialog.tsx       # Create/edit template
│
├── charts/                            # Recharts visualizations
│   ├── power-flow-chart.tsx           # Live power flow (1h/6h/24h/7d)
│   ├── energy-consumption-chart.tsx   # Daily/weekly/monthly bars
│   └── peak-load-chart.tsx            # Hourly load analysis
│
├── sites/                             # Site-specific components
│   ├── safe-mode-status.tsx           # Safe mode indicator panel
│   └── device-health-card.tsx         # Device online/offline summary
│
├── control/                           # Remote control components
│   ├── remote-control-panel.tsx       # Power limit slider, DG reserve
│   ├── command-history.tsx            # Command audit trail
│   └── emergency-stop-card.tsx        # Emergency stop button
│
├── reports/                           # Reports components
│   ├── efficiency-metrics-card.tsx    # Solar utilization, safe mode %
│   └── export-data-button.tsx         # CSV export dropdown
│
├── notifications/                     # Notification components
│   └── notification-bell.tsx          # Real-time notification dropdown
│
├── audit/                             # Audit log components
│   └── audit-logs-table.tsx           # Filterable audit log table
│
├── monitoring/
│   ├── control-logs-table.tsx         # Power flow data table
│   └── live-power-display.tsx         # Real-time power gauge
│
├── logs/
│   └── control-logs-viewer.tsx        # Control logs viewer
│
├── alarms/
│   └── alarms-viewer.tsx              # Alarms with resolve functionality
│
└── ui/                                # 22 shadcn/ui components
    ├── alert-dialog.tsx
    ├── avatar.tsx
    ├── badge.tsx
    ├── button.tsx
    ├── card.tsx
    ├── checkbox.tsx
    ├── collapsible.tsx
    ├── dialog.tsx
    ├── dropdown-menu.tsx
    ├── input.tsx, label.tsx, select.tsx
    ├── separator.tsx, sheet.tsx
    ├── switch.tsx, table.tsx, tabs.tsx
    ├── textarea.tsx, tooltip.tsx
    └── formatted-date.tsx, sonner.tsx
```

## Authentication Flow

### Standard Login
1. User visits `/login`
2. Enters email/password
3. `supabase.auth.signInWithPassword()` called
4. On success, redirects to `/` dashboard
5. Middleware refreshes session on each request

### Invite Flow (Special Handling)
1. Super admin calls `POST /api/admin/invite` with email, role, enterprise_id
2. Supabase sends invite email with link to `/auth/set-password#access_token=...`
3. **Problem**: Supabase uses URL fragments, not query params
4. **Solution**: `/login` page detects `#access_token` in URL fragment:
   - Parses tokens from URL hash
   - Calls `supabase.auth.setSession()` to establish session
   - Cleans URL history
   - Redirects to `/auth/set-password`
5. User sets password on `/auth/set-password` page

### Middleware (`middleware.ts`)
- Runs on every request
- Handles `?code=` parameter from magic links/OAuth
- Exchanges code for session via `supabase.auth.exchangeCodeForSession()`
- Sets auth cookies
- Redirects to clean URL

## Supabase Integration

### Server Client (Server Components & API Routes)
```typescript
// src/lib/supabase/server.ts
import { createClient } from "@/lib/supabase/server";
const supabase = await createClient();

// Usage in server component
const { data: { user } } = await supabase.auth.getUser();
const { data } = await supabase.from("projects").select("*");
```

### Browser Client (Client Components)
```typescript
// src/lib/supabase/client.ts
import { createClient } from "@/lib/supabase/client";
const supabase = createClient();

// Usage in "use client" component
const { data, error } = await supabase.auth.signInWithPassword({ email, password });
```

## API Routes

### POST /api/admin/invite
Send email invitation to new user (super_admin only).
```typescript
// Request body
{
  email: string,
  role: "admin" | "configurator" | "viewer" | "enterprise_admin",
  enterprise_id?: string,
  full_name?: string
}

// Uses Supabase Admin API
// Redirects user to /auth/set-password
```

### POST /api/admin/users
User management operations.

## Mobile Responsiveness
The dashboard is fully mobile-responsive:
- **Mobile header**: Hamburger menu with Sheet drawer
- **Touch targets**: 44px minimum for all interactive elements
- **Viewport**: Uses `min-h-screen` for proper mobile handling
- **Layout**: `flex-col` on mobile, `flex-row` on desktop
- **Safe Area**: Proper padding for notched devices
- **Context**: `MobileNavProvider` manages menu state

## Environment Variables

### CRITICAL: Build-Time Variables
Next.js bakes `NEXT_PUBLIC_*` variables at BUILD time, not runtime!

```env
# Must be passed as Docker build args
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Runtime Variables (for API routes)
```env
# For admin operations (invite, user management)
SUPABASE_SERVICE_KEY=your-service-role-key
```

### Docker Build Args
```yaml
# docker-compose.yml
frontend:
  build:
    args:
      - NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
      - NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
```

## TypeScript Types (src/lib/types.ts)

### User Types
```typescript
type UserRole = "super_admin" | "backend_admin" | "admin" |
                "enterprise_admin" | "configurator" | "viewer"

interface User {
  id: string
  email: string
  role: UserRole
  full_name?: string
  phone?: string
  avatar_url?: string
  enterprise_id?: string
  is_active: boolean
  created_at: string
  last_login_at?: string
}
```

### Project & Site Types
```typescript
type ControllerStatus = "online" | "offline" | "error"
type OperationMode = "zero_dg_reverse" | "zero_dg_pf" | "zero_dg_reactive"
type SafeModeType = "time_based" | "rolling_average"
type ConfigMode = "meter_inverter" | "dg_inverter" | "full_system"

interface Project { id, name, location, description, ... }
interface Site { id, project_id, name, control_method, ... }
```

### Device Types
```typescript
type DeviceType = "inverter" | "dg" | "load_meter"
type Protocol = "tcp" | "rtu_gateway" | "rtu_direct"

interface DeviceTemplate { id, template_id, name, device_type, brand, model, ... }
interface ProjectDevice { id, project_id, template_id, name, protocol, ... }
interface ModbusRegister { address, name, type, access, datatype, scale, unit }
```

### Monitoring Types
```typescript
interface ControlLog {
  id, project_id, timestamp,
  total_load_kw, dg_power_kw, solar_output_kw, solar_limit_pct,
  safe_mode_active, config_mode,
  load_meters_online, inverters_online, generators_online
}

type AlarmType = "communication_lost" | "control_error" | "safe_mode_triggered" |
                 "not_reporting" | "controller_offline" | "write_failed" | "command_not_taken"
type AlarmSeverity = "info" | "warning" | "critical"

interface Alarm {
  id, project_id, alarm_type, device_name, message, severity,
  acknowledged, acknowledged_by, acknowledged_at,
  resolved, resolved_at, created_at
}
```

## New Features (Phase 1-5)

### Remote Control Panel (`/projects/[id]/sites/[siteId]/control`)
- **Power Limit Slider**: 0-100% with preset buttons (0, 25, 50, 75, 100)
- **DG Reserve Input**: Adjustable kW value
- **Emergency Stop**: Big red button with confirmation dialog
- **Resume Operations**: Green button to restore 100% power
- **Command History**: Real-time audit trail of all commands sent
- **Permission Check**: Only users with `can_control` permission can access

### Reports Dashboard (`/projects/[id]/reports`)
- **Summary Stats**: Avg load, solar, DG, solar utilization %
- **Energy Consumption Chart**: Daily/weekly/monthly bar chart
- **Peak Load Analysis**: Hourly load pattern area chart
- **Efficiency Metrics**: Solar utilization, safe mode frequency
- **Data Export**: CSV export with date range selection (7d, 30d, 90d, all)

### Notification System
- **Notification Bell**: Real-time dropdown in header with unread count
- **Preferences Page**: `/settings/notifications`
  - Email notifications (critical, warning, info, daily summary)
  - In-app notifications with sound toggle
  - Quiet hours configuration
- **Real-time Updates**: Supabase postgres_changes subscription

### Audit Logs (`/admin/audit-logs`)
- **Filterable Table**: Search, category, status, date range filters
- **Detail Dialog**: Full action details, old/new values, metadata
- **Export**: CSV export of filtered results
- **Pagination**: 20 items per page with navigation
- **Admin Only**: Accessible to super_admin, backend_admin, admin

### Admin Panel Features
- **Loading Skeletons**: All admin pages have `loading.tsx` files preventing UI flicker during navigation
- **Enterprise Deletion**: Cascade deletes all attached users (with warning showing user count)
- **User Deletion**: Optimistic UI update (instant removal from list)
- **Hardware Deletion**: Super admin only, requires:
  - Typing exact hardware name to confirm
  - Password verification
  - Checks if hardware is in use by controllers (blocks if in use)
  - Red warning banner explaining consequences

### Site Dashboard Enhancements
- **Power Flow Chart**: Live visualization (1h, 6h, 24h, 7d ranges)
- **Safe Mode Status**: Panel showing active state, configuration
- **Device Health Card**: Online/offline counts with progress bar
- **Sync Status**: Shows "Synced Xm ago" with tooltip

## Development

### Local Setup
```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

### Adding UI Components (shadcn/ui)
```bash
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add dialog
```

## Docker Build
```dockerfile
# Multi-stage build:
# 1. deps - Install dependencies
# 2. builder - Build Next.js app (bakes NEXT_PUBLIC_* vars)
# 3. runner - Production runtime (standalone output)
```

## Branding
- **Name**: Volteria - Energy Management
- **Logo**: `/public/logo.svg`
- **Colors**: Tailwind defaults with green accent (#6baf4f)

## Important Notes

1. **Standalone Output**: Next.js configured for standalone output for Docker deployment.

2. **Server Components**: Most pages are server components fetching data server-side.

3. **Invite Tokens**: Supabase invite links use URL fragments (`#access_token`), not query params. The login page handles this specially.

4. **Health Check**: API health at `/api/health` for Docker health monitoring.

5. **Image Optimization**: Uses `next/image` for optimized images.

6. **SUPABASE_SERVICE_KEY**: Required in frontend container for admin API routes.
