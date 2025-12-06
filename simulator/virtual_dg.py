"""
Virtual DG Controller (ComAp InteliGen 500-like)

Simulates a diesel generator controller with Modbus TCP registers.
This is used for testing the controller without physical hardware.

Note: ComAp register addresses are TBD (need actual documentation).
We use placeholder addresses for simulation purposes.

Simulated Registers:
- 100: Generator Active Power (kW)
- 102: Generator Voltage L1 (V)
- 104: Generator Current L1 (A)
- 106: Generator Frequency (Hz)
- 108: Running Hours
- 110: Engine State (0=Off, 1=Running, 2=Fault)
- 112: GCB Status (0=Open, 1=Closed)
"""

import logging
from dataclasses import dataclass
from typing import Optional

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Engine states
ENGINE_OFF = 0
ENGINE_RUNNING = 1
ENGINE_FAULT = 2

# GCB (Generator Circuit Breaker) states
GCB_OPEN = 0
GCB_CLOSED = 1


@dataclass
class DGState:
    """
    Holds the current DG state.
    """
    # Control state
    is_running: bool = True
    gcb_closed: bool = True  # Generator connected to bus

    # Simulated output
    active_power_kw: float = 400.0  # Current output power
    rated_power_kva: float = 800.0  # Rated capacity

    # Electrical readings
    voltage_l1: float = 380.0  # V (line voltage)
    current_l1: float = 0.0    # A
    frequency: float = 50.0    # Hz

    # Operational
    running_hours: float = 1000.0


class VirtualDG:
    """
    Simulates a ComAp InteliGen 500 DG controller.

    This class manages the register memory and provides methods
    to update readings and handle Modbus requests.
    """

    # Register addresses (placeholder - actual ComAp addresses TBD)
    REG_ACTIVE_POWER = 100    # kW
    REG_VOLTAGE_L1 = 102      # V
    REG_CURRENT_L1 = 104      # A
    REG_FREQUENCY = 106       # Hz
    REG_RUNNING_HOURS = 108   # Hours
    REG_ENGINE_STATE = 110    # State code
    REG_GCB_STATUS = 112      # 0/1

    def __init__(
        self,
        ip_address: str = "192.168.1.30",
        slave_id: int = 1,
        name: str = "DG-1",
        rated_power_kva: float = 800.0
    ):
        """
        Initialize the virtual DG controller.

        Args:
            ip_address: IP address for Modbus TCP
            slave_id: Modbus slave ID (default 1)
            name: Friendly name for logging
            rated_power_kva: Rated apparent power in kVA
        """
        self.ip_address = ip_address
        self.slave_id = slave_id
        self.name = name
        self.rated_power_kva = rated_power_kva
        self.state = DGState(rated_power_kva=rated_power_kva)

        # Input registers (read-only for controller)
        self._registers: dict[int, int] = {}

        # Initialize with current state
        self._update_registers()

        logger.info(f"Virtual DG '{name}' initialized "
                   f"(IP: {ip_address}, rated: {rated_power_kva} kVA)")

    def _update_registers(self):
        """
        Update the register memory with current state.
        """
        # Calculate current from power and voltage
        if self.state.voltage_l1 > 0 and self.state.is_running:
            # I = P / (sqrt(3) * V) for 3-phase
            self.state.current_l1 = (
                self.state.active_power_kw * 1000 / (1.732 * self.state.voltage_l1)
            )
        else:
            self.state.current_l1 = 0.0

        # Update registers
        self._registers[self.REG_ACTIVE_POWER] = int(self.state.active_power_kw)
        self._registers[self.REG_VOLTAGE_L1] = int(self.state.voltage_l1)
        self._registers[self.REG_CURRENT_L1] = int(self.state.current_l1)
        self._registers[self.REG_FREQUENCY] = int(self.state.frequency * 10)  # 0.1 Hz
        self._registers[self.REG_RUNNING_HOURS] = int(self.state.running_hours)

        # Engine state
        if self.state.is_running:
            self._registers[self.REG_ENGINE_STATE] = ENGINE_RUNNING
        else:
            self._registers[self.REG_ENGINE_STATE] = ENGINE_OFF

        # GCB status
        self._registers[self.REG_GCB_STATUS] = (
            GCB_CLOSED if self.state.gcb_closed else GCB_OPEN
        )

    def set_power(self, power_kw: float):
        """
        Set the simulated DG output power.

        In a real system, this would be determined by the load.
        For simulation, we set it directly.

        Args:
            power_kw: Active power output in kW
        """
        # Limit to rated capacity (assume pf=0.8 for kVA to kW)
        max_kw = self.rated_power_kva * 0.8
        self.state.active_power_kw = min(power_kw, max_kw)
        self._update_registers()
        logger.debug(f"{self.name}: Power set to {self.state.active_power_kw:.1f} kW")

    def start(self):
        """Start the DG."""
        self.state.is_running = True
        self.state.gcb_closed = True
        self._update_registers()
        logger.info(f"{self.name}: Started")

    def stop(self):
        """Stop the DG."""
        self.state.is_running = False
        self.state.gcb_closed = False
        self.state.active_power_kw = 0.0
        self._update_registers()
        logger.info(f"{self.name}: Stopped")

    def read_registers(self, start_address: int, count: int) -> list[int]:
        """
        Read register values (for Modbus responses).

        Args:
            start_address: Starting register address
            count: Number of registers to read

        Returns:
            List of register values
        """
        values = []
        for addr in range(start_address, start_address + count):
            values.append(self._registers.get(addr, 0))
        return values

    def get_active_power_kw(self) -> float:
        """Get current active power output in kW."""
        return self.state.active_power_kw

    def is_running(self) -> bool:
        """Check if DG is running."""
        return self.state.is_running

    def __repr__(self) -> str:
        status = "ON" if self.state.is_running else "OFF"
        return (f"VirtualDG(name='{self.name}', "
                f"ip='{self.ip_address}', "
                f"status={status}, "
                f"power={self.state.active_power_kw:.1f}kW)")


# Example usage and testing
if __name__ == "__main__":
    # Create multiple virtual DGs
    dgs = [
        VirtualDG(ip_address="192.168.1.30", name="DG-1", rated_power_kva=800),
        VirtualDG(ip_address="192.168.1.31", name="DG-2", rated_power_kva=800),
    ]

    # Set power levels
    dgs[0].set_power(400)  # 400 kW
    dgs[1].set_power(300)  # 300 kW

    print("\n--- DG Status ---")
    for dg in dgs:
        print(dg)
        print(f"  Active Power Register: {dg.read_registers(100, 1)}")
        print(f"  Engine State Register: {dg.read_registers(110, 1)}")

    # Calculate total DG power
    total_dg_power = sum(dg.get_active_power_kw() for dg in dgs)
    print(f"\nTotal DG Power: {total_dg_power} kW")

    # Stop one DG
    print("\n--- Stopping DG-2 ---")
    dgs[1].stop()
    for dg in dgs:
        print(dg)
