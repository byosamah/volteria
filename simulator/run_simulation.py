#!/usr/bin/env python3
"""
Run the Virtual Site Simulation

This script starts the Modbus TCP server that simulates all devices
on the virtual site. The controller can then connect to this simulation
to test the zero-feeding algorithm.

Usage:
    python run_simulation.py                    # Normal operation
    python run_simulation.py --load 300         # Set initial load (kW)
    python run_simulation.py --solar 150        # Set available solar (kW)
    python run_simulation.py --scenario high_load  # Run predefined scenario

The simulator provides a Modbus TCP server on port 5020 that handles
requests for all simulated devices (DGs, inverters, meters).
"""

import asyncio
import logging
import argparse
import sys
from typing import Optional

try:
    from pymodbus.server import StartAsyncTcpServer
    from pymodbus.datastore import (
        ModbusServerContext,
        ModbusSlaveContext,
        ModbusSequentialDataBlock,
    )
    from pymodbus.device import ModbusDeviceIdentification
except ImportError:
    print("Error: pymodbus not installed. Run:")
    print("  pip install pymodbus>=3.6.0")
    sys.exit(1)

from virtual_site import VirtualSite, SiteConfig
from virtual_meter import VirtualMeter
from virtual_inverter import VirtualInverter
from virtual_dg import VirtualDG

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class SimulatorDataStore:
    """
    Custom data store that routes Modbus requests to virtual devices.

    This class bridges pymodbus with our virtual device simulation.
    """

    def __init__(self, site: VirtualSite):
        """
        Initialize the data store.

        Args:
            site: The virtual site containing all devices
        """
        self.site = site

        # Map slave IDs to devices
        self._device_map = {}

        # Map meters and inverters by slave ID
        for meter in site.load_meters:
            self._device_map[meter.slave_id] = meter
        for inverter in site.inverters:
            self._device_map[inverter.slave_id] = inverter

        logger.info(f"Simulator data store initialized with {len(self._device_map)} devices")

    def get_device(self, slave_id: int):
        """Get device by slave ID."""
        return self._device_map.get(slave_id)


class SimulatorServer:
    """
    Modbus TCP server that serves the virtual site.
    """

    def __init__(
        self,
        site: VirtualSite,
        host: str = "0.0.0.0",
        port: int = 5020  # Use non-standard port to avoid conflicts
    ):
        """
        Initialize the simulator server.

        Args:
            site: Virtual site to simulate
            host: Host to bind to
            port: Port to listen on
        """
        self.site = site
        self.host = host
        self.port = port
        self.data_store = SimulatorDataStore(site)

        logger.info(f"Simulator server will listen on {host}:{port}")

    def _create_slave_context(self, device) -> ModbusSlaveContext:
        """
        Create a slave context for a device.

        This sets up the register blocks for the device.
        """
        # Create data blocks with enough space for all registers
        # Using 0-based addressing with offset
        hr = ModbusSequentialDataBlock(0, [0] * 10000)  # Holding registers
        ir = ModbusSequentialDataBlock(0, [0] * 10000)  # Input registers

        return ModbusSlaveContext(
            di=ModbusSequentialDataBlock(0, [0] * 100),  # Discrete inputs
            co=ModbusSequentialDataBlock(0, [0] * 100),  # Coils
            hr=hr,
            ir=ir,
        )

    async def run(self):
        """
        Start the Modbus TCP server.
        """
        # Create server context with all slaves
        slaves = {}
        for slave_id, device in self.data_store._device_map.items():
            slaves[slave_id] = self._create_slave_context(device)

        # Add a default slave (0 or 255) for broadcast
        slaves[0] = self._create_slave_context(None)

        context = ModbusServerContext(slaves=slaves, single=False)

        # Server identification
        identity = ModbusDeviceIdentification()
        identity.VendorName = "Solar Diesel Controller"
        identity.ProductCode = "SDC-SIM"
        identity.VendorUrl = "https://github.com/example/solar-diesel-controller"
        identity.ProductName = "Virtual Site Simulator"
        identity.ModelName = "SDC-SIM-1.0"

        logger.info(f"Starting Modbus TCP server on {self.host}:{self.port}")
        logger.info("Press Ctrl+C to stop")

        # Start periodic status updates
        asyncio.create_task(self._status_loop())

        # Start the server
        await StartAsyncTcpServer(
            context=context,
            identity=identity,
            address=(self.host, self.port),
        )

    async def _status_loop(self):
        """Periodically print site status."""
        while True:
            await asyncio.sleep(10)  # Print every 10 seconds
            self.site.print_status()


async def run_simulation(
    load_kw: float = 300.0,
    solar_kw: float = 150.0,
    port: int = 5020,
    scenario: Optional[str] = None
):
    """
    Main entry point for running the simulation.

    Args:
        load_kw: Initial load in kW
        solar_kw: Available solar power in kW
        port: Modbus TCP port
        scenario: Name of predefined scenario to run
    """
    # Create site configuration
    config = SiteConfig(
        name="Stone Crushing Site 1",
        location="UAE",
        dg_reserve_kw=50.0,
    )

    # Create virtual site
    site = VirtualSite(config)

    # Set initial conditions
    site.set_load(load_kw)
    site.set_available_solar(solar_kw)

    # Run predefined scenario if specified
    if scenario:
        await run_scenario(site, scenario)
        return

    # Print initial status
    site.print_status()

    # Create and run server
    server = SimulatorServer(site, port=port)
    await server.run()


async def run_scenario(site: VirtualSite, scenario_name: str):
    """
    Run a predefined test scenario.

    Args:
        site: Virtual site
        scenario_name: Name of the scenario
    """
    logger.info(f"Running scenario: {scenario_name}")

    if scenario_name == "high_load":
        # Simulate high load scenario
        for load in [300, 400, 500, 600, 700]:
            site.set_load(load)
            site.print_status()
            await asyncio.sleep(2)

    elif scenario_name == "cloud_cover":
        # Simulate cloud cover reducing solar
        site.set_load(300)
        for solar in [150, 100, 50, 0, 50, 100, 150]:
            site.set_available_solar(solar)
            site.print_status()
            await asyncio.sleep(2)

    elif scenario_name == "normal":
        # Normal operation
        site.set_load(300)
        site.set_available_solar(150)
        site.print_status()

    else:
        logger.error(f"Unknown scenario: {scenario_name}")
        logger.info("Available scenarios: high_load, cloud_cover, normal")


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Run the virtual site simulation for testing"
    )
    parser.add_argument(
        "--load", type=float, default=300.0,
        help="Initial site load in kW (default: 300)"
    )
    parser.add_argument(
        "--solar", type=float, default=150.0,
        help="Available solar power in kW (default: 150)"
    )
    parser.add_argument(
        "--port", type=int, default=5020,
        help="Modbus TCP port (default: 5020)"
    )
    parser.add_argument(
        "--scenario", type=str, default=None,
        help="Run predefined scenario (high_load, cloud_cover, normal)"
    )

    args = parser.parse_args()

    try:
        asyncio.run(run_simulation(
            load_kw=args.load,
            solar_kw=args.solar,
            port=args.port,
            scenario=args.scenario,
        ))
    except KeyboardInterrupt:
        logger.info("Simulation stopped by user")
    except Exception as e:
        logger.error(f"Simulation error: {e}")
        raise


if __name__ == "__main__":
    main()
