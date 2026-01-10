"""
Logging Service (Layer 5) - Observability

Responsibilities:
- Receive and buffer control states
- Store to local SQLite database
- Sync to cloud in batches (every 2 minutes)
- Evaluate threshold alarms
- Track alarm cooldowns and deduplication
"""

from .service import LoggingService

__all__ = ["LoggingService"]
