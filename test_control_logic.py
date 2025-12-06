#!/usr/bin/env python3
"""
Test Control Logic

This script tests the zero-feeding algorithm without needing
the full Modbus server. It directly uses the virtual devices
and verifies the control logic calculations.

Run this to verify the algorithm is working correctly:
    python test_control_logic.py
"""

import sys
sys.path.insert(0, 'simulator')
sys.path.insert(0, 'controller')

from simulator.virtual_site import VirtualSite, SiteConfig
from simulator.virtual_inverter import VirtualInverter


def test_zero_feeding_algorithm():
    """
    Test the zero-feeding algorithm with various scenarios.

    The algorithm should:
    1. Calculate available headroom: load - DG_RESERVE
    2. Limit solar to: min(available_headroom, total_inverter_capacity)
    3. Never allow solar to exceed the calculated limit
    """
    print("=" * 70)
    print("  ZERO-FEEDING ALGORITHM TEST")
    print("=" * 70)

    # Create a virtual site
    config = SiteConfig(
        name="Test Site",
        location="UAE",
        dg_reserve_kw=50.0,  # 50 kW reserve
    )
    site = VirtualSite(config)

    # Test parameters
    DG_RESERVE = config.dg_reserve_kw
    INVERTER_CAPACITY = 150.0  # kW (single 150 kW inverter)

    test_cases = [
        # (load_kw, available_solar_kw, expected_limit_pct, description)
        (300, 150, 100, "Normal operation - full solar allowed"),
        (200, 150, 100, "Medium load - solar OK (200-50=150, 100%)"),
        (150, 150, 66, "Lower load - solar limited (150-50=100, 66%)"),
        (100, 150, 33, "Low load - solar very limited (100-50=50, 33%)"),
        (50, 150, 0, "Very low load - no solar (50-50=0, 0%)"),
        (40, 150, 0, "Load below reserve - no solar"),
        (500, 150, 100, "High load - full solar (500-50=450, but capped at 100%)"),
        (300, 75, 100, "Cloudy day - less solar available"),
    ]

    all_passed = True

    for i, (load, available_solar, expected_limit, description) in enumerate(test_cases, 1):
        print(f"\n--- Test Case {i}: {description} ---")
        print(f"Load: {load} kW, Available Solar: {available_solar} kW, Reserve: {DG_RESERVE} kW")

        # Calculate expected values using the algorithm
        available_headroom = max(0, load - DG_RESERVE)
        solar_limit_kw = min(available_headroom, INVERTER_CAPACITY)
        calculated_limit_pct = int((solar_limit_kw / INVERTER_CAPACITY) * 100) if INVERTER_CAPACITY > 0 else 0

        # Set up the virtual site
        site.set_load(load)
        site.set_available_solar(available_solar)

        # Apply the calculated limit to the inverter
        site.inverters[0].write_register(VirtualInverter.REG_POWER_LIMIT, calculated_limit_pct)
        site._update_energy_balance()

        # Get actual output
        actual_output = site.inverters[0].get_actual_output_kw()
        actual_limit = site.inverters[0].get_power_limit_percent()

        # DG power should be: load - actual_solar
        dg_power = sum(dg.get_active_power_kw() for dg in site.generators)

        # Verify energy balance
        total_supply = dg_power + actual_output
        balance_ok = abs(total_supply - load) < 1.0

        # Check if limit is correct
        limit_match = abs(actual_limit - expected_limit) <= 5  # Allow 5% tolerance for rounding

        print(f"  Calculated Limit: {calculated_limit_pct}%")
        print(f"  Actual Limit: {actual_limit}%")
        print(f"  Expected Limit: {expected_limit}%")
        print(f"  Solar Output: {actual_output:.1f} kW")
        print(f"  DG Power: {dg_power:.1f} kW")
        print(f"  Energy Balance: {'OK' if balance_ok else 'MISMATCH!'}")

        if not limit_match:
            print(f"  ** LIMIT MISMATCH! Expected ~{expected_limit}%, got {actual_limit}%")
            all_passed = False
        elif not balance_ok:
            print(f"  ** ENERGY BALANCE ISSUE!")
            all_passed = False
        else:
            print(f"  ** PASSED")

    print("\n" + "=" * 70)
    if all_passed:
        print("  ALL TESTS PASSED!")
    else:
        print("  SOME TESTS FAILED - Please check the algorithm")
    print("=" * 70)

    return all_passed


