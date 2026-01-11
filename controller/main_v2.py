#!/usr/bin/env python3
"""
Volteria Controller - New Architecture Entry Point

Uses the 5-layer service architecture via supervisor:
- Layer 1: System Service - Heartbeat, OTA, health monitoring (ALWAYS alive)
- Layer 2: Config Service - Sync, caching, versioning
- Layer 3: Device Service - Modbus I/O, polling, writes
- Layer 4: Control Service - Zero-feeding algorithm
- Layer 5: Logging Service - Data logging, cloud sync, alarms

Usage:
    python main_v2.py                    # Start with default config
    python main_v2.py --config my.yaml   # Use custom config file
    python main_v2.py --dry-run          # Print config and exit
    python main_v2.py --verbose          # Enable debug logging

This replaces the monolithic control_loop.py with a multi-process
architecture for better reliability and isolation.
"""

import argparse
import asyncio
import logging
import sys
from pathlib import Path

import yaml

from common.logging_setup import setup_logging
from supervisor import Supervisor

# Default configuration path
DEFAULT_CONFIG_PATH = "config.yaml"


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
        print(f"Error: Configuration file not found: {config_path}")
        sys.exit(1)

    try:
        with open(path, "r") as f:
            config = yaml.safe_load(f)
        return config
    except Exception as e:
        print(f"Error loading configuration: {e}")
        sys.exit(1)


def validate_config(config: dict) -> bool:
    """
    Validate the configuration.

    Supports two config formats:
    1. Minimal (new): controller.id + cloud credentials
    2. Full (legacy): site + site_controller + devices + cloud

    Args:
        config: Configuration dictionary

    Returns:
        True if configuration is valid
    """
    errors = []

    # Check for controller ID - support both formats
    # New format: controller.id
    # Legacy format: site_controller.serial_number or site.id
    controller = config.get("controller", {})
    site_controller = config.get("site_controller", {})
    site = config.get("site", {})

    has_controller_id = bool(controller.get("id"))
    has_site_controller = bool(site_controller.get("serial_number"))
    has_site = bool(site.get("id"))

    if not (has_controller_id or has_site_controller or has_site):
        errors.append("Missing controller.id or site_controller.serial_number")

    # Check cloud section
    cloud = config.get("cloud", {})
    if not cloud.get("supabase_url"):
        errors.append("Missing cloud.supabase_url")
    if not cloud.get("supabase_key"):
        errors.append("Missing cloud.supabase_key")

    if errors:
        print("Configuration errors:")
        for error in errors:
            print(f"  - {error}")
        return False

    return True


def print_startup_banner(config: dict):
    """Print startup information."""
    # Support both config formats
    controller = config.get("controller", {})
    site_controller = config.get("site_controller", {})
    site = config.get("site", {})
    cloud = config.get("cloud", {})

    # Get controller info from either format
    controller_id = controller.get("id") or site_controller.get("serial_number") or site.get("id") or "unknown"
    serial = controller.get("serial_number") or site_controller.get("serial_number") or "unknown"

    print()
    print("=" * 60)
    print("  VOLTERIA CONTROLLER - 5-LAYER ARCHITECTURE")
    print("=" * 60)
    print()
    print("  Service Layers:")
    print("    1. System   - Heartbeat, OTA, health monitoring")
    print("    2. Config   - Cloud sync, caching, versioning")
    print("    3. Device   - Modbus I/O, polling, writes")
    print("    4. Control  - Zero-feeding algorithm")
    print("    5. Logging  - Data logging, cloud sync, alarms")
    print()
    print(f"  Controller ID: {controller_id}")
    print(f"  Serial: {serial}")
    print(f"  Cloud URL: {cloud.get('supabase_url', 'not set')[:40]}...")
    print()
    print("  Services will start in order: system -> config -> device -> control -> logging")
    print("  Each service has a health endpoint and 3x restart policy")
    print("  Critical service failure triggers safe mode")
    print()
    print("=" * 60)
    print()


def print_service_ports():
    """Print service port assignments."""
    print()
    print("Service Health Endpoints:")
    print("  - System:  http://127.0.0.1:8081/health")
    print("  - Config:  http://127.0.0.1:8082/health")
    print("  - Device:  http://127.0.0.1:8083/health")
    print("  - Control: http://127.0.0.1:8084/health")
    print("  - Logging: http://127.0.0.1:8085/health")
    print()


async def main_async(config: dict, verbose: bool = False):
    """
    Async main function that starts the supervisor.

    Args:
        config: Configuration dictionary
        verbose: Enable verbose logging
    """
    # Setup logging
    log_level = "DEBUG" if verbose else "INFO"
    # Use JSON format in production, plain text for development
    json_format = not verbose  # Plain text in verbose/debug mode
    setup_logging("main", log_level=log_level, json_format=json_format)

    logger = logging.getLogger("volteria.main")
    logger.info("Starting Volteria Controller (5-layer architecture)")

    # Write config to shared state for services to read
    from common.state import SharedState
    SharedState.write("controller_config", config)

    # Create and start supervisor
    supervisor = Supervisor()

    try:
        await supervisor.start()
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    except Exception as e:
        logger.critical(f"Supervisor failed: {e}")
        raise


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Volteria Controller - 5-Layer Architecture",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python main_v2.py                    # Start with default config
    python main_v2.py --config my.yaml   # Use custom config file
    python main_v2.py --dry-run          # Validate config and exit
    python main_v2.py -v                 # Enable debug logging

Services:
    Layer 1: System  (port 8081) - Heartbeat, OTA, health
    Layer 2: Config  (port 8082) - Cloud sync, caching
    Layer 3: Device  (port 8083) - Modbus I/O, polling
    Layer 4: Control (port 8084) - Zero-feeding algorithm
    Layer 5: Logging (port 8085) - Data logging, alarms
        """
    )

    parser.add_argument(
        "--config", "-c",
        type=str,
        default=DEFAULT_CONFIG_PATH,
        help=f"Path to configuration file (default: {DEFAULT_CONFIG_PATH})"
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate configuration and exit without starting"
    )

    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose (debug) logging"
    )

    parser.add_argument(
        "--version",
        action="version",
        version="Volteria Controller v2.0.0 (5-layer architecture)"
    )

    args = parser.parse_args()

    # Load configuration
    config = load_config(args.config)

    # Validate configuration
    if not validate_config(config):
        sys.exit(1)

    # Print startup banner
    print_startup_banner(config)

    # Dry run mode
    if args.dry_run:
        print("Dry run mode - configuration valid")
        print_service_ports()
        print("Exiting without starting services")
        sys.exit(0)

    # Print service info
    print("Starting services...")
    print("Press Ctrl+C to stop")
    print()

    # Run the supervisor
    try:
        asyncio.run(main_async(config, verbose=args.verbose))
    except KeyboardInterrupt:
        print("\nStopped by user")
    except Exception as e:
        print(f"\nFatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
