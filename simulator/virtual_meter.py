"""
Virtual Load Meter (Meatrol ME431-like)

Simulates a 3-phase energy meter with Modbus RTU registers.
This is used for testing the controller without physical hardware.

Register Map (based on Meatrol ME431):
- 1000-1005: Phase voltages (A, B, C)
- 1016-1021: Phase currents (A, B, C)
- 1032-1033: Total active power (W)
- 1040-1041: Total reactive power (VAr)
- 1048-1049: Total apparent power (VA)
- 1056-1057: Power factor
- 1066-1067: Grid frequency (Hz)
"""

import struct
import logging
from dataclasses import dataclass
from typing import Optional

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class MeterReadings:
    """
    Holds the current meter readings.
    All values use standard units (V, A, W, Hz).
    """
    # Phase voltages (V)
    voltage_a: float = 230.0
    voltage_b: float = 230.0
    voltage_c: float = 230.0

    # Phase currents (A)
    current_a: float = 100.0
    current_b: float = 100.0
    current_c: float = 100.0

    # Power readings
    total_active_power: float = 69000.0  # W (230V * 100A * 3 = 69kW)
    total_reactive_power: float = 0.0     # VAr
    total_apparent_power: float = 69000.0 # VA

    # Other
    power_factor: float = 1.0
    frequency: float = 50.0  # Hz (UAE uses 50Hz grid)


class VirtualMeter:
    """
    Simulates a Meatrol ME431 energy meter.

    This class manages the register memory and provides methods
    to update readings and handle Modbus requests.
    """

    # Register addresses (Meatrol ME431 style)
    # Using float32 (2 registers each)
    REG_VOLTAGE_A = 1000
    REG_VOLTAGE_B = 1002
    REG_VOLTAGE_C = 1004
    REG_CURRENT_A = 1016
    REG_CURRENT_B = 1018
    REG_CURRENT_C = 1020
    REG_ACTIVE_POWER = 1032
    REG_REACTIVE_POWER = 1040
    REG_APPARENT_POWER = 1048
    REG_POWER_FACTOR = 1056
    REG_FREQUENCY = 1066

    def __init__(self, slave_id: int = 2, name: str = "Load Meter A"):
        """
        Initialize the virtual meter.

        Args:
            slave_id: Modbus slave ID (default 2, matching plan)
            name: Friendly name for logging
        """
        self.slave_id = slave_id
        self.name = name
        self.readings = MeterReadings()

        # Register memory (address -> 16-bit value)
        # We use a dict to store only the registers we need
        self._registers: dict[int, int] = {}

        # Initialize registers with current readings
        self._update_registers()

        logger.info(f"Virtual meter '{name}' initialized (slave ID: {slave_id})")

    def _float_to_registers(self, value: float) -> tuple[int, int]:
        """
        Convert a float32 to two 16-bit register values.

        Modbus uses big-endian byte order for float32 values.
        Each float32 spans 2 consecutive 16-bit registers.

        Args:
            value: The float value to convert

        Returns:
            Tuple of (high_word, low_word)
        """
        # Pack as big-endian float32
        packed = struct.pack('>f', value)
        # Unpack as two big-endian unsigned 16-bit integers
        high_word, low_word = struct.unpack('>HH', packed)
        return high_word, low_word

    def _registers_to_float(self, high_word: int, low_word: int) -> float:
        """
        Convert two 16-bit register values to a float32.

        Args:
            high_word: The first (high) register value
            low_word: The second (low) register value

        Returns:
            The float value
        """
        packed = struct.pack('>HH', high_word, low_word)
        value, = struct.unpack('>f', packed)
        return value

    def _update_registers(self):
        """
        Update the register memory with current readings.
        Call this after changing any values in self.readings.
        """
        # Helper to set a float32 value at a register address
        def set_float(addr: int, value: float):
            high, low = self._float_to_registers(value)
            self._registers[addr] = high
            self._registers[addr + 1] = low

        # Update all registers
        set_float(self.REG_VOLTAGE_A, self.readings.voltage_a)
        set_float(self.REG_VOLTAGE_B, self.readings.voltage_b)
        set_float(self.REG_VOLTAGE_C, self.readings.voltage_c)
        set_float(self.REG_CURRENT_A, self.readings.current_a)
        set_float(self.REG_CURRENT_B, self.readings.current_b)
        set_float(self.REG_CURRENT_C, self.readings.current_c)
        set_float(self.REG_ACTIVE_POWER, self.readings.total_active_power)
        set_float(self.REG_REACTIVE_POWER, self.readings.total_reactive_power)
        set_float(self.REG_APPARENT_POWER, self.readings.total_apparent_power)
        set_float(self.REG_POWER_FACTOR, self.readings.power_factor)
        set_float(self.REG_FREQUENCY, self.readings.frequency)

    def set_load(self, power_kw: float):
        """
        Set the simulated load power.

        This is a convenience method that calculates phase values
        from the total power assuming balanced 3-phase load.

        Args:
            power_kw: Total active power in kW
        """
        power_w = power_kw * 1000

        # Calculate balanced 3-phase values
        # P = sqrt(3) * V * I * pf for 3-phase
        # For simplicity, assume pf = 1 and balanced phases
        phase_power = power_w / 3

        # Calculate current per phase (I = P / V)
        current_per_phase = phase_power / self.readings.voltage_a

        # Update readings
        self.readings.total_active_power = power_w
        self.readings.total_apparent_power = power_w  # pf = 1
        self.readings.current_a = current_per_phase
        self.readings.current_b = current_per_phase
        self.readings.current_c = current_per_phase

        # Update register memory
        self._update_registers()

        logger.info(f"{self.name}: Load set to {power_kw:.1f} kW "
                   f"({current_per_phase:.1f} A/phase)")

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
            # Return 0 for uninitialized registers
            values.append(self._registers.get(addr, 0))
        return values

    def get_active_power_kw(self) -> float:
        """Get total active power in kW."""
        return self.readings.total_active_power / 1000

    def __repr__(self) -> str:
        return (f"VirtualMeter(name='{self.name}', "
                f"slave_id={self.slave_id}, "
                f"load={self.get_active_power_kw():.1f}kW)")


# Example usage and testing
if __name__ == "__main__":
    # Create a virtual meter
    meter = VirtualMeter(slave_id=2, name="Load Meter A")

    # Set initial load
    meter.set_load(150.0)  # 150 kW

    # Read some registers (simulating Modbus read)
    print(f"\n{meter}")
    print(f"Active Power Register (1032-1033): {meter.read_registers(1032, 2)}")

    # Convert back to float to verify
    regs = meter.read_registers(1032, 2)
    power = meter._registers_to_float(regs[0], regs[1])
    print(f"Decoded Active Power: {power:.1f} W ({power/1000:.1f} kW)")
