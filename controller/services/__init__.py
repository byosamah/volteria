"""
Volteria Controller Services

5-layer service architecture:
1. System Service - Heartbeat, OTA, health monitoring (Layer 1 - Always alive)
2. Config Service - Sync, caching, versioning (Layer 2)
3. Device Service - Modbus I/O, polling, writes (Layer 3)
4. Control Service - Zero-feeding algorithm (Layer 4)
5. Logging Service - Data logging, cloud sync, alarms (Layer 5)
"""

__version__ = "2.0.0"
