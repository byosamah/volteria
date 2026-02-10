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

from pymodbus.client import AsyncModbusTcpClient, AsyncModbusSerialClient

# Use SharedState for config (same as all services) - reads from tmpfs or disk
from common.state import get_config


def get_device_config(device_id: str) -> dict | None:
    """
    Get device configuration from SharedState (same pattern as logging service).

    Config is the source of truth - always reads latest synced config.
    User changes network settings in UI → config syncs to controller →
    this function returns the updated connection settings.
    """
    config = get_config()

    if not config:
        return None

    devices = config.get("devices", [])

    # Handle both list (new format) and dict (legacy format)
    if isinstance(devices, dict):
        # Legacy format: {load_meters: [], inverters: [], ...}
        device_lists = [
            devices.get("load_meters", []),
            devices.get("inverters", []),
            devices.get("generators", []),
            devices.get("sensors", []),
            devices.get("other", []),
        ]
        for device_list in device_lists:
            for device in device_list:
                if device.get("id") == device_id:
                    return device
    elif isinstance(devices, list):
        # New format: flat list of devices
        for device in devices:
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


def _create_client(device: dict) -> tuple:
    """
    Create Modbus client based on device protocol.

    Returns:
        (client, slave_id, error) — error is None on success
    """
    modbus = device.get("modbus", {})
    protocol = modbus.get("protocol") or device.get("protocol", "tcp")
    slave_id = modbus.get("slave_id") or device.get("slave_id", 1)

    if protocol == "tcp":
        host = modbus.get("host") or device.get("ip_address") or device.get("ip")
        port = modbus.get("port") or device.get("port", 502)
        if not host:
            return None, slave_id, "No host/IP configured for TCP device"
        return AsyncModbusTcpClient(host=host, port=port), slave_id, None

    elif protocol in ("rtu_gateway", "rtu"):
        host = modbus.get("gateway_ip") or device.get("gateway_ip")
        port = modbus.get("gateway_port") or device.get("gateway_port", 502)
        if not host:
            return None, slave_id, "No gateway_ip configured for RTU Gateway device"
        return AsyncModbusTcpClient(host=host, port=port), slave_id, None

    elif protocol == "rtu_direct":
        serial_port = modbus.get("serial_port") or device.get("serial_port")
        if not serial_port:
            return None, slave_id, "No serial_port configured for RTU Direct device"
        baudrate = modbus.get("baudrate") or device.get("baudrate", 9600)
        parity = modbus.get("parity") or device.get("parity", "N")
        stopbits = modbus.get("stopbits") or device.get("stopbits", 1)
        client = AsyncModbusSerialClient(
            port=serial_port,
            baudrate=baudrate,
            parity=parity,
            stopbits=stopbits,
            timeout=3,
        )
        return client, slave_id, None

    else:
        return None, slave_id, f"Unsupported protocol: {protocol}"


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

    # Create Modbus client based on protocol
    client, slave_id, error = _create_client(device)
    if error:
        result["errors"].append(error)
        return result

    try:
        connected = await client.connect()
        if not connected:
            result["errors"].append("Failed to connect to device")
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
                        device_id=slave_id
                    )
                else:
                    response = await client.read_input_registers(
                        address=address,
                        count=1,
                        device_id=slave_id
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

    # Create Modbus client based on protocol
    client, slave_id, error = _create_client(device)
    if error:
        result["error"] = error
        return result

    try:
        connected = await client.connect()
        if not connected:
            result["error"] = "Failed to connect to device"
            return result

        # Write the register
        response = await client.write_register(
            address=address,
            value=value,
            device_id=slave_id
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
                device_id=slave_id
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
