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
1. Load MINIMAL config.yaml (controller ID + cloud credentials)
2. Fetch full configuration from cloud (site, devices, settings)
3. If not assigned to a site, wait and retry periodically
4. Once assigned, connect to devices and run control loop
5. Log data locally (SQLite) and sync to cloud
"""

import argparse
import asyncio
import logging
import sys
import time
from pathlib import Path

import psutil
import yaml

from control_loop import ControlLoop
from storage.config_sync import ConfigSync
from storage.cloud_sync import CloudSync
from storage.local_db import LocalDatabase

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# How often to check for site assignment when unassigned
ASSIGNMENT_CHECK_INTERVAL_S = 60  # 1 minute


def get_system_metrics() -> dict:
    """
    Collect real system metrics using psutil.

    Returns a dictionary with:
    - cpu_usage_pct: CPU usage percentage
    - memory_usage_pct: Memory usage percentage
    - disk_usage_pct: Disk usage percentage (root partition)
    - cpu_temp_celsius: CPU temperature (Raspberry Pi specific, None if unavailable)
    """
    # CPU usage - use interval=None for non-blocking (uses previous sample)
    # First call returns 0.0, subsequent calls return real value
    cpu_pct = psutil.cpu_percent(interval=None)

    # Memory usage
    mem = psutil.virtual_memory()
    mem_pct = mem.percent

    # Disk usage (root partition)
    disk = psutil.disk_usage("/")
    disk_pct = disk.percent

    # CPU temperature (Raspberry Pi specific)
    # Raspberry Pi stores temp in /sys/class/thermal/thermal_zone0/temp
    cpu_temp = None
    try:
        with open("/sys/class/thermal/thermal_zone0/temp", "r") as f:
            # Value is in milli-celsius, convert to celsius
            cpu_temp = float(f.read().strip()) / 1000.0
    except (FileNotFoundError, IOError, ValueError):
        # Not a Raspberry Pi or temp sensor not available
        pass

    return {
        "cpu_usage_pct": cpu_pct,
        "memory_usage_pct": mem_pct,
        "disk_usage_pct": disk_pct,
        "cpu_temp_celsius": cpu_temp
    }


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


def validate_minimal_config(config: dict) -> bool:
    """
    Validate the MINIMAL configuration (just controller ID + cloud credentials).

    This is the new minimal config that only contains what's needed to
    connect to the cloud and fetch the full configuration.

    Args:
        config: Configuration dictionary

    Returns:
        True if minimal configuration is valid
    """
    errors = []

    # Check controller section
    controller = config.get("controller", {})
    if not controller.get("id"):
        errors.append("Missing controller.id - required to fetch config from cloud")

    # Check cloud section
    cloud = config.get("cloud", {})
    if not cloud.get("supabase_url"):
        errors.append("Missing cloud.supabase_url")
    if not cloud.get("supabase_key"):
        errors.append("Missing cloud.supabase_key")

    if errors:
        for error in errors:
            logger.error(f"Configuration error: {error}")
        return False

    return True


def get_validation_errors(config: dict) -> list:
    """
    Get list of validation errors for a configuration.

    Args:
        config: Configuration dictionary

    Returns:
        List of error messages (empty if valid)
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

    # Check minimum device configuration
    has_meters = bool(devices.get("load_meters"))
    has_dgs = bool(devices.get("generators"))
    has_inverters = bool(devices.get("inverters"))

    if not has_inverters:
        errors.append("At least one inverter is required")

    if not has_meters and not has_dgs:
        errors.append("At least one load meter OR DG is required for load calculation")

    return errors


def validate_full_config(config: dict) -> bool:
    """
    Validate the FULL configuration (with site, devices, etc.).

    This validates config after it's been merged with cloud data.

    Args:
        config: Configuration dictionary

    Returns:
        True if configuration is valid
    """
    errors = get_validation_errors(config)

    if errors:
        for error in errors:
            logger.error(f"Configuration error: {error}")
        return False

    return True


async def fetch_cloud_config(local_config: dict) -> dict:
    """
    Fetch full configuration from cloud using controller ID.

    Args:
        local_config: Minimal local config with controller.id and cloud credentials

    Returns:
        Cloud config response with status and optionally site config
    """
    controller_id = local_config.get("controller", {}).get("id")
    cloud = local_config.get("cloud", {})

    # Build API URL (convert Supabase URL to backend API URL)
    supabase_url = cloud.get("supabase_url", "")
    # The backend API is at volteria.org/api, not at supabase
    # For now, derive from supabase URL or use a fixed URL
    api_url = "https://volteria.org/api"

    api_key = cloud.get("supabase_key", "")

    logger.info(f"Fetching config from cloud for controller {controller_id}...")

    return await ConfigSync.fetch_by_controller_id(
        controller_id=controller_id,
        api_url=api_url,
        api_key=api_key
    )


