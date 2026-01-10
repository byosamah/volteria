"""
Config Service (Layer 2) - Configuration Management

Responsibilities:
- Fetch configuration from cloud (every 5 minutes)
- Maintain local cache for offline operation
- Version tracking and change detection
- Notify other services of config changes
"""

from .service import ConfigService

__all__ = ["ConfigService"]
