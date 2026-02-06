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
│               ├── dashboard/
│               │   ├── page.tsx           # Custom dashboard canvas
│               │   └── dashboard-canvas.tsx  # Canvas with widgets
│               ├── alarms/
│               │   ├── page.tsx       # Site alarm configuration
│               │   └── site-alarm-config.tsx  # Alarm override editor
│               ├── devices/
│               │   └── new/page.tsx   # Add device to site
│               └── master-devices/
│                   └── new/page.tsx   # Add master device
│
├── devices/page.tsx                   # Global device management
├── alarms/page.tsx                    # Alarms viewer with filtering
├── controllers/page.tsx               # My Controllers (enterprise users)
├── historical-data/page.tsx           # Historical data viewer
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
│   ├── data-usage/
│   │   ├── page.tsx                   # Data usage admin
│   │   ├── data-usage-list.tsx        # Usage list component
│   │   └── usage-chart.tsx            # Usage chart
│   └── audit-logs/page.tsx            # Audit logs dashboard (admin only)
│
├── debug/
│   └── auth/page.tsx                  # Debug auth endpoint
│
└── api/                               # Next.js API Routes (39 routes)
    ├── health/route.ts                # Health check endpoint
    ├── controllers/
    │   ├── heartbeats/route.ts        # Heartbeat polling for connection status
    │   ├── lookup/route.ts            # Lookup controller by serial
    │   ├── register/route.ts          # Register new controller
    │   └── [controllerId]/
    │       ├── config/route.ts        # Controller config
    │       ├── reboot/route.ts        # Reboot controller
    │       ├── registers/route.ts     # Controller registers
    │       ├── ssh-setup/route.ts     # SSH setup for controller
    │       ├── ssh/route.ts           # Execute SSH commands
    │       └── test/route.ts          # Run controller tests
    ├── dashboards/
    │   └── [siteId]/
    │       ├── route.ts               # Dashboard CRUD
    │       ├── live-data/route.ts     # Live data polling (5s)
    │       └── widgets/
    │           ├── route.ts           # Widget CRUD
    │           ├── [widgetId]/route.ts  # Single widget ops
    │           └── batch/route.ts     # Batch widget updates
    ├── historical/
    │   ├── route.ts                   # Historical data query (cloud)
    │   ├── local/route.ts             # Historical data (local SQLite via SSH)
    │   └── registers/route.ts         # Available registers for device
    ├── sites/
    │   └── [siteId]/
    │       ├── route.ts               # Site CRUD (DELETE bypasses RLS)
    │       ├── status/route.ts        # Site status
    │       ├── heartbeats/route.ts    # Site heartbeats
    │       ├── controller-health/route.ts  # Controller health
    │       ├── sync/route.ts          # Trigger config sync
    │       ├── sync-templates/route.ts # Sync device templates
    │       ├── template-sync-status/route.ts  # Template sync status
    │       └── test/route.ts          # Site tests
    ├── projects/
    │   └── [projectId]/
    │       └── status/route.ts        # Project status (online/offline counts)
    ├── devices/
    │   ├── [deviceId]/
    │   │   └── registers/route.ts     # Device registers
    │   ├── site/[siteId]/[deviceId]/
    │   │   ├── change-template/route.ts  # Change device template
    │   │   └── unlink-template/route.ts  # Unlink device from template
    │   └── templates/[templateId]/
    │       ├── usage/route.ts         # Template usage count
    │       └── duplicate/route.ts     # Duplicate template
    └── admin/
        ├── invite/route.ts            # Send email invitations
        └── users/
            ├── route.ts               # List users, create user
            └── [id]/
                ├── route.ts           # Get/Update/Delete user
                └── projects/
                    ├── route.ts       # List/Assign user projects
                    ├── [projectId]/route.ts  # Remove project assignment
                    └── [projectId]/notifications/route.ts  # Project notifications
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
- **Offline Threshold**: 1 minute (controller marked offline if no heartbeat in 1 min, heartbeats sent every 30 sec)
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
│   ├── project-status-badge.tsx       # Live status badge with polling
│   └── sync-status.tsx                # Sync status indicator (last sync time)
│
├── devices/
│   ├── device-list.tsx                # Project devices (with online status)
│   ├── device-templates-list.tsx      # Available templates
│   ├── master-device-list.tsx         # Master devices list
│   ├── master-device-template-form.tsx # Master device template editor
│   ├── master-device-templates-list.tsx # Master device templates list
│   ├── register-form.tsx              # Modbus register config
│   ├── template-form-dialog.tsx       # Create/edit template
│   ├── duplicate-template-dialog.tsx  # Template duplication dialog
│   ├── calculated-fields-form.tsx     # Calculated fields selector
│   ├── bit-mask-selector.tsx          # Bit mask configuration
│   ├── controller-readings-form.tsx   # Controller readings editor
│   ├── enumeration-editor.tsx         # Enumeration value mapping
│   └── group-combobox.tsx             # Device group selection
│
├── charts/                            # Recharts visualizations
│   ├── power-flow-chart.tsx           # Live power flow (1h/6h/24h/7d)
│   ├── energy-consumption-chart.tsx   # Daily/weekly/monthly bars
│   └── peak-load-chart.tsx            # Hourly load analysis
│
├── sites/                             # Site-specific components
│   ├── safe-mode-status.tsx           # Safe mode indicator panel
│   ├── device-health-card.tsx         # Device online/offline summary
│   ├── calculated-fields-display.tsx  # Show computed calculated values
│   ├── controller-health-card.tsx     # Controller health display
│   ├── site-status-header.tsx         # Site status header
│   ├── site-test-button.tsx           # Site test trigger
│   └── site-test-modal.tsx            # Site test modal
│
├── control/                           # Remote control components
│   ├── remote-control-panel.tsx       # Power limit slider, DG reserve
│   ├── command-history.tsx            # Command audit trail
│   ├── emergency-stop-card.tsx        # Emergency stop button
│   └── device-registers-panel.tsx     # Device registers display
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
│   ├── control-logs-viewer.tsx        # Control logs viewer
│   └── control-logs-tab-trigger.tsx   # Tab trigger with badge
│
├── dashboard/                         # Dashboard widgets
│   ├── alarm-list-widget.tsx          # Recent alarms widget
│   ├── chart-widget.tsx               # Chart widget (line/area/bar)
│   ├── icon-widget.tsx                # Status icon widget
│   ├── status-indicator-widget.tsx    # Online/offline indicator
│   ├── value-display-widget.tsx       # Single value display
│   ├── text-widget.tsx                # Text/markdown widget
│   ├── widget-config-dialog.tsx       # Widget configuration dialog
│   └── widget-picker.tsx              # Widget type selector
│
├── historical/
│   ├── historical-data-client.tsx     # Legacy historical viewer
│   └── v2/                            # Historical V2 (server-side aggregation)
│       ├── HistoricalDataClientV2.tsx # Main orchestrator
│       ├── HistoricalChart.tsx        # Recharts visualization
│       ├── ChartOverlay.tsx           # DOM overlay for performance (accounts for right Y-axis width)
│       ├── OverlayTooltip.tsx         # Positioned tooltip with site/device hierarchy
│       ├── ParameterSelector.tsx      # Device/register selection
│       ├── ParameterCard.tsx          # Parameter card with site/device info
│       ├── AvailableParametersList.tsx # Register list with loading state
│       ├── AdvancedOptions.tsx        # Reference lines and calculated fields
│       ├── AxisDropZone.tsx           # Drag-and-drop axis management
│       ├── AggregationSelector.tsx    # Raw/Hourly/Daily selector
│       ├── DateRangeSelector.tsx      # Calendar with presets
│       ├── ControlsRow.tsx            # All controls in single row
│       ├── constants.ts               # MAX_DATE_RANGE, colors
│       └── types.ts                   # TypeScript interfaces
│
├── alarms/
│   ├── alarms-viewer.tsx              # Alarms with resolve functionality
│   ├── alarm-condition-builder.tsx    # Threshold condition editor
│   ├── alarm-definition-form.tsx      # Alarm definition editor
│   └── index.ts                       # Component exports
│
├── users/                             # User management components
│   └── user-notification-settings.tsx # Per-user notification settings
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
// See frontend/src/lib/device-constants.ts for canonical list
type DeviceType =
  | "inverter" | "wind_turbine" | "bess"
  | "gas_generator_controller" | "diesel_generator_controller"
  | "energy_meter" | "capacitor_bank"
  | "fuel_level_sensor" | "fuel_flow_meter"
  | "temperature_humidity_sensor" | "solar_radiation_sensor" | "wind_sensor"
  | "other_hardware"
  // Legacy (still valid): "load_meter" | "dg" | "sensor"

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
                 "not_reporting" | "controller_offline" | "write_failed" |
                 "command_not_taken" | "threshold_alarm"
