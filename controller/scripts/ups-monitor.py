#!/usr/bin/env python3
"""
Volteria UPS Power Loss Monitor (SOL532-E16)

Monitors GPIO16 for power loss detection on the Seeed reComputer Industrial R2000.
The SuperCAP UPS holds power for ~15 seconds after mains loss.

When GPIO16 goes LOW:
  1. Stop Volteria services in reverse order (5 -> 1)
  2. Initiate system poweroff

This script runs as root to access GPIO and systemctl.
"""

import asyncio
import subprocess
import sys
import signal
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [UPS-MONITOR] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)

# GPIO configuration
POWER_LOSS_GPIO_CHIP = "gpiochip0"
POWER_LOSS_GPIO_LINE = 16  # GPIO16 goes LOW on power loss

# Services to stop in reverse order (Layer 5 -> Layer 1)
VOLTERIA_SERVICES = [
    "volteria-logging.service",
    "volteria-control.service",
    "volteria-device.service",
    "volteria-config.service",
    "volteria-system.service",
]

# Timeout for stopping all services (seconds)
# Must be fast - only ~15s of supercapacitor power available
SERVICE_STOP_TIMEOUT = 8


def stop_services():
    """Stop all Volteria services in reverse layer order."""
    logger.info("Stopping Volteria services...")
    for service in VOLTERIA_SERVICES:
        try:
            subprocess.run(
                ["systemctl", "stop", service],
                timeout=2,
                capture_output=True,
            )
            logger.info(f"  Stopped {service}")
        except subprocess.TimeoutExpired:
            logger.warning(f"  Timeout stopping {service} - continuing")
        except Exception as e:
            logger.warning(f"  Error stopping {service}: {e}")


def initiate_poweroff():
    """Initiate system poweroff."""
    logger.info("Initiating system poweroff...")
    try:
        subprocess.run(["poweroff"], timeout=5)
    except Exception as e:
        logger.error(f"Poweroff failed: {e}")
        # Last resort
        subprocess.run(["shutdown", "-h", "now"], timeout=5)


async def monitor_power_loss():
    """Monitor GPIO16 for power loss event using gpiod."""
    try:
        import gpiod
        from gpiod.line import Bias, Edge
    except ImportError:
        logger.error("gpiod library not installed. Install with: pip install gpiod>=2.0")
        sys.exit(1)

    logger.info(f"Opening GPIO chip: {POWER_LOSS_GPIO_CHIP}, line: {POWER_LOSS_GPIO_LINE}")

    try:
        chip = gpiod.Chip(POWER_LOSS_GPIO_CHIP)
    except Exception as e:
        logger.error(f"Failed to open GPIO chip: {e}")
        sys.exit(1)

    # Configure line for falling edge detection (HIGH -> LOW = power loss)
    line_config = gpiod.LineSettings(
        edge_detection=Edge.FALLING,
        bias=Bias.PULL_UP,
    )

    request = chip.request_lines(
        consumer="volteria-ups-monitor",
        config={POWER_LOSS_GPIO_LINE: line_config},
    )

    logger.info("UPS monitor started - waiting for power loss event on GPIO16...")

    # Use asyncio to wait for GPIO events without blocking
    loop = asyncio.get_event_loop()

    while True:
        # Wait for edge event in a thread to avoid blocking asyncio
        events = await loop.run_in_executor(
            None, lambda: request.read_edge_events(timeout=1.0)
        )

        if events:
            for event in events:
                if event.line_offset == POWER_LOSS_GPIO_LINE:
                    logger.critical("POWER LOSS DETECTED on GPIO16!")
                    logger.info(f"SuperCAP UPS active - {SERVICE_STOP_TIMEOUT}s to shutdown")

                    # Stop services and power off
                    stop_services()
                    initiate_poweroff()
                    return


async def main():
    """Main entry point."""
    logger.info("Volteria UPS Power Loss Monitor starting...")
    logger.info(f"Hardware: SOL532-E16 (Seeed reComputer Industrial R2000)")
    logger.info(f"Monitoring: GPIO{POWER_LOSS_GPIO_LINE} for falling edge (power loss)")

    # Handle graceful shutdown
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda: sys.exit(0))

    await monitor_power_loss()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("UPS monitor stopped by user")
    except SystemExit:
        logger.info("UPS monitor stopped")
    except Exception as e:
        logger.error(f"UPS monitor crashed: {e}")
        sys.exit(1)