def merge_configs(local_config: dict, cloud_config: dict) -> dict:
    """
    Merge cloud configuration with local config.

    The cloud config provides site, devices, and control settings.
    Local config provides controller ID and cloud credentials.

    Args:
        local_config: Minimal local config
        cloud_config: Full config from cloud (the 'site' field from API response)

    Returns:
        Merged configuration ready for ControlLoop
    """
    # Start with local config (has controller ID and cloud credentials)
    merged = local_config.copy()

    # Add site info from cloud
    merged["site"] = {
        "id": cloud_config.get("id"),
        "name": cloud_config.get("name"),
        "location": cloud_config.get("location"),
        "project_id": cloud_config.get("project_id"),
    }

    # Add control settings from cloud
    cloud_control = cloud_config.get("control", {})
    merged["control"] = {
        "interval_ms": cloud_control.get("interval_ms", 1000),
        "dg_reserve_kw": cloud_control.get("dg_reserve_kw", 50),
        "operation_mode": cloud_control.get("operation_mode", "zero_generator_feed"),
    }

    # Add logging settings from cloud
    cloud_logging = cloud_config.get("logging", {})
    merged["logging"] = {
        "local_interval_ms": cloud_logging.get("local_interval_ms", 1000),
        "cloud_sync_interval_ms": cloud_logging.get("cloud_interval_ms", 5000),
        "local_retention_days": cloud_logging.get("local_retention_days", 7),
        "cloud_enabled": cloud_logging.get("cloud_enabled", True),
    }

    # Add safe mode settings from cloud
    cloud_safe = cloud_config.get("safe_mode", {})
    merged["safe_mode"] = {
        "enabled": cloud_safe.get("enabled", True),
        "type": cloud_safe.get("type", "rolling_average"),
        "timeout_s": cloud_safe.get("timeout_s", 30),
        "rolling_window_minutes": cloud_safe.get("rolling_window_min", 3),
        "threshold_pct": cloud_safe.get("threshold_pct", 80),
    }

    # Add devices from cloud
    cloud_devices = cloud_config.get("devices", {})
    merged["devices"] = {
        "load_meters": cloud_devices.get("load_meters", []),
        "inverters": cloud_devices.get("inverters", []),
        "generators": cloud_devices.get("generators", []),
    }

    return merged


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
    print(f"    - Generator Reserve: {control.get('dg_reserve_kw', 50)} kW")
    print(f"    - Mode: {control.get('operation_mode', 'zero_generator_feed')}")

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


async def wait_for_assignment(local_config: dict) -> dict:
    """
    Wait for controller to be assigned to a site.

    Polls the cloud every ASSIGNMENT_CHECK_INTERVAL_S seconds
    until the controller is assigned to a site.

    IMPORTANT: While waiting, we send heartbeats so the Wizard Step 6
    "Verify Online" can detect that the controller is running.

    Args:
        local_config: Minimal local config

    Returns:
        Full merged configuration once assigned
    """
    controller_id = local_config.get("controller", {}).get("id", "unknown")
    serial = local_config.get("controller", {}).get("serial_number", "unknown")

    # Set up heartbeat capability while waiting
    cloud = local_config.get("cloud", {})
    supabase_url = cloud.get("supabase_url", "")
    supabase_key = cloud.get("supabase_key", "")

    # Create a local database for the CloudSync (required but won't be heavily used)
    local_db = LocalDatabase(db_path="/data/controller.db")

    # Create CloudSync with controller_id for heartbeat-only mode
    # site_id is not valid yet, but controller_id allows heartbeats
    cloud_sync = CloudSync(
        site_id="unassigned",  # Not a valid UUID, sync disabled
        supabase_url=supabase_url,
        supabase_key=supabase_key,
        local_db=local_db,
        controller_id=controller_id,  # This enables heartbeat-only mode
        backend_url=cloud.get("backend_url")  # FastAPI backend for site endpoints
    )

    print("\n" + "=" * 60)
    print("  WAITING FOR SITE ASSIGNMENT")
    print("=" * 60)
    print(f"\n  Controller ID: {controller_id}")
    print(f"  Serial: {serial}")
    print(f"\n  This controller is not yet assigned to a site.")
    print(f"  Please assign it via the Volteria platform.")
    print(f"\n  Checking every {ASSIGNMENT_CHECK_INTERVAL_S} seconds...")
    print(f"  Sending heartbeats every {ASSIGNMENT_CHECK_INTERVAL_S} seconds...")
    print("  Press Ctrl+C to stop\n")
    print("=" * 60 + "\n")

    start_time = time.time()

    while True:
        try:
            # Calculate uptime
            uptime_seconds = int(time.time() - start_time)

            # Collect real system metrics
            metrics = get_system_metrics()

            # Send heartbeat so Wizard Step 6 can detect us
            heartbeat_sent = await cloud_sync.send_heartbeat(
                firmware_version="1.0.0",
                uptime_seconds=uptime_seconds,
                **metrics
            )
            if heartbeat_sent:
                logger.info("Heartbeat sent successfully (waiting for assignment)")
            else:
                logger.warning("Failed to send heartbeat")

            # Fetch config from cloud
            cloud_response = await fetch_cloud_config(local_config)

            if cloud_response and cloud_response.get("status") == "assigned":
                site_config = cloud_response.get("site", {})
                logger.info(f"Controller assigned to site: {site_config.get('name')}")

                # Clean up
                await cloud_sync.close()

                # Merge and return
                merged_config = merge_configs(local_config, site_config)
                return merged_config

            # Still unassigned, wait and retry
            logger.info("Not assigned yet, waiting...")
            await asyncio.sleep(ASSIGNMENT_CHECK_INTERVAL_S)

        except asyncio.CancelledError:
            logger.info("Assignment wait cancelled")
            await cloud_sync.close()
            raise
        except Exception as e:
            logger.error(f"Error checking assignment: {e}")
            await asyncio.sleep(ASSIGNMENT_CHECK_INTERVAL_S)


