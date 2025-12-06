"""
Virtual Site Simulation

Combines virtual DGs, inverters, and load meters to simulate
a complete off-grid site for testing the controller.

This module creates a realistic simulation where:
1. Load meters measure total site load
2. DGs provide power to meet load
3. Solar inverters contribute power (limited by controller)
4. The energy balance is maintained: load = dg_power + solar_power
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from virtual_meter import VirtualMeter
from virtual_inverter import VirtualInverter
from virtual_dg import VirtualDG

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class SiteConfig:
    """
    Configuration for the virtual site.
    """
    # Site identification
    name: str = "Stone Crushing Site 1"
    location: str = "UAE"

    # Control settings
    dg_reserve_kw: float = 50.0  # Minimum DG reserve

    # Simulation settings
    update_interval_ms: int = 1000  # How often to update simulation


class VirtualSite:
    """
    Simulates a complete off-grid site with DGs, solar, and load.

    Energy balance: load = sum(dg_power) + sum(solar_power)

    The simulation maintains this balance by adjusting DG output
    based on load and solar contribution.
    """

    def __init__(self, config: Optional[SiteConfig] = None):
        """
        Initialize the virtual site with default devices.

        Args:
            config: Site configuration (uses defaults if not provided)
        """
        self.config = config or SiteConfig()

        # Create devices based on the example site from the plan:
        # - 2 load meters
        # - 1 solar inverter (150 kW)
        # - 8 DGs (800 kVA each)

        # Load meters (Meatrol ME431)
        self.load_meters = [
            VirtualMeter(slave_id=2, name="Load Meter A"),
            VirtualMeter(slave_id=3, name="Load Meter B"),
        ]

        # Solar inverter (Sungrow 150 kW)
        self.inverters = [
            VirtualInverter(slave_id=1, name="Solar Inverter 1", rated_power_kw=150.0),
        ]

        # Diesel generators (ComAp InteliGen 500)
        self.generators = [
            VirtualDG(ip_address=f"192.168.1.{30+i}", name=f"DG-{i+1}", rated_power_kva=800)
            for i in range(8)
        ]

        # Simulation state
        self._total_load_kw: float = 300.0  # Initial load
        self._available_solar_kw: float = 150.0  # Available solar (sunny day)
        self._running = False

        logger.info(f"Virtual site '{self.config.name}' initialized")
        logger.info(f"  - {len(self.load_meters)} load meters")
        logger.info(f"  - {len(self.inverters)} inverters")
        logger.info(f"  - {len(self.generators)} DGs")

    def set_load(self, load_kw: float):
        """
        Set the total site load.

        This updates the load meters and recalculates the energy balance.

        Args:
            load_kw: Total site load in kW
        """
        self._total_load_kw = load_kw

        # Distribute load evenly across meters
        load_per_meter = load_kw / len(self.load_meters)
        for meter in self.load_meters:
            meter.set_load(load_per_meter)

        # Update energy balance
        self._update_energy_balance()

        logger.info(f"Site load set to {load_kw:.1f} kW")

    def set_available_solar(self, power_kw: float):
        """
        Set the available solar power (simulates irradiance).

        Args:
            power_kw: Available solar power in kW
        """
        self._available_solar_kw = power_kw

        # Update inverter available power
        for inverter in self.inverters:
            inverter.set_available_power(power_kw / len(self.inverters))

        # Update energy balance
        self._update_energy_balance()

        logger.info(f"Available solar set to {power_kw:.1f} kW")

    def _update_energy_balance(self):
        """
        Update the energy balance across all devices.

        Energy balance: load = sum(dg_power) + sum(solar_power)

        DGs adjust their output to meet the remaining load after solar.
        """
        # Get actual solar output (after controller limit)
        total_solar = sum(inv.get_actual_output_kw() for inv in self.inverters)

        # Remaining load that DGs must cover
        dg_load = self._total_load_kw - total_solar

        # Distribute DG load evenly across running DGs
        running_dgs = [dg for dg in self.generators if dg.is_running()]
        if running_dgs:
            dg_power_each = dg_load / len(running_dgs)
            for dg in running_dgs:
                dg.set_power(max(0, dg_power_each))

    def get_status(self) -> dict:
        """
        Get current site status.

        Returns:
            Dictionary with all readings
        """
        # Total load from meters
        total_load = sum(m.get_active_power_kw() for m in self.load_meters)

        # Total DG power
        dg_power = sum(dg.get_active_power_kw() for dg in self.generators if dg.is_running())

        # Total solar output
        solar_output = sum(inv.get_actual_output_kw() for inv in self.inverters)

        # Current limit on inverters
        solar_limit = self.inverters[0].get_power_limit_percent() if self.inverters else 100

        return {
            "total_load_kw": total_load,
            "dg_power_kw": dg_power,
            "solar_output_kw": solar_output,
            "solar_limit_pct": solar_limit,
            "available_solar_kw": self._available_solar_kw,
            "running_dgs": len([dg for dg in self.generators if dg.is_running()]),
            "dg_reserve_kw": self.config.dg_reserve_kw,
            # Energy balance check
            "balance_ok": abs((dg_power + solar_output) - total_load) < 1.0,
        }

    def print_status(self):
        """Print a formatted status report."""
        status = self.get_status()
        print("\n" + "=" * 60)
        print(f"  VIRTUAL SITE: {self.config.name}")
        print("=" * 60)
        print(f"  Total Load:      {status['total_load_kw']:>8.1f} kW")
        print(f"  DG Power:        {status['dg_power_kw']:>8.1f} kW ({status['running_dgs']} DGs)")
        print(f"  Solar Output:    {status['solar_output_kw']:>8.1f} kW (limit: {status['solar_limit_pct']}%)")
        print(f"  Available Solar: {status['available_solar_kw']:>8.1f} kW")
        print(f"  DG Reserve:      {status['dg_reserve_kw']:>8.1f} kW")
        print("-" * 60)
        balance_status = "OK" if status['balance_ok'] else "MISMATCH!"
        print(f"  Energy Balance:  {balance_status}")
        print("=" * 60)

    def get_device_by_slave_id(self, slave_id: int):
        """
        Get a device by its Modbus slave ID.

        Args:
            slave_id: Modbus slave ID

        Returns:
            The device if found, None otherwise
        """
        # Check meters
        for meter in self.load_meters:
            if meter.slave_id == slave_id:
                return meter

        # Check inverters
        for inverter in self.inverters:
            if inverter.slave_id == slave_id:
                return inverter

        return None

    def get_dg_by_ip(self, ip_address: str) -> Optional[VirtualDG]:
        """
        Get a DG by its IP address.

        Args:
            ip_address: IP address of the DG

        Returns:
            The DG if found, None otherwise
        """
        for dg in self.generators:
            if dg.ip_address == ip_address:
                return dg
        return None


# Example usage and testing
if __name__ == "__main__":
    # Create a virtual site
    site = VirtualSite()

    # Set initial conditions
    site.set_load(300.0)  # 300 kW load
    site.set_available_solar(150.0)  # Full solar available

    # Print initial status
    site.print_status()

    # Simulate controller setting power limit on inverter
    print("\n>>> Controller sets solar limit to 80% <<<")
    site.inverters[0].write_register(VirtualInverter.REG_POWER_LIMIT, 80)
    site._update_energy_balance()
    site.print_status()

    # Simulate controller setting power limit to 50%
    print("\n>>> Controller sets solar limit to 50% <<<")
    site.inverters[0].write_register(VirtualInverter.REG_POWER_LIMIT, 50)
    site._update_energy_balance()
    site.print_status()

    # Simulate load increase
    print("\n>>> Load increases to 500 kW <<<")
    site.set_load(500.0)
    site.print_status()

    # Simulate controller allowing full solar (100%)
    print("\n>>> Controller allows 100% solar <<<")
    site.inverters[0].write_register(VirtualInverter.REG_POWER_LIMIT, 100)
    site._update_energy_balance()
    site.print_status()
