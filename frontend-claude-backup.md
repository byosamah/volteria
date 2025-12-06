# Frontend Dashboard - CLAUDE.md

## Purpose
Next.js web dashboard for:
1. Monitoring site status in real-time
2. Managing projects and devices
3. Viewing logs and alarms
4. Configuring control settings
5. User management

## Technology Stack
| Component | Technology |
|-----------|------------|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| Auth | Supabase Auth |
| State | React Query / SWR |
| Hosting | DigitalOcean Droplet |

## Key Files
- `src/app/page.tsx` - Dashboard home
- `src/app/projects/` - Project management pages
- `src/app/devices/` - Device configuration pages
- `src/app/settings/` - Settings pages
- `src/components/` - Reusable components
- `src/lib/supabase.ts` - Supabase client

## Pages

### Dashboard (`/`)
- Overview of all sites
- Active alarms summary
- Quick status cards

### Projects (`/projects`)
- List of all projects/sites
- Create new project
- Project details with:
  - Control settings
  - Device list
  - Live monitoring
  - Historical data

### Devices (`/devices`)
- Device templates library
- Add/edit device configurations
- Protocol settings (TCP, RTU)

### Settings (`/settings`)
- User management
- System settings
- Templates management

## Components
- `ProjectCard` - Project status summary
- `DeviceStatus` - Real-time device status
- `AlarmBanner` - Active alarm display
- `DataChart` - Historical data visualization
- `ControlPanel` - Live control interface

## Authentication
- Login with Supabase Auth
- Role-based access control
- Protected routes by permission

## Real-Time Updates
- Supabase Realtime for live data
- Polling fallback for logs
- WebSocket for instant updates
