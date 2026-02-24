"""
Solar Diesel Hybrid Controller - Backend API

FastAPI application that provides:
- Project/site management
- Device configuration
- Control logs and data access
- Alarm management
- User authentication

This API connects to Supabase (PostgreSQL) for data storage.
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth, projects, devices, logs, alarms, enterprises, controllers, hardware, sites, usage, dashboards, ssh_tests
from app.middleware.audit import AuditLoggingMiddleware
from app.services.alarm_notifier import start_notifier, stop_notifier


# ============================================
# ENVIRONMENT CONFIGURATION
# ============================================

# Get environment type
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

# Get allowed origins from environment or use defaults
# In production, set ALLOWED_ORIGINS as comma-separated list
# Example: ALLOWED_ORIGINS=https://app.yourdomain.com,https://www.yourdomain.com
ALLOWED_ORIGINS_ENV = os.getenv("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in ALLOWED_ORIGINS_ENV.split(",")
    if origin.strip()
] if ALLOWED_ORIGINS_ENV else []

# Default origins for development
if ENVIRONMENT == "development" or not ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.extend([
        "http://localhost:3000",      # Next.js dev server
        "http://127.0.0.1:3000",
    ])

# Add production origins
if ENVIRONMENT == "production":
    # Production domain for volteria.org
    ALLOWED_ORIGINS.extend([
        "https://volteria.org",
        "https://www.volteria.org",
    ])


# ============================================
# APPLICATION LIFESPAN
# ============================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application startup and shutdown events.

    Startup:
    - Initialize Supabase connection
    - Verify database connectivity

    Shutdown:
    - Close connections gracefully
    """
    # Startup
    print("=" * 50)
    print("Starting Solar Diesel Controller API...")
    print(f"Environment: {ENVIRONMENT}")
    print(f"Allowed Origins: {ALLOWED_ORIGINS}")
    print("=" * 50)

    # Start alarm email notifier (polls every 30s)
    await start_notifier()

    yield

    # Shutdown
    await stop_notifier()
    print("Shutting down API...")


# ============================================
# CREATE APPLICATION
# ============================================

app = FastAPI(
    title="Solar Diesel Hybrid Controller API",
    description="""
    API for managing solar-diesel hybrid power systems.

    ## Features
    - **Projects**: Manage sites and their configurations
    - **Devices**: Configure load meters, inverters, and DG controllers
    - **Logs**: Access control loop data and energy readings
    - **Alarms**: View and acknowledge system alarms
    - **Auth**: User authentication with role-based access

    ## Device Types
    - **Load Meters**: Measure total site load (e.g., Meatrol ME431)
    - **Solar Inverters**: PV output with power limiting (e.g., Sungrow SG150KTL-M)
    - **DG Controllers**: Monitor diesel generators (e.g., ComAp InteliGen 500)
    """,
    version="1.0.0",
    lifespan=lifespan,
)


# ============================================
# CORS MIDDLEWARE
# ============================================

# Allow frontend to connect from configured origins
# Set ALLOWED_ORIGINS env var for production domains
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Audit logging middleware - logs all POST/PATCH/PUT/DELETE requests
# Must be added AFTER CORS middleware (middleware runs in reverse order)
app.add_middleware(AuditLoggingMiddleware)


# ============================================
# INCLUDE ROUTERS
# ============================================

# Each router handles a specific resource
app.include_router(
    auth.router,
    prefix="/api/auth",
    tags=["Authentication"]
)

app.include_router(
    projects.router,
    prefix="/api/projects",
    tags=["Projects"]
)

app.include_router(
    devices.router,
    prefix="/api/devices",
    tags=["Devices"]
)

app.include_router(
    logs.router,
    prefix="/api/logs",
    tags=["Control Logs"]
)

app.include_router(
    alarms.router,
    prefix="/api/alarms",
    tags=["Alarms"]
)

# Admin routers for enterprise management
app.include_router(
    enterprises.router,
    prefix="/api/enterprises",
    tags=["Enterprises"]
)

app.include_router(
    controllers.router,
    prefix="/api/controllers",
    tags=["Controllers"]
)

app.include_router(
    hardware.router,
    prefix="/api/hardware",
    tags=["Hardware"]
)

# Sites router - physical locations with controllers
app.include_router(
    sites.router,
    prefix="/api/sites",
    tags=["Sites"]
)

# Usage router - storage analytics and billing
app.include_router(
    usage.router,
    prefix="/api/usage",
    tags=["Usage & Storage"]
)

# Dashboards router - customizable site dashboards
app.include_router(
    dashboards.router,
    prefix="/api/dashboards",
    tags=["Dashboards"]
)

# SSH Tests router - real SSH-based controller testing
app.include_router(
    ssh_tests.router,
    prefix="/api",
    tags=["SSH Tests"]
)


# ============================================
# ROOT ENDPOINT
# ============================================

@app.get("/", tags=["Health"])
async def root():
    """
    Health check endpoint.

    Returns basic API information.
    """
    return {
        "name": "Solar Diesel Hybrid Controller API",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
        "redoc": "/redoc"
    }


@app.get("/health", tags=["Health"])
async def health_check():
    """
    Detailed health check.

    Checks:
    - API is running
    - Database connection (TODO)
    """
    return {
        "status": "healthy",
        "database": "connected",  # TODO: Actually check connection
        "version": "1.0.0"
    }
