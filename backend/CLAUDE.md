# Backend API - CLAUDE.md

## Purpose
FastAPI backend for Volteria - Energy Management platform providing:
1. User authentication and authorization
2. Project/site management
3. Device configuration
4. Data retrieval (logs, alarms)
5. Remote control commands

## 🟢 Live Deployment
- **Production**: https://volteria.org/api (via Nginx reverse proxy)
- **Server**: DigitalOcean Droplet (159.223.224.203:8000)
- **Docker**: Containerized with docker-compose

## Technology Stack
| Component | Technology |
|-----------|------------|
| Framework | FastAPI (Python) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Hosting | DigitalOcean Droplet |
| Container | Docker |

## Key Files
- `app/main.py` - FastAPI application entry
- `app/routers/auth.py` - Authentication endpoints
- `app/routers/projects.py` - Project management
- `app/routers/devices.py` - Device configuration
- `app/routers/logs.py` - Data retrieval
- `app/routers/alarms.py` - Alarm management
- `app/models/` - Pydantic models
- `app/services/` - Business logic
- `Dockerfile` - Container definition
- `requirements.txt` - Python dependencies

## API Endpoints

### Authentication
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/login` | POST | User login |
| `/auth/logout` | POST | User logout |
| `/auth/me` | GET | Current user info |

### Projects
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/projects` | GET | List all projects |
| `/projects` | POST | Create project |
| `/projects/{id}` | GET | Get project details |
| `/projects/{id}` | PUT | Update project |
| `/projects/{id}` | DELETE | Delete project |

### Devices
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/projects/{id}/devices` | GET | List devices |
| `/projects/{id}/devices` | POST | Add device |
| `/devices/{id}` | PUT | Update device |
| `/devices/{id}` | DELETE | Remove device |

### Logs & Alarms
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/projects/{id}/logs` | GET | Get control logs |
| `/projects/{id}/alarms` | GET | Get alarms |
| `/alarms/{id}/acknowledge` | POST | Acknowledge alarm |

### Health
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (for Docker) |

## User Roles & Permissions
| Role | Create Users | Projects | Remote Control | View Logs |
|------|--------------|----------|----------------|-----------|
| Super Admin | All | All | Yes | Yes |
| Admin | Except super | All | Yes | Yes |
| Configurator | No | Assigned | Yes | Yes |
| Viewer | No | Assigned (read) | No | Yes |

## Database Tables (Supabase)
- `users` - User accounts with roles
- `user_projects` - User-project assignments
- `projects` - Site configurations
- `project_devices` - Device connections
- `device_templates` - Reusable device definitions
- `control_logs` - Time-series data from controllers
- `alarms` - System alarms

## Environment Variables
```env
# Required
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
ENVIRONMENT=production
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

## CORS Configuration
Production domains are allowed in `app/main.py`:
```python
origins = [
    "https://volteria.org",
    "http://localhost:3000",  # Local development
]
```

## Health Check
Docker health check uses Python to verify API is responding:
```bash
python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
```

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
All Supabase tables have RLS enabled with policies:
- Users can only access their own data
- Project access based on `user_projects` assignments
- Super admins bypass all restrictions
