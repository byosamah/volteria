"""
System Service (Layer 1) - Always Alive

Responsibilities:
- Send heartbeats every 30 seconds
- Monitor health of other services
- Handle OTA firmware updates
- Report system metrics (CPU, memory, disk, temp)
- Execute safe reboot commands
"""

from .service import SystemService

__all__ = ["SystemService"]