type AlarmSeverity = "info" | "warning" | "minor" | "major" | "critical"

interface Alarm {
  id, project_id, alarm_type, device_name, message, severity,
  acknowledged, acknowledged_by, acknowledged_at,
  resolved, resolved_at, created_at
}
```

### Alarm & Template Types
```typescript
// Alarm Definition Types
type AlarmSourceType = "modbus_register" | "device_info" | "calculated_field" | "heartbeat"
type ThresholdOperator = ">" | ">=" | "<" | "<=" | "==" | "!="

interface AlarmCondition {
  operator: ThresholdOperator
  value: number
  severity: AlarmSeverity
  message: string
}

interface AlarmDefinition {
  id: string
  name: string
  description: string
  source_type: AlarmSourceType
  source_key: string
  conditions: AlarmCondition[]
  enabled_by_default: boolean
  cooldown_seconds: number
}

// Controller Template Types
interface ControllerTemplate {
  id: string
  template_id: string
  name: string
  controller_type: "raspberry_pi" | "gateway" | "plc"
  hardware_type_id: string | null
  registers: ModbusRegister[]
  alarm_definitions: AlarmDefinition[]
  calculated_fields: string[]  // IDs of selected calculated fields
  is_active: boolean
}

// Site Alarm Override Types
interface SiteAlarmOverride {
  id: string
  site_id: string
  source_type: "controller_template" | "device_template" | "device"
  source_id: string
  alarm_definition_id: string
  enabled: boolean | null
  conditions_override: AlarmCondition[] | null
  cooldown_seconds_override: number | null
}

