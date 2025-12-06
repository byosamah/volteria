# Frontend Dashboard - CLAUDE.md

## Purpose
Next.js 14 web dashboard for Volteria - Energy Management system providing:
1. User authentication (Supabase Auth)
2. Project/site management
3. Device configuration
4. Real-time monitoring dashboard
5. Alarms and logs viewing

## 🟢 Live URL
- **Production**: https://volteria.org
- **Local Dev**: http://localhost:3000

## Technology Stack
| Component | Technology |
|-----------|------------|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| UI Components | shadcn/ui |
| Auth | Supabase Auth |
| Database | Supabase (PostgreSQL) |
| Deployment | Docker + Nginx |

## Key Files
- `src/app/page.tsx` - Main dashboard
- `src/app/login/page.tsx` - Login page
- `src/app/projects/` - Project management
- `src/app/devices/` - Device configuration
- `src/app/settings/` - User settings
- `src/components/` - Reusable UI components
- `src/lib/supabase/` - Supabase client config

## Pages Structure
```
src/app/
├── page.tsx              # Dashboard (home)
├── login/page.tsx        # Login form
├── projects/
│   ├── page.tsx          # Projects list
│   ├── new/page.tsx      # Create project
│   └── [id]/page.tsx     # Project details
├── devices/page.tsx      # Device management
├── settings/page.tsx     # User settings
└── layout.tsx            # Root layout
```

## Components
- `components/layout/dashboard-layout.tsx` - Main layout with sidebar
- `components/ui/` - shadcn/ui components (Button, Card, Badge, etc.)

## Supabase Integration
```typescript
// Server-side client (for server components)
import { createClient } from "@/lib/supabase/server";
const supabase = await createClient();

// Client-side (for client components)
import { createClient } from "@/lib/supabase/client";
const supabase = createClient();
```

## Environment Variables

### ⚠️ CRITICAL: Build-Time Variables
Next.js bakes `NEXT_PUBLIC_*` variables at BUILD time, not runtime!

```env
# These must be passed as Docker build args
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
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

### Dockerfile
```dockerfile
# Build stage must receive and set these
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
```

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
npx shadcn@latest add badge
```

## Branding
- **Name**: Volteria - Energy Management
- **Logo**: `/public/logo.svg`
- **Colors**: Based on Tailwind defaults with green accent (#6baf4f)

## Authentication Flow
1. User visits `/login`
2. Enters email/password
3. Supabase Auth validates credentials
4. On success, redirects to dashboard (`/`)
5. Protected routes check auth via `supabase.auth.getUser()`

## Docker Build
```dockerfile
# Multi-stage build:
# 1. deps - Install dependencies
# 2. builder - Build Next.js app (bakes env vars)
# 3. runner - Production runtime (standalone output)
```

## Important Notes

1. **Standalone Output**: Next.js is configured for standalone output for Docker deployment.

2. **Server Components**: Most pages are server components that fetch data on the server.

3. **Health Check**: API health endpoint at `/api/health` for Docker health checks.

4. **Image Optimization**: Uses `next/image` for optimized images.