async def wait_for_valid_config(local_config: dict, current_config: dict) -> dict:
    """
    Wait for configuration to become valid.

    When config validation fails (e.g., no devices configured), this function
    sends heartbeats showing "config_error" status while waiting for the user
    to fix the configuration via the Volteria platform.

    This ensures the controller shows as "online" even when control loop
    can't start due to configuration issues.

    Args:
        local_config: Minimal local config with controller ID and credentials
        current_config: Current merged config that failed validation

    Returns:
        Valid merged configuration once user fixes the errors
    """
    controller_id = local_config.get("controller", {}).get("id", "unknown")
    serial = local_config.get("controller", {}).get("serial_number", "unknown")

    # Collect validation errors for display
    errors = get_validation_errors(current_config)
    error_msg = "; ".join(errors)

    # Set up CloudSync for heartbeats
    cloud = local_config.get("cloud", {})
    supabase_url = cloud.get("supabase_url", "")
    supabase_key = cloud.get("supabase_key", "")

    # Create local database for CloudSync
    local_db = LocalDatabase(db_path="/data/controller.db")

    # Create CloudSync with site_id from current config (if available)
    site_id = current_config.get("site", {}).get("id", "unassigned")
    cloud_sync = CloudSync(
        site_id=site_id if site_id else "unassigned",
        supabase_url=supabase_url,
        supabase_key=supabase_key,
        local_db=local_db,
        controller_id=controller_id,
        backend_url=cloud.get("backend_url")  # FastAPI backend for site endpoints
    )

    print("\n" + "=" * 60)
    print("  WAITING FOR VALID CONFIGURATION")
    print("=" * 60)
    print(f"\n  Controller ID: {controller_id}")
    print(f"  Serial: {serial}")
    print(f"  Site: {current_config.get('site', {}).get('name', 'Unknown')}")
    print(f"\n  Configuration errors:")
    for err in errors:
        print(f"    - {err}")
    print(f"\n  Please fix via the Volteria platform.")
    print(f"  Checking every {ASSIGNMENT_CHECK_INTERVAL_S} seconds...")
    print(f"  Sending heartbeats to show online status...")
    print("  Press Ctrl+C to stop\n")
    print("=" * 60 + "\n")

    start_time = time.time()

    while True:
        try:
            # Calculate uptime
            uptime_seconds = int(time.time() - start_time)

            # Collect real system metrics
            metrics = get_system_metrics()

            # Send heartbeat with "config_error" status so frontend shows online
            heartbeat_sent = await cloud_sync.send_heartbeat(
                firmware_version="1.0.0",
                uptime_seconds=uptime_seconds,
                control_loop_status="config_error",
                control_last_error=error_msg,
                active_alarms_count=0,
                **metrics
            )
            if heartbeat_sent:
                logger.info(f"Heartbeat sent (config_error: {error_msg[:50]}...)")
            else:
                logger.warning("Failed to send heartbeat")

            # Check for updated config from cloud
            cloud_response = await fetch_cloud_config(local_config)

            if cloud_response:
                response_status = cloud_response.get("status")

                # Handle "unassigned" status - controller was removed from site
                # Return None to signal that we need to go back to wait_for_assignment
                if response_status == "unassigned":
                    logger.info("Controller was unassigned from site. Returning to assignment wait...")
                    await cloud_sync.close()
                    return None  # Signal to main loop to restart config fetch

                if response_status == "assigned":
                    site_config = cloud_response.get("site", {})
                    new_config = merge_configs(local_config, site_config)

                    # Check if new config is valid
                    new_errors = get_validation_errors(new_config)
                    if not new_errors:
                        logger.info("Configuration is now valid!")
                        await cloud_sync.close()
                        return new_config
                    else:
                        # Update error message if errors changed
                        new_error_msg = "; ".join(new_errors)
                        if new_error_msg != error_msg:
                            error_msg = new_error_msg
                            logger.info(f"Config errors updated: {error_msg}")

            # Still invalid, wait and retry
            logger.info("Config still invalid, waiting for fix...")
            await asyncio.sleep(ASSIGNMENT_CHECK_INTERVAL_S)

        except asyncio.CancelledError:
            logger.info("Config wait cancelled")
            await cloud_sync.close()
            raise
        except Exception as e:
            logger.error(f"Error checking config: {e}")
            await asyncio.sleep(ASSIGNMENT_CHECK_INTERVAL_S)