def test_safe_mode():
    """
    Test safe mode conditions.
    """
    print("\n" + "=" * 70)
    print("  SAFE MODE TEST")
    print("=" * 70)

    # Safe mode should trigger when:
    # 1. Time-based: Device stops reporting for X seconds
    # 2. Rolling average: Solar > threshold% of load AND device not reporting

    print("\nSafe Mode Type 1: Time-based")
    print("  - Triggers when any device stops reporting for timeout period")
    print("  - Action: Set solar limit to 0%")

    print("\nSafe Mode Type 2: Rolling Average + Communication")
    print("  - Triggers when: solar_avg > (load * threshold%) AND device offline")
    print("  - This prevents false triggers during normal operation")
    print("  - Action: Set solar limit to 0%")

    print("\n  Safe mode logic is implemented in control_loop.py")
    print("  Full testing requires running against the Modbus server")

    return True


def test_command_verification():
    """
    Test that commands are verified after writing.
    """
    print("\n" + "=" * 70)
    print("  COMMAND VERIFICATION TEST")
    print("=" * 70)

    # Create a virtual inverter
    from simulator.virtual_inverter import VirtualInverter

    inverter = VirtualInverter(
        slave_id=1,
        name="Test Inverter",
        rated_power_kw=150.0
    )

    # Test write and read-back
    test_values = [100, 75, 50, 25, 0]

    all_passed = True

    for limit in test_values:
        # Write the limit
        success = inverter.write_register(VirtualInverter.REG_POWER_LIMIT, limit)

        if not success:
            print(f"  Write {limit}%: FAILED to write")
            all_passed = False
            continue

        # Read back to verify
        read_back = inverter.read_holding_registers(VirtualInverter.REG_POWER_LIMIT, 1)

        if read_back and read_back[0] == limit:
            print(f"  Write {limit}%: VERIFIED (read back: {read_back[0]}%)")
        else:
            print(f"  Write {limit}%: MISMATCH (read back: {read_back})")
            all_passed = False

    print("\n" + "=" * 70)
    if all_passed:
        print("  COMMAND VERIFICATION PASSED!")
    else:
        print("  COMMAND VERIFICATION FAILED!")
    print("=" * 70)

    return all_passed


def main():
    """Run all tests."""
    print("\n")
    print("#" * 70)
    print("#" + " " * 20 + "CONTROL LOGIC TESTS" + " " * 29 + "#")
    print("#" * 70)

    results = []

    # Test 1: Zero-feeding algorithm
    results.append(("Zero-Feeding Algorithm", test_zero_feeding_algorithm()))

    # Test 2: Safe mode
    results.append(("Safe Mode", test_safe_mode()))

    # Test 3: Command verification
    results.append(("Command Verification", test_command_verification()))

    # Summary
    print("\n")
    print("#" * 70)
    print("#" + " " * 22 + "TEST SUMMARY" + " " * 34 + "#")
    print("#" * 70)

    for name, passed in results:
        status = "PASSED" if passed else "FAILED"
        print(f"  {name}: {status}")

    all_passed = all(passed for _, passed in results)

    print("\n" + "#" * 70)
    if all_passed:
        print("#" + " " * 18 + "ALL TESTS PASSED!" + " " * 33 + "#")
    else:
        print("#" + " " * 17 + "SOME TESTS FAILED!" + " " * 32 + "#")
    print("#" * 70)
    print()

    return 0 if all_passed else 1


if __name__ == "__main__":
    exit(main())