// Calculated Field Types
type CalculationType = "sum" | "difference" | "cumulative" | "average" | "max" | "min"
type TimeWindow = "hour" | "day" | "week" | "month" | "year"

interface CalculatedFieldDefinition {
  field_id: string
  name: string
  scope: "controller" | "device"
  calculation_type: CalculationType
  time_window: TimeWindow | null
  unit: string
  is_system: boolean
}
```

## Feature Pages

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

## Alarm Configuration

### Site Alarm Configuration (`/projects/[id]/sites/[siteId]/alarms`)
Site-level alarm customization page:
- **Stats Cards**: Total alarms, customized count, sources count
- **Alarm Sources**: Grouped by controller template and device templates
- **Per-Alarm Controls**:
  - Enable/disable toggle
  - Threshold conditions preview (colored badges)
  - Edit Thresholds button → opens condition builder dialog
  - Reset to Default button (appears when customized)
  - "Customized" badge when overrides exist
- **Permissions**: Only users with `can_edit` can modify

### Alarm Components
Reusable components for alarm management:
- **`alarm-condition-builder.tsx`**: Row-based condition editor
  - Operator selector (>, >=, <, <=, ==, !=)
  - Value input (number)
  - Severity selector with color coding
  - Message input
  - Add/remove condition buttons
- **`alarm-definition-form.tsx`**: Full alarm definition editor
  - Collapsible card layout
  - Basic info (ID, name, description)
  - Source configuration (type, key)
  - Conditions builder integration
  - Enable/disable and cooldown settings

### Calculated Fields Components
- **`calculated-fields-form.tsx`**: Template field selector
  - Grouped by scope (controller/device)
  - Checkbox selection with descriptions
  - Shows calculation type and time window badges
- **`calculated-fields-display.tsx`**: Site dashboard widget
  - Grid layout with computed values
  - Unit display and last updated timestamp
  - Compact mode for sidebars

## Dashboard & Historical Data

### Site Dashboard System (`/projects/[id]/sites/[siteId]/dashboard`)
Custom dashboards with drag-drop widget placement:
- **Dashboard Canvas**: Responsive grid-based layout
- **Edit Mode**: Toggle to position and configure widgets
- **Live Data Polling**: 5-second updates with Page Visibility API (pauses when tab hidden)
- **Widget Types**: 6 types (value, chart, icon, status, alarm list, text)
- **Widget Config**: Per-widget settings for data source, colors, thresholds

### Dashboard Widgets
| Widget Type | Component | Description |
|-------------|-----------|-------------|
| `value_display` | `value-display-widget.tsx` | Single register value with unit |
| `chart` | `chart-widget.tsx` | Line/area/bar chart with time range |
| `icon` | `icon-widget.tsx` | Status icon with color thresholds |
| `status_indicator` | `status-indicator-widget.tsx` | Online/offline device status |
| `alarm_list` | `alarm-list-widget.tsx` | Recent alarms with severity filter |
| `text` | `text-widget.tsx` | Custom text/markdown display |
| `gauge` | `gauge-widget.tsx` | Gauge with dial/bar/thermometer/tank styles |
| `cable` | `cable-widget.tsx` | SVG cable connector with animated flow |

### Cable Widget Details
- **Path styles**: Straight, curved, orthogonal (right-angle)
- **Thickness options**: Thin (2px), Medium (5px), Thick (10px)
- **Animation**: Configurable flow speed (slow/medium/fast) with direction based on data sign
- **Edit mode**: Draggable endpoints, click-away deselection, midpoint indicator
- **Coordinate system**: SVG viewBox (100 units per grid cell) for stable positioning

### Historical Data V2 (`/historical-data`)
Multi-site historical data viewer with server-side aggregation:

**Features**:
- **Multi-Site Comparison**: Add parameters from multiple projects/sites on same chart (cloud only)
- **Server-Side Aggregation**: RPC function aggregates data in database (bypasses max_rows)
- **Aggregation Levels**: Raw (30d cloud / 1h local), Hourly (90d), Daily (2yr)
- **Auto-Selection**: System auto-selects aggregation based on date range
- **DOM Overlay**: Performance-optimized hover/zoom (no re-renders)
- **Dual Y-Axis**: Left/right axis support with different units
- **CSV Export**: Export with UTC + local timezone columns
- **No Browser Caching**: Refresh/Plot always fetch fresh data
- **Register Caching**: In-memory cache for fast device switching
- **Local Source**: Single-site only, 1h max for raw, 30d for aggregated

**Components** (`frontend/src/components/historical/v2/`):
| Component | Purpose |
|-----------|---------|
| `HistoricalDataClientV2.tsx` | Main orchestrator component |
| `HistoricalChart.tsx` | Recharts visualization (no mouse handlers) |
| `ChartOverlay.tsx` | DOM overlay for hover/drag interactions |
| `OverlayTooltip.tsx` | Positioned tooltip with site/device hierarchy |
| `ParameterSelector.tsx` | Device + register selection |
| `AvailableParametersList.tsx` | Register list with loading state + local site blocking |
| `ParameterCard.tsx` | Parameter card with site/device info |
| `AggregationSelector.tsx` | Raw/Hourly/Daily + Avg/Min/Max selector |
| `DateRangeSelector.tsx` | Calendar picker with presets |
| `ControlsRow.tsx` | All controls in single row |
| `constants.ts` | MAX_DATE_RANGE, COLOR_PALETTE |
| `types.ts` | TypeScript interfaces |

**API Route**: `GET /api/historical?siteIds=...&deviceIds=...&aggregation=auto`

### Project Status Badge
Live status polling component showing online/offline site counts:
- **`project-status-badge.tsx`**: Aggregated status for project cards
- **30-second polling**: Pauses when tab hidden
- **Visual States**: Pulsing green dot (online), gray dot (offline)
- **API**: `GET /api/projects/[projectId]/status`

### Performance Optimizations
- **React.memo**: Memoized widgets prevent unnecessary re-renders
- **Page Visibility API**: All polling pauses when tab is hidden
- **aria-expanded**: Proper accessibility attributes on hamburger menu

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

7. **BACKEND_URL**: Required in frontend container for API routes that call backend (e.g., sync-templates). Set to `http://backend:8000` in docker-compose.

