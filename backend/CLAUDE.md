# Backend API - CLAUDE.md

## Purpose
FastAPI backend for Volteria - Energy Management platform providing:
1. User authentication and authorization (6 roles)
2. Project/site management with multi-site architecture
3. Device configuration and templates
4. Data retrieval (logs, alarms)
5. Remote control commands
6. Enterprise/multi-tenant management
7. Hardware specifications and approval
8. **Notification triggers** - Auto-create in-app notifications when alarms raised
9. **Audit logging** - Auto-log all modifying requests (POST/PATCH/PUT/DELETE)

## Live Deployment
- **Production**: https://volteria.org/api (via Nginx reverse proxy)
- **Server**: DigitalOcean Droplet (159.223.224.203:8000)
- **Docker**: Containerized with docker-compose

## Technology Stack
| Component | Technology | Version |
|-----------|------------|---------|
| Framework | FastAPI | 0.109.0 |
| Server | Uvicorn | 0.27.0 |
| Database | Supabase (PostgreSQL) | 2.0.0 |
| Auth | Supabase Auth | - |
| HTTP Client | httpx | 0.24.1 |
| Validation | Pydantic | 2.5.3 |
| Hosting | DigitalOcean Droplet | - |
| Container | Docker | - |

## Key Files
```
backend/
├── app/
│   ├── main.py                  # FastAPI app entry (222 lines)
│   ├── routers/                 # 9 API route handlers (77 endpoints total)
│   │   ├── auth.py              # Authentication & users (824 lines, 11 endpoints)
│   │   ├── projects.py          # Project CRUD (619 lines)
│   │   ├── sites.py             # Site management (712 lines)
│   │   ├── devices.py           # Device config (1,030 lines)
│   │   ├── controllers.py       # Controller mgmt (545 lines)
│   │   ├── enterprises.py       # Enterprise mgmt (518 lines)
│   │   ├── alarms.py            # Alarm endpoints (485 lines)
│   │   ├── logs.py              # Data logs (411 lines)
│   │   └── hardware.py          # Hardware specs (275 lines)
│   ├── services/
│   │   ├── supabase.py          # Supabase client (93 lines)
│   │   └── notifications.py     # Auto-create notifications on alarms
│   ├── middleware/
│   │   └── audit.py             # Audit logging middleware (logs all modifying requests)
│   ├── dependencies/
│   │   └── auth.py              # JWT & role validation
│   └── models/
│       └── __init__.py          # Pydantic models
├── requirements.txt             # Python dependencies
├── Dockerfile                   # Container definition
└── .env                         # Environment variables
```

## API Endpoints

### Authentication (`/api/auth/`)
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/login` | POST | User login, returns JWT tokens | No |
| `/logout` | POST | Sign out user | Yes |
| `/me` | GET | Current user info | Yes |
| `/users` | POST | Create new user (with enterprise_id) | Admin+ |
| `/users` | GET | List all users | Admin+ |
| `/users/{id}` | GET | Get specific user | Admin+ |
| `/users/{id}` | PATCH | Update user | Admin+ |
| `/users/{id}` | DELETE | Delete user | Super Admin |
| `/users/{id}/projects` | GET | Get user's project assignments | Admin+ |
| `/users/{id}/projects` | POST | Assign user to project | Admin+ |
| `/users/{id}/projects/{project_id}` | DELETE | Remove user from project | Admin+ |

### Projects (`/api/projects/`)
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/` | GET | List projects (filtered by access) | Yes |
| `/` | POST | Create project | Admin+ |
| `/{id}` | GET | Get project details | Yes |
| `/{id}` | PATCH | Update project settings | Configurator+ |
| `/{id}` | DELETE | Soft delete project | Admin+ |
| `/register-controller` | POST | Link hardware to project | Admin+ |
| `/heartbeat` | POST | Receive controller heartbeat | Controller |
| `/config` | GET | Download project config | Controller |

