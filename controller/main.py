#!/usr/bin/env python3
"""
Solar Diesel Hybrid Controller - Main Entry Point

This is the main entry point for the on-site controller.
It loads the configuration and starts the control loop.

Usage:
    python main.py                    # Use default config.yaml
    python main.py --config my.yaml   # Use custom config file
    python main.py --dry-run          # Print config and exit

The controller will:
1. Load configuration from YAML file
2. Connect to all configured devices via Modbus
3. Run the zero-feeding control loop
4. Log data locally (SQLite) and sync to cloud
"""

import argparse
import asyncio
import logging
import sys
from pathlib import Path

import yaml

from control_loop import ControlLoop

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def load_config(config_path: str) -> dict:
    """
    Load configuration from YAML file.

    Args:
        config_path: Path to configuration file

    Returns:
        Configuration dictionary
    """
    path = Path(config_path)
    if not path.exists():
        logger.error(f"Configuration file not found: {config_path}")
        sys.exit(1)

    try:
        with open(path, "r") as f:
            config = yaml.safe_load(f)
        logger.info(f"Loaded configuration from {config_path}")
        return config
    except Exception as e:
        logger.error(f"Error loading configuration: {e}")
        sys.exit(1)


def validate_config(config: dict) -> bool:
    """
    Validate the configuration.

    Args:
        config: Configuration dictionary

    Returns:
        True if configuration is valid
    """
    errors = []

    # Check required sections
    required_sections = ["site", "control", "devices"]
    for section in required_sections:
        if section not in config:
            errors.append(f"Missing required section: {section}")

    # Check control settings
    control = config.get("control", {})
    if control.get("dg_reserve_kw", 0) < 0:
        errors.append("DG reserve cannot be negative")

    # Check devices
    devices = config.get("devices", {})
    if not devices.get("inverters"):
        errors.append("At least one inverter is required")

    # Check minimum device configuration
    has_meters = bool(devices.get("load_meters"))
    has_dgs = bool(devices.get("generators"))
    has_inverters = bool(devices.get("inverters"))

    if not has_inverters:
        errors.append("At least one inverter is required")

    if not has_meters and not has_dgs:
        errors.append("At least one load meter OR DG is required for load calculation")

    if errors:
        for error in errors:
            logger.error(f"Configuration error: {error}")
        return False

    return True


def print_config_summary(config: dict):
    """Print a summary of the configuration."""
    print("\n" + "=" * 60)
    print("  SOLAR DIESEL HYBRID CONTROLLER")
    print("=" * 60)

    site = config.get("site", {})
    print(f"\n  Site: {site.get('name', 'Unknown')}")
    print(f"  Location: {site.get('location', 'Unknown')}")

    controller = config.get("site_controller", {})
    print(f"\n  Controller: {controller.get('name', 'Unknown')}")
    print(f"  Serial: {controller.get('serial_number', 'Unknown')}")
    print(f"  Hardware: {controller.get('hardware_type', 'Unknown')}")

    control = config.get("control", {})
    print(f"\n  Control Settings:")
    print(f"    - Interval: {control.get('interval_ms', 1000)}ms")
    print(f"    - DG Reserve: {control.get('dg_reserve_kw', 50)} kW")
    print(f"    - Mode: {control.get('operation_mode', 'zero_dg_reverse')}")

    devices = config.get("devices", {})
    print(f"\n  Devices:")
    print(f"    - Load Meters: {len(devices.get('load_meters', []))}")
    print(f"    - Inverters: {len(devices.get('inverters', []))}")
    print(f"    - Generators: {len(devices.get('generators', []))}")

    # Calculate total inverter capacity
    total_capacity = sum(
        inv.get("rated_power_kw", 0)
        for inv in devices.get("inverters", [])
    )
    print(f"    - Total Inverter Capacity: {total_capacity} kW")

    cloud = config.get("cloud", {})
    if cloud.get("sync_enabled"):
        print(f"\n  Cloud: Enabled (Supabase)")
    else:
        print(f"\n  Cloud: Disabled")

    print("=" * 60 + "\n")


async def main_async(config: dict):
    """
    Async main function.

    Args:
        config: Configuration dictionary
    """
    # Create and run control loop
    loop = ControlLoop(config)

    # Set up signal handlers for graceful shutdown
    def shutdown():
        logger.info("Shutdown requested...")
        loop.stop()

    try:
        await loop.run()
    except asyncio.CancelledError:
        logger.info("Controller cancelled")
    except Exception as e:
        logger.error(f"Controller error: {e}")
        raise


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Solar Diesel Hybrid Controller"
    )
    parser.add_argument(
        "--config", "-c",
        type=str,
        default="config.yaml",
        help="Path to configuration file (default: config.yaml)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print configuration and exit without starting controller"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose (debug) logging"
    )

    args = parser.parse_args()

    # Set log level
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Load configuration
    config = load_config(args.config)

    # Validate configuration
    if not validate_config(config):
        sys.exit(1)

    # Print summary
    print_config_summary(config)

    # Dry run mode
    if args.dry_run:
        print("Dry run mode - exiting without starting controller")
        sys.exit(0)

    # Start controller
    logger.info("Starting controller...")
    print("Press Ctrl+C to stop\n")

    try:
        asyncio.run(main_async(config))
    except KeyboardInterrupt:
        print("\nStopped by user")


if __name__ == "__main__":
    main()
