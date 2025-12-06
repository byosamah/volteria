# Backend API - CLAUDE.md

## Purpose
FastAPI backend providing REST API for:
1. User authentication and authorization
2. Project/site management
3. Device configuration
4. Data retrieval (logs, alarms)
5. Remote control commands

## Technology Stack
| Component | Technology |
|-----------|------------|
| Framework | FastAPI (Python) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Hosting | DigitalOcean Droplet |

## Key Files
- `app/main.py` - FastAPI application entry
- `app/routers/auth.py` - Authentication endpoints
- `app/routers/projects.py` - Project management
- `app/routers/devices.py` - Device configuration
- `app/routers/logs.py` - Data retrieval
- `app/routers/alarms.py` - Alarm management
- `app/models/` - Pydantic models
- `app/services/` - Business logic

## API Endpoints

### Authentication
- `POST /auth/login` - Login
- `POST /auth/logout` - Logout
- `GET /auth/me` - Current user

### Projects
- `GET /projects` - List projects
- `POST /projects` - Create project
- `GET /projects/{id}` - Get project details
- `PUT /projects/{id}` - Update project
- `DELETE /projects/{id}` - Delete project

### Devices
- `GET /projects/{id}/devices` - List devices
- `POST /projects/{id}/devices` - Add device
- `PUT /devices/{id}` - Update device
- `DELETE /devices/{id}` - Remove device

### Logs & Alarms
- `GET /projects/{id}/logs` - Get control logs
- `GET /projects/{id}/alarms` - Get alarms
- `POST /alarms/{id}/acknowledge` - Acknowledge alarm

## User Roles
| Role | Permissions |
|------|-------------|
| Super Admin | All |
| Admin | Create users (except super), manage projects |
| Configurator | Edit assigned projects, remote control |
| Viewer | View logs, download data |

## Database Tables
- `users` - User accounts
- `projects` - Site configurations
- `project_devices` - Device connections
- `device_templates` - Reusable device definitions
- `control_logs` - Time-series data
- `alarms` - System alarms