### Sites (`/api/sites/`)
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/` | GET | List all sites | Yes |
| `/` | POST | Create site | Admin+ |
| `/{id}` | GET | Get site details | Yes |
| `/{id}` | PATCH | Update site | Configurator+ |
| `/{id}` | DELETE | Delete site | Admin+ |
| `/project/{project_id}` | GET | List sites in project | Yes |

### Devices (`/api/devices/`)
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/templates` | GET | List all device templates | Yes |
| `/templates/{id}` | GET | Get specific template | Yes |
| `/templates` | POST | Create device template | Admin+ |
| `/project/{project_id}` | GET | List project devices | Yes |
| `/project/{project_id}` | POST | Add device to project | Configurator+ |
| `/project/{project_id}/{device_id}` | GET | Get device | Yes |
| `/project/{project_id}/{device_id}` | PATCH | Update device | Configurator+ |
| `/project/{project_id}/{device_id}` | DELETE | Remove device | Configurator+ |
| `/site/{site_id}` | GET | List site devices | Yes |
| `/site/{site_id}` | POST | Add device to site | Configurator+ |
| `/site/{site_id}/{device_id}/status` | POST | Update device status | Controller |

### Controllers (`/api/controllers/`)
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/` | GET | List controllers | Admin+ |
| `/` | POST | Register controller | Admin+ |
| `/{id}` | GET | Get controller | Yes |
| `/{id}` | PATCH | Update controller | Admin+ |
| `/{id}` | DELETE | Delete controller | Super Admin |
| `/claim` | POST | Claim controller by serial | Enterprise Admin+ |

### Enterprises (`/api/enterprises/`)
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/` | GET | List enterprises | Admin+ |
| `/` | POST | Create enterprise | Super Admin |
| `/{id}` | GET | Get enterprise | Admin+ |
| `/{id}` | PATCH | Update enterprise | Admin+ |
| `/{id}` | DELETE | Delete enterprise (hard) | Super Admin |
| `/{id}/users` | GET | List enterprise users | Enterprise Admin+ |

### Logs (`/api/logs/`)
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/{project_id}` | GET | Query control logs | Yes |
| `/{project_id}/push` | POST | Receive batch logs | Controller |
| `/{project_id}/stats` | GET | Get statistics | Yes |
| `/{project_id}/export` | GET | Export as CSV | Yes |

### Alarms (`/api/alarms/`)
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/` | GET | List all alarms | Yes |
| `/project/{project_id}` | GET | List project alarms | Yes |
| `/{id}` | GET | Get alarm details | Yes |
| `/{id}/acknowledge` | POST | Acknowledge alarm | Configurator+ |
| `/{id}/resolve` | POST | Resolve alarm | Configurator+ |

### Hardware (`/api/hardware/`)
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/` | GET | List approved hardware | Yes |
| `/` | POST | Add hardware | Super Admin |
| `/{id}` | GET | Get hardware details | Yes |
| `/{id}` | PATCH | Update hardware | Admin+ |
| `/{id}` | DELETE | Remove hardware | Super Admin |
| `/specs` | GET | List hardware specs | Yes |

### Health
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/` | GET | Root health check | No |
| `/health` | GET | Docker health check | No |

## User Roles & Hierarchy

```python
ROLE_HIERARCHY = {
    "viewer": 1,
    "configurator": 2,
    "enterprise_admin": 3,
    "admin": 4,
    "backend_admin": 5,
    "super_admin": 6
}
```

| Role | Level | Create Users | Projects | Remote Control | View Logs |
|------|-------|--------------|----------|----------------|-----------|
| Super Admin | 6 | All | All | Yes | Yes |
| Backend Admin | 5 | Admin- | All | Yes | Yes |
| Admin | 4 | Except super/backend | All | Yes | Yes |
| Enterprise Admin | 3 | Within enterprise | Enterprise | Yes | Yes |
| Configurator | 2 | No | Assigned only | Yes | Yes |
| Viewer | 1 | No | Assigned (read) | No | Yes |

## Database Tables (Supabase)

### Core Tables
- `users` - User accounts with roles (RLS **disabled**)
- `user_projects` - User-project assignments
- `projects` - Site configurations
- `sites` - Sites within projects
- `project_devices` - Device connections
- `device_templates` - Reusable device definitions

### Monitoring Tables
- `control_logs` - Time-series data from controllers
- `alarms` - System alarms
- `controller_heartbeats` - Controller status

### Notification & Audit Tables
- `notification_preferences` - User notification settings (email/in-app toggles)
- `notifications` - In-app notification queue (realtime via Supabase)
- `audit_logs` - All modifying actions logged automatically

### Enterprise Tables
- `enterprises` - Multi-tenant organizations
- `controllers_master` - Registered hardware
- `approved_hardware` - Hardware approval list
- `hardware_detailed_specs` - Device specifications