8. **Device Template Linkage**: When editing a device with a template:
   - Template registers are fetched **live** from the template (not stale copies)
   - Manual registers come from the device's stored data
   - Template registers display as read-only with "Template" badge
   - Manual registers are editable with "Manual" badge

9. **Template Edit Warning**: When editing a template with connected devices:
   - Yellow warning banner shows connected device/site count
   - Confirmation dialog appears on save
   - Uses `/api/devices/templates/{id}/usage` endpoint

10. **Alarm States**: Alarms have 3 states: Active → Acknowledged → Resolved. Both `/alarms` page and site-level `AlarmsViewer` must show all states consistently with matching UI (badge colors, action buttons, filters).

11. **RLS Bypass for Write Operations**: When RLS blocks INSERT/UPDATE/DELETE, create a frontend API route (`/api/resource/route.ts`) that calls the backend with the user's session token. Backend uses service_role to bypass RLS. Pattern: site deletion (`/api/sites/[siteId]`), site creation (`/api/sites`).

12. **Recharts ResponsiveContainer**: Never use `height="100%"` in flex containers - causes "width(-1) height(-1)" warning because flex layout isn't computed on first render. Use calculated pixel height based on parent grid dimensions instead.

13. **Recharts Y-axis Domain Fallback**: If Y-axis domain shows `['dataMin', 'dataMax']`, it means domain calculation found no valid numeric values - check if data is null/sparse.

14. **Chart Downsampling with Sparse Data**: When downsampling multi-parameter chart data, preserve timestamps where sparse parameters have values - uniform step sampling can completely miss infrequently-logged registers.

15. **Recharts Time-Based X-Axis**: Recharts X-axis is categorical by default (evenly spaced data points). For time-proportional charts, use `scale="time"` `type="number"` with numeric timestamps (ms) - otherwise periods with few data points appear compressed regardless of actual duration.

16. **Downsampling Must Preserve Critical Points**: When downsampling chart data, preserve critical state-change points (e.g., offline markers with `status === 0`) - uniform step sampling can remove important events that should always be visible.

17. **Time-Series Window Start Detection**: Time-series charts must detect gaps at window START (startTime to first data point), not just between consecutive points - otherwise offline/gap periods at the beginning of the view are invisible.