async def main_async(local_config: dict, skip_cloud: bool = False):
    """
    Async main function.

    Args:
        local_config: Local configuration (minimal or full)
        skip_cloud: If True, skip cloud fetch (for legacy full configs)
    """
    config = local_config

    # Check if this is a minimal config (needs cloud fetch)
    # or a full legacy config (has devices section)
    is_minimal = "devices" not in local_config or not local_config.get("devices")

    if is_minimal and not skip_cloud:
        # Loop to handle controller becoming unassigned during config wait
        # This allows the controller to transition back to wait_for_assignment
        # if it gets removed from a site while waiting for valid config
        while True:
            # Fetch configuration from cloud
            cloud_response = await fetch_cloud_config(local_config)

            if not cloud_response:
                logger.error("Failed to fetch configuration from cloud")
                logger.error("Check your internet connection and controller ID")
                sys.exit(1)

            status = cloud_response.get("status")

            if status == "assigned":
                # Controller is assigned to a site - merge configs
                site_config = cloud_response.get("site", {})
                config = merge_configs(local_config, site_config)
                logger.info(f"Loaded config for site: {site_config.get('name')}")

            elif status == "unassigned":
                # Controller not assigned yet - wait for assignment
                config = await wait_for_assignment(local_config)

            elif status == "error":
                logger.error(f"Cloud config error: {cloud_response.get('message')}")
                sys.exit(1)

            # Validate the merged configuration
            if not validate_full_config(config):
                logger.error("Configuration validation failed")
                # Instead of exiting, wait for valid config while sending heartbeats
                # This ensures controller shows "online" even with config errors
                config = await wait_for_valid_config(local_config, config)

                # If wait_for_valid_config returns None, controller was unassigned
                # Restart the config fetch loop
                if config is None:
                    logger.info("Restarting config fetch after unassignment...")
                    continue

            # Config is valid, break out of the loop
            break

        # Print summary of loaded config
        print_config_summary(config)

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
    parser.add_argument(
        "--skip-cloud",
        action="store_true",
        help="Skip cloud config fetch (use local config only)"
    )

    args = parser.parse_args()

    # Set log level
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Load configuration
    config = load_config(args.config)

    # Check if this is a minimal or full config
    is_minimal = "devices" not in config or not config.get("devices")

    if is_minimal:
        # Minimal config - validate minimal requirements
        if not validate_minimal_config(config):
            sys.exit(1)
        print("\n" + "=" * 60)
        print("  VOLTERIA CONTROLLER - CLOUD CONFIGURATION")
        print("=" * 60)
        print(f"\n  Controller ID: {config.get('controller', {}).get('id', 'unknown')}")
        print(f"  Serial: {config.get('controller', {}).get('serial_number', 'unknown')}")
        print("\n  Configuration will be fetched from cloud...")
        print("=" * 60 + "\n")
    else:
        # Full legacy config - validate all requirements
        if not validate_full_config(config):
            sys.exit(1)
        # Print summary for full config
        print_config_summary(config)

    # Dry run mode
    if args.dry_run:
        print("Dry run mode - exiting without starting controller")
        sys.exit(0)

    # Start controller
    logger.info("Starting controller...")
    print("Press Ctrl+C to stop\n")

    try:
        asyncio.run(main_async(config, skip_cloud=args.skip_cloud))
    except KeyboardInterrupt:
        print("\nStopped by user")


if __name__ == "__main__":
    main()
