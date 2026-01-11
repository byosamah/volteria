#!/usr/bin/env python3
"""
Service Validation Script

Tests that all 5-layer services can be imported and instantiated.
Run this to verify the new architecture is properly set up.

Usage:
    python test_services.py
"""

import sys


def test_imports():
    """Test that all services can be imported"""
    print("=" * 60)
    print("Testing Service Imports")
    print("=" * 60)

    results = []

    # Layer 1: System Service
    try:
        from services.system.service import SystemService
        results.append(("System Service (Layer 1)", True, None))
        print("[OK] System Service imports successfully")
    except Exception as e:
        results.append(("System Service (Layer 1)", False, str(e)))
        print(f"[FAIL] System Service: {e}")

    # Layer 2: Config Service
    try:
        from services.config.service import ConfigService
        results.append(("Config Service (Layer 2)", True, None))
        print("[OK] Config Service imports successfully")
    except Exception as e:
        results.append(("Config Service (Layer 2)", False, str(e)))
        print(f"[FAIL] Config Service: {e}")

    # Layer 3: Device Service
    try:
        from services.device.service import DeviceService
        results.append(("Device Service (Layer 3)", True, None))
        print("[OK] Device Service imports successfully")
    except Exception as e:
        results.append(("Device Service (Layer 3)", False, str(e)))
        print(f"[FAIL] Device Service: {e}")

    # Layer 4: Control Service
    try:
        from services.control.service import ControlService
        results.append(("Control Service (Layer 4)", True, None))
        print("[OK] Control Service imports successfully")
    except Exception as e:
        results.append(("Control Service (Layer 4)", False, str(e)))
        print(f"[FAIL] Control Service: {e}")

    # Layer 5: Logging Service
    try:
        from services.logging.service import LoggingService
        results.append(("Logging Service (Layer 5)", True, None))
        print("[OK] Logging Service imports successfully")
    except Exception as e:
        results.append(("Logging Service (Layer 5)", False, str(e)))
        print(f"[FAIL] Logging Service: {e}")

    # Supervisor
    try:
        from supervisor import Supervisor
        results.append(("Supervisor", True, None))
        print("[OK] Supervisor imports successfully")
    except Exception as e:
        results.append(("Supervisor", False, str(e)))
        print(f"[FAIL] Supervisor: {e}")

    # Common modules
    try:
        from common.state import SharedState
        from common.config import SiteConfig, ControllerConfig
        results.append(("Common modules", True, None))
        print("[OK] Common modules import successfully")
    except Exception as e:
        results.append(("Common modules", False, str(e)))
        print(f"[FAIL] Common modules: {e}")

    return results


def test_instantiation():
    """Test that all services can be instantiated"""
    print("\n" + "=" * 60)
    print("Testing Service Instantiation")
    print("=" * 60)

    results = []

    from services.system.service import SystemService
    from services.config.service import ConfigService
    from services.device.service import DeviceService
    from services.control.service import ControlService
    from services.logging.service import LoggingService
    from supervisor import Supervisor

    services = [
        ("SystemService", SystemService),
        ("ConfigService", ConfigService),
        ("DeviceService", DeviceService),
        ("ControlService", ControlService),
        ("LoggingService", LoggingService),
        ("Supervisor", Supervisor),
    ]

    for name, cls in services:
        try:
            instance = cls()
            results.append((name, True, None))
            print(f"[OK] {name} instantiated successfully")
        except Exception as e:
            results.append((name, False, str(e)))
            print(f"[FAIL] {name}: {e}")

    return results


def test_shared_state():
    """Test SharedState IPC mechanism"""
    print("\n" + "=" * 60)
    print("Testing SharedState IPC")
    print("=" * 60)

    from common.state import SharedState

    results = []

    # Test write
    try:
        test_data = {"test_key": "test_value", "count": 42}
        SharedState.write("_test_validation", test_data)
        results.append(("SharedState.write()", True, None))
        print("[OK] SharedState.write() works")
    except Exception as e:
        results.append(("SharedState.write()", False, str(e)))
        print(f"[FAIL] SharedState.write(): {e}")
        return results

    # Test read
    try:
        read_data = SharedState.read("_test_validation")
        assert read_data.get("test_key") == "test_value"
        assert read_data.get("count") == 42
        results.append(("SharedState.read()", True, None))
        print("[OK] SharedState.read() works")
    except Exception as e:
        results.append(("SharedState.read()", False, str(e)))
        print(f"[FAIL] SharedState.read(): {e}")

    # Test update
    try:
        SharedState.update("_test_validation", {"count": 100})
        read_data = SharedState.read("_test_validation")
        assert read_data.get("count") == 100
        results.append(("SharedState.update()", True, None))
        print("[OK] SharedState.update() works")
    except Exception as e:
        results.append(("SharedState.update()", False, str(e)))
        print(f"[FAIL] SharedState.update(): {e}")

    # Cleanup
    try:
        SharedState.delete("_test_validation")
        results.append(("SharedState.delete()", True, None))
        print("[OK] SharedState.delete() works")
    except Exception as e:
        results.append(("SharedState.delete()", False, str(e)))
        print(f"[FAIL] SharedState.delete(): {e}")

    return results


def main():
    """Run all validation tests"""
    print("\n")
    print("*" * 60)
    print("*  Volteria Controller - Service Validation")
    print("*  Testing 5-Layer Architecture")
    print("*" * 60)

    all_results = []

    # Run tests
    all_results.extend(test_imports())
    all_results.extend(test_instantiation())
    all_results.extend(test_shared_state())

    # Summary
    print("\n" + "=" * 60)
    print("VALIDATION SUMMARY")
    print("=" * 60)

    passed = sum(1 for _, success, _ in all_results if success)
    failed = sum(1 for _, success, _ in all_results if not success)

    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print(f"Total:  {len(all_results)}")

    if failed > 0:
        print("\nFailed tests:")
        for name, success, error in all_results:
            if not success:
                print(f"  - {name}: {error}")
        print("\n[VALIDATION FAILED]")
        return 1
    else:
        print("\n[ALL TESTS PASSED]")
        return 0


if __name__ == "__main__":
    sys.exit(main())
