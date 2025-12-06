"""
Virtual Solar Inverter (Sungrow SG150KTL-M-like)

Simulates a solar inverter with power limiting capability.
This is used for testing the controller without physical hardware.

Register Map (based on Sungrow):
- 5006: Inverter Control (0xCF=Start, 0xCE=Stop, 0xBB=E-Stop)
- 5007: Power Limitation Switch (0xAA=Enable, 0x55=Disable)
- 5008: Active Power Limit (0-100%)
- 5031: Active Power Output (0.1 kW)
- 5038: Inverter State
- 5011: AC Output Voltage (0.1 V)
- 5012: AC Output Current (0.1 A)
- 5001: DC Voltage (0.1 V)
- 5002: DC Current (0.01 A)
"""

import logging
from dataclasses import dataclass
from typing import Optional

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Inverter control codes
INVERTER_START = 0xCF
INVERTER_STOP = 0xCE
INVERTER_ESTOP = 0xBB

# Power limitation codes
LIMIT_ENABLE = 0xAA
LIMIT_DISABLE = 0x55


@dataclass
class InverterState:
    """
    Holds the current inverter state.
    """
    # Control state
    is_running: bool = True
    limit_enabled: bool = True
    power_limit_percent: int = 100  # 0-100%

    # Simulated environmental conditions
    max_available_power_kw: float = 150.0  # Maximum PV power available

    # Actual output (calculated from limit and available power)
    actual_output_kw: float = 150.0

    # Electrical readings
    ac_voltage: float = 380.0  # V (3-phase line voltage)
    ac_current: float = 0.0    # A
    dc_voltage: float = 600.0  # V
    dc_current: float = 0.0    # A