## Environment Variables
```env
# Required
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
ENVIRONMENT=production

# Optional (for CORS)
ALLOWED_ORIGINS=https://volteria.org,http://localhost:3000
```

## CORS Configuration
Production domains configured in `app/main.py`:
```python
origins = [
    "https://volteria.org",
    "https://www.volteria.org",
    "http://localhost:3000",    # Local development
    "http://127.0.0.1:3000",
]
# Can also be set via ALLOWED_ORIGINS env var (comma-separated)
```

## Docker Deployment
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app ./app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Health Check
Docker health check uses Python to verify API is responding:
```bash
python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
```

## Dependencies (requirements.txt)
```
# Web Framework
fastapi==0.109.0
uvicorn[standard]==0.27.0

# Database
supabase==2.0.0  # Pinned - 2.3.0 has gotrue compatibility issues
asyncpg==0.29.0

# Authentication
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4

# Validation
pydantic==2.5.3
pydantic-settings==2.1.0
email-validator==2.1.0

# HTTP Client
httpx==0.24.1  # CRITICAL: Must be <0.25.0 for Supabase

# Utilities
python-multipart==0.0.6
python-dotenv==1.0.0

# Testing
pytest==7.4.4
pytest-asyncio==0.23.3
```

**Important**: `httpx==0.24.1` is pinned because newer versions break Supabase compatibility.

## Development
```bash
# Install dependencies
pip install -r requirements.txt

# Run development server
uvicorn app.main:app --reload --port 8000

# Run with Docker
docker build -t sdc-backend .
docker run -p 8000:8000 sdc-backend
```

## Row Level Security (RLS)
Most Supabase tables have RLS enabled with policies:
- Users can only access their own data
- Project access based on `user_projects` assignments
- Super admins bypass all restrictions

**Critical Exception**: The `users` table has RLS **DISABLED** to prevent infinite recursion in RLS policies.

## Device Template System

### Two-Tier Architecture
1. **Device Templates** (Global, reusable)
   - Defined by admins
   - Include Modbus register mappings
   - Shared across all projects

2. **Project Devices** (Instance-specific)
   - Link template to project/site
   - Custom connection details (IP, port, slave ID)
   - Protocol: TCP, RTU Gateway, or Direct RTU

### Template Example
```json
{
  "template_id": "sungrow_150kw",
  "name": "Sungrow SG150KTL-M",
  "device_type": "inverter",
  "brand": "Sungrow",
  "model": "SG150KTL-M",
  "rated_power_kw": 150,
  "registers": [
    {"address": 5007, "name": "limit_switch", "type": "holding", "access": "write"},
    {"address": 5008, "name": "power_limit", "type": "holding", "access": "write"},
    {"address": 5031, "name": "active_power", "type": "input", "access": "read"}
  ]
}
```

### Modbus Conflict Validation
The API prevents duplicate Slave ID + connection combinations:
- Checks on device add and update
- Prevents same device from being configured twice
- Returns 409 Conflict if duplicate found

## Important Notes

1. **Controller Heartbeat**: Controllers send heartbeat every 5 minutes via `/api/projects/heartbeat`

2. **Batch Log Upload**: Controllers upload logs in batches via `/api/logs/{project_id}/push`

3. **Authentication Flow**:
   - Extract JWT from `Authorization: Bearer <token>` header
   - Verify with Supabase Auth
   - Fetch user data from `users` table
   - Check `is_active=True`

4. **Role-Based Access**: Use `require_role(roles)` dependency to restrict endpoints

5. **Project Access**: Use `require_project_access()` to check user has access to specific project

## New Features (Backend)

### Notification Triggers
**File**: `app/services/notifications.py`

When an alarm is created, a background task automatically:
1. Finds all users with access to the project (assigned + admins)
2. Checks each user's `notification_preferences`
3. Creates `notifications` records for users who want in-app alerts

```python
# Called from alarms.py after alarm insert
background_tasks.add_task(
    create_alarm_notifications,
    supabase,
    alarm_data,
    str(project_id)
)
```

### Audit Logging Middleware
**File**: `app/middleware/audit.py`

Automatically logs all POST/PATCH/PUT/DELETE requests to `audit_logs` table:
- Extracts user ID/email from JWT token
- Parses resource type/ID from URL path
- Records success/failed status based on response code
- Excludes `/health` and `/api/auth/*` endpoints
