"""
Control Service (Layer 4) - Control Algorithm

Responsibilities:
- Execute control loop at configured interval
- Calculate solar limit based on load and DG reserve
- Request device service to write limits
- Handle safe mode triggering
- Emit control state for logging
"""

from .service import ControlService

__all__ = ["ControlService"]
