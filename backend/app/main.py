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

from app.routers import auth, projects, devices, logs, alarms, enterprises, controllers, hardware, sites


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
    # TODO: Initialize Supabase client here

    yield

    # Shutdown
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