class VirtualInverter:
    """
    Simulates a Sungrow SG150KTL-M solar inverter.

    This class manages the register memory and provides methods
    to update readings and handle Modbus requests.
    """

    # Register addresses (Sungrow style)
    REG_CONTROL = 5006      # Holding register
    REG_LIMIT_SWITCH = 5007 # Holding register
    REG_POWER_LIMIT = 5008  # Holding register
    REG_ACTIVE_POWER = 5031 # Input register (0.1 kW scale)
    REG_STATE = 5038        # Input register
    REG_AC_VOLTAGE = 5011   # Input register (0.1 V scale)
    REG_AC_CURRENT = 5012   # Input register (0.1 A scale)
    REG_DC_VOLTAGE = 5001   # Input register (0.1 V scale)
    REG_DC_CURRENT = 5002   # Input register (0.01 A scale)

    def __init__(
        self,
        slave_id: int = 1,
        name: str = "Solar Inverter 1",
        rated_power_kw: float = 150.0
    ):
        """
        Initialize the virtual inverter.

        Args:
            slave_id: Modbus slave ID (default 1, matching plan)
            name: Friendly name for logging
            rated_power_kw: Rated power capacity in kW
        """
        self.slave_id = slave_id
        self.name = name
        self.rated_power_kw = rated_power_kw
        self.state = InverterState(max_available_power_kw=rated_power_kw)

        # Holding registers (read/write)
        self._holding_registers: dict[int, int] = {
            self.REG_CONTROL: INVERTER_START,
            self.REG_LIMIT_SWITCH: LIMIT_ENABLE,
            self.REG_POWER_LIMIT: 100,  # 100% = no limit
        }

        # Input registers (read-only)
        self._input_registers: dict[int, int] = {}

        # Initialize with current state
        self._update_output()

        logger.info(f"Virtual inverter '{name}' initialized "
                   f"(slave ID: {slave_id}, rated: {rated_power_kw} kW)")

    def _update_output(self):
        """
        Calculate and update the actual output based on:
        1. Is inverter running?
        2. Is power limit enabled?
        3. What is the power limit %?
        4. What is the available solar power?
        """
        if not self.state.is_running:
            # Inverter stopped - no output
            self.state.actual_output_kw = 0.0
        elif self.state.limit_enabled:
            # Apply power limit
            max_allowed = self.rated_power_kw * (self.state.power_limit_percent / 100.0)
            self.state.actual_output_kw = min(
                max_allowed,
                self.state.max_available_power_kw
            )
        else:
            # No limit - output whatever is available
            self.state.actual_output_kw = min(
                self.rated_power_kw,
                self.state.max_available_power_kw
            )

        # Calculate currents from power and voltage
        if self.state.ac_voltage > 0:
            # AC current = Power / (sqrt(3) * Voltage) for 3-phase
            self.state.ac_current = (
                self.state.actual_output_kw * 1000 / (1.732 * self.state.ac_voltage)
            )

        if self.state.dc_voltage > 0:
            # DC current = Power / Voltage
            self.state.dc_current = (
                self.state.actual_output_kw * 1000 / self.state.dc_voltage
            )

        # Update input registers with scaled values
        self._input_registers[self.REG_ACTIVE_POWER] = int(
            self.state.actual_output_kw * 10  # Scale: 0.1 kW
        )
        self._input_registers[self.REG_AC_VOLTAGE] = int(
            self.state.ac_voltage * 10  # Scale: 0.1 V
        )
        self._input_registers[self.REG_AC_CURRENT] = int(
            self.state.ac_current * 10  # Scale: 0.1 A
        )
        self._input_registers[self.REG_DC_VOLTAGE] = int(
            self.state.dc_voltage * 10  # Scale: 0.1 V
        )
        self._input_registers[self.REG_DC_CURRENT] = int(
            self.state.dc_current * 100  # Scale: 0.01 A
        )
        self._input_registers[self.REG_STATE] = 1 if self.state.is_running else 0

    def set_available_power(self, power_kw: float):
        """
        Set the available solar power (simulates irradiance changes).

        Args:
            power_kw: Available power from PV array in kW
        """
        self.state.max_available_power_kw = min(power_kw, self.rated_power_kw)
        self._update_output()
        logger.debug(f"{self.name}: Available PV power set to {power_kw:.1f} kW")

    def write_register(self, address: int, value: int) -> bool:
        """
        Handle a Modbus write to a holding register.

        Args:
            address: Register address
            value: Value to write

        Returns:
            True if write was successful
        """
        if address == self.REG_CONTROL:
            # Inverter control command
            if value == INVERTER_START:
                self.state.is_running = True
                logger.info(f"{self.name}: Started")
            elif value == INVERTER_STOP:
                self.state.is_running = False
                logger.info(f"{self.name}: Stopped")
            elif value == INVERTER_ESTOP:
                self.state.is_running = False
                logger.warning(f"{self.name}: Emergency stop!")
            else:
                logger.warning(f"{self.name}: Unknown control code: {value:#x}")
                return False
            self._holding_registers[address] = value

        elif address == self.REG_LIMIT_SWITCH:
            # Power limitation switch
            if value == LIMIT_ENABLE:
                self.state.limit_enabled = True
                logger.info(f"{self.name}: Power limit ENABLED")
            elif value == LIMIT_DISABLE:
                self.state.limit_enabled = False
                logger.info(f"{self.name}: Power limit DISABLED")
            else:
                logger.warning(f"{self.name}: Unknown limit switch value: {value:#x}")
                return False
            self._holding_registers[address] = value

        elif address == self.REG_POWER_LIMIT:
            # Active power limit (0-100%)
            if 0 <= value <= 100:
                old_limit = self.state.power_limit_percent
                self.state.power_limit_percent = value
                self._holding_registers[address] = value
                logger.info(f"{self.name}: Power limit set to {value}% "
                           f"(was {old_limit}%)")
            else:
                logger.warning(f"{self.name}: Invalid power limit: {value}%")
                return False

        else:
            logger.warning(f"{self.name}: Write to unknown register: {address}")
            return False

        # Recalculate output after any write
        self._update_output()
        return True

    def read_holding_registers(self, start_address: int, count: int) -> list[int]:
        """
        Read holding register values (for Modbus responses).

        Args:
            start_address: Starting register address
            count: Number of registers to read

        Returns:
            List of register values
        """
        values = []
        for addr in range(start_address, start_address + count):
            values.append(self._holding_registers.get(addr, 0))
        return values

    def read_input_registers(self, start_address: int, count: int) -> list[int]:
        """
        Read input register values (for Modbus responses).

        Args:
            start_address: Starting register address
            count: Number of registers to read

        Returns:
            List of register values
        """
        values = []
        for addr in range(start_address, start_address + count):
            values.append(self._input_registers.get(addr, 0))
        return values

    def get_power_limit_percent(self) -> int:
        """Get current power limit percentage."""
        return self.state.power_limit_percent

    def get_actual_output_kw(self) -> float:
        """Get actual power output in kW."""
        return self.state.actual_output_kw

    def __repr__(self) -> str:
        return (f"VirtualInverter(name='{self.name}', "
                f"limit={self.state.power_limit_percent}%, "
                f"output={self.state.actual_output_kw:.1f}kW)")


# Example usage and testing
if __name__ == "__main__":
    # Create a virtual inverter
    inverter = VirtualInverter(
        slave_id=1,
        name="Solar Inverter 1",
        rated_power_kw=150.0
    )

    # Set available solar power (simulating sunny day)
    inverter.set_available_power(150.0)
    print(f"\n{inverter}")

    # Simulate controller writing a power limit
    print("\n--- Setting power limit to 50% ---")
    inverter.write_register(VirtualInverter.REG_POWER_LIMIT, 50)
    print(f"{inverter}")
    print(f"Power limit register value: {inverter.read_holding_registers(5008, 1)}")
    print(f"Active power output (scaled): {inverter.read_input_registers(5031, 1)}")
    print(f"Actual output: {inverter.get_actual_output_kw():.1f} kW")

    # Simulate stopping the inverter
    print("\n--- Stopping inverter ---")
    inverter.write_register(VirtualInverter.REG_CONTROL, INVERTER_STOP)
    print(f"{inverter}")
