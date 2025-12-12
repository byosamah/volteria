"""
Supabase Service

Handles connection to Supabase for:
- Database operations (PostgreSQL)
- Authentication (Supabase Auth)

This is the main integration point with Supabase.
All routers should use this service for database access.
"""

import os
from functools import lru_cache
from typing import Optional

from supabase import create_client, Client
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.

    Create a .env file with:
    - SUPABASE_URL=https://xxx.supabase.co
    - SUPABASE_SERVICE_KEY=your-service-role-key
    """
    supabase_url: str = ""
    # Accept both SUPABASE_KEY and SUPABASE_SERVICE_KEY
    supabase_service_key: str = ""

    @property
    def supabase_key(self) -> str:
        """Get the Supabase key (from SUPABASE_SERVICE_KEY env var)."""
        return self.supabase_service_key

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings."""
    return Settings()


class SupabaseService:
    """
    Supabase client wrapper.

    Provides methods for database operations.
    """

    def __init__(self):
        self._client: Optional[Client] = None

    @property
    def client(self) -> Client:
        """Get or create Supabase client."""
        if self._client is None:
            settings = get_settings()
            if not settings.supabase_url or not settings.supabase_key:
                raise ValueError(
                    "Supabase credentials not configured. "
                    "Set SUPABASE_URL and SUPABASE_KEY in .env file."
                )
            self._client = create_client(
                settings.supabase_url,
                settings.supabase_key
            )
        return self._client

    def is_connected(self) -> bool:
        """Check if Supabase connection is working."""
        try:
            # Simple query to test connection
            self.client.table("projects").select("id").limit(1).execute()
            return True
        except Exception:
            return False


# Singleton instance
supabase_service = SupabaseService()


def get_supabase() -> Client:
    """
    Dependency for getting Supabase client in routes.

    Usage:
        @router.get("/")
        async def my_route(db: Client = Depends(get_supabase)):
            result = db.table("projects").select("*").execute()
            return result.data
    """
    return supabase_service.client
