"""
Device Service (Layer 3) - Modbus Communication

Responsibilities:
- Maintain Modbus connections (TCP and RTU gateway)
- Poll devices for readings at configured intervals
- Execute write commands (solar limit, etc.)
- Track device online/offline status
- Buffer readings for logging service
"""

from .service import DeviceService

__all__ = ["DeviceService"]
