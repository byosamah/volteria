#!/usr/bin/env python3
"""
Register CLI - Read/Write Modbus Registers

Command-line tool for reading and writing Modbus registers.
Used by the backend API to execute live register operations.

Usage:
    # Read single register
    python register_cli.py read --device-id <uuid> --address <addr>

    # Read multiple registers
    python register_cli.py read --device-id <uuid> --addresses 5031,5032,5033

    # Write register
    python register_cli.py write --device-id <uuid> --address <addr> --value <val>

Output is JSON for easy parsing by the backend.
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path
from datetime import datetime, timezone

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from pymodbus.client import AsyncModbusTcpClient


def get_device_config(device_id: str) -> dict | None:
    """Get device configuration from SharedState config file."""
    config_path = Path("/opt/volteria/data/state/config.json")

    # Fallback for Windows development
    if not config_path.exists():
        config_path = Path(__file__).parent / "data" / "state" / "config.json"

    if not config_path.exists():
        return None

    try:
        with open(config_path) as f:
            config = json.load(f)
    except (json.JSONDecodeError, IOError):
        return None

    if not config:
        return None

    # Search in all device lists
    device_lists = [
        config.get("devices", {}).get("load_meters", []),
        config.get("devices", {}).get("inverters", []),
        config.get("devices", {}).get("generators", []),
        config.get("devices", {}).get("sensors", []),
    ]

    for device_list in device_lists:
        for device in device_list:
            if device.get("id") == device_id:
                return device

    return None


def get_register_config(device: dict, address: int) -> dict | None:
    """Get register configuration from device."""
    register_lists = [
        device.get("registers", []),
        device.get("logging_registers", []),
        device.get("visualization_registers", []),
        device.get("alarm_registers", []),
    ]

    for reg_list in register_lists:
        if reg_list:
            for reg in reg_list:
                if reg.get("address") == address:
                    return reg

    return None


async def read_registers(device_id: str, addresses: list[int]) -> dict:
    """
    Read multiple registers from a device.

    Returns:
        {
            "success": bool,
            "device_id": str,
            "readings": {
                "address": {
                    "raw_value": int,
                    "scaled_value": float,
                    "timestamp": str
                },
                ...
            },
            "errors": ["error message", ...]
        }
    """
    result = {
        "success": False,
        "device_id": device_id,
        "readings": {},
        "errors": []
    }

    # Get device config
    device = get_device_config(device_id)
    if not device:
        result["errors"].append(f"Device not found: {device_id}")
        return result

    # Determine connection parameters
    protocol = device.get("protocol", "tcp")

    if protocol == "tcp":
        host = device.get("ip_address") or device.get("ip")
        port = device.get("port", 502)
    elif protocol in ("rtu_gateway", "rtu"):
        host = device.get("gateway_ip")
        port = device.get("gateway_port", 502)
    else:
        result["errors"].append(f"Unsupported protocol: {protocol}")
        return result

    if not host:
        result["errors"].append("No host/IP configured for device")
        return result

    slave_id = device.get("slave_id", 1)

    # Create Modbus client
    client = AsyncModbusTcpClient(host=host, port=port)

    try:
        connected = await client.connect()
        if not connected:
            result["errors"].append(f"Failed to connect to {host}:{port}")
            return result

        timestamp = datetime.now(timezone.utc).isoformat()

        for address in addresses:
            try:
                # Get register config for datatype and scale
                reg_config = get_register_config(device, address)

                reg_type = "input"
                scale = 1.0
                offset = 0.0
                scale_order = "multiply_first"

                if reg_config:
                    reg_type = reg_config.get("type", "input")
                    scale = reg_config.get("scale", 1.0) or 1.0
                    offset = reg_config.get("offset", 0.0) or 0.0
                    scale_order = reg_config.get("scale_order", "multiply_first")

                # Read based on register type
                if reg_type == "holding":
                    response = await client.read_holding_registers(
                        address=address,
                        count=1,
                        slave=slave_id
                    )
                else:
                    response = await client.read_input_registers(
                        address=address,
                        count=1,
                        slave=slave_id
                    )

                if response.isError():
                    result["errors"].append(f"Failed to read address {address}: {response}")
                    continue

                raw_value = response.registers[0]

                # Apply scale and offset
                if scale_order == "multiply_first":
                    scaled_value = (raw_value * scale) + offset
                else:
                    scaled_value = (raw_value + offset) * scale

                result["readings"][str(address)] = {
                    "raw_value": raw_value,
                    "scaled_value": scaled_value,
                    "timestamp": timestamp
                }

            except Exception as e:
                result["errors"].append(f"Error reading address {address}: {str(e)}")

        result["success"] = len(result["readings"]) > 0

    except Exception as e:
        result["errors"].append(f"Connection error: {str(e)}")
    finally:
        client.close()

    return result


async def write_register(device_id: str, address: int, value: int, verify: bool = True) -> dict:
    """
    Write a value to a register.

    Returns:
        {
            "success": bool,
            "device_id": str,
            "address": int,
            "written_value": int,
            "verified": bool,
            "read_back_value": int | None,
            "error": str | None
        }
    """
    result = {
        "success": False,
        "device_id": device_id,
        "address": address,
        "written_value": value,
        "verified": False,
        "read_back_value": None,
        "error": None
    }

    # Get device config
    device = get_device_config(device_id)
    if not device:
        result["error"] = f"Device not found: {device_id}"
        return result

    # Determine connection parameters
    protocol = device.get("protocol", "tcp")

    if protocol == "tcp":
        host = device.get("ip_address") or device.get("ip")
        port = device.get("port", 502)
    elif protocol in ("rtu_gateway", "rtu"):
        host = device.get("gateway_ip")
        port = device.get("gateway_port", 502)
    else:
        result["error"] = f"Unsupported protocol: {protocol}"
        return result

    if not host:
        result["error"] = "No host/IP configured for device"
        return result

    slave_id = device.get("slave_id", 1)

    # Create Modbus client
    client = AsyncModbusTcpClient(host=host, port=port)

    try:
        connected = await client.connect()
        if not connected:
            result["error"] = f"Failed to connect to {host}:{port}"
            return result

        # Write the register
        response = await client.write_register(
            address=address,
            value=value,
            slave=slave_id
        )

        if response.isError():
            result["error"] = f"Write failed: {response}"
            return result

        result["success"] = True

        # Verify by reading back
        if verify:
            await asyncio.sleep(0.2)  # Wait 200ms before verification

            read_response = await client.read_holding_registers(
                address=address,
                count=1,
                slave=slave_id
            )

            if not read_response.isError():
                result["read_back_value"] = read_response.registers[0]
                # Allow 1% tolerance
                tolerance = max(1, abs(value * 0.01))
                result["verified"] = abs(read_response.registers[0] - value) <= tolerance
            else:
                result["verified"] = False

    except Exception as e:
        result["error"] = str(e)
        result["success"] = False
    finally:
        client.close()

    return result


def main():
    parser = argparse.ArgumentParser(
        description="Read/Write Modbus registers",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # Read command
    read_parser = subparsers.add_parser("read", help="Read registers")
    read_parser.add_argument("--device-id", required=True, help="Device UUID")
    read_parser.add_argument("--address", type=int, help="Single register address")
    read_parser.add_argument("--addresses", help="Comma-separated addresses (e.g., 5031,5032)")

    # Write command
    write_parser = subparsers.add_parser("write", help="Write register")
    write_parser.add_argument("--device-id", required=True, help="Device UUID")
    write_parser.add_argument("--address", type=int, required=True, help="Register address")
    write_parser.add_argument("--value", type=int, required=True, help="Value to write")
    write_parser.add_argument("--no-verify", action="store_true", help="Skip read-back verification")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    if args.command == "read":
        # Parse addresses
        addresses = []
        if args.address:
            addresses.append(args.address)
        if args.addresses:
            addresses.extend([int(a.strip()) for a in args.addresses.split(",")])

        if not addresses:
            print(json.dumps({"success": False, "error": "No addresses specified"}))
            sys.exit(1)

        result = asyncio.run(read_registers(args.device_id, addresses))
        print(json.dumps(result))

    elif args.command == "write":
        result = asyncio.run(write_register(
            args.device_id,
            args.address,
            args.value,
            verify=not args.no_verify
        ))
        print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(json.dumps({
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }))
        sys.exit(1)
