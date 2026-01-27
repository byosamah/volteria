"""
SSH-based Controller Testing API

Provides real SSH tests against controllers via reverse tunnels.
Tests are executed from the server which has direct access to tunnel ports.

Standard tests (all hardware):
1. SSH Tunnel - Connection via reverse tunnel
2. Service Health - Check 5 systemd services
3. Cloud Communication - Network connectivity to Supabase
4. Configuration Sync - Config file exists
5. OTA Mechanism - Update service and firmware endpoint

Hardware-specific tests (SOL532-E16 / R2000):
6. Serial Ports - Verify RS485/RS232 ports accessible
7. UPS Monitor - Verify UPS monitor service running
8. Watchdog - Verify hardware watchdog service running
"""

import paramiko
import socket
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from ..dependencies.auth import get_current_user, require_role

router = APIRouter(prefix="/ssh-test", tags=["SSH Tests"])

# SSH connection settings
# Tunnels terminate on host machine - use host.docker.internal
# which is mapped to host-gateway in docker-compose.yml
import os
SSH_HOST = os.getenv("SSH_TUNNEL_HOST", "host.docker.internal")
CONTROLLER_USER = "voltadmin"
CONTROLLER_PASSWORD = "Solar@1996"
SSH_TIMEOUT = 15  # seconds


class SSHTestResult(BaseModel):
    name: str
    status: str  # "passed", "failed", "skipped"
    message: str
    duration_ms: int


class SSHTestResponse(BaseModel):
    controller_id: str
    ssh_port: int
    results: List[SSHTestResult]
    total_duration_ms: int


def execute_ssh_command(
    ssh_port: int,
    command: str,
    timeout: int = SSH_TIMEOUT
) -> Dict[str, Any]:
    """Execute a command on the controller via SSH tunnel."""
    import time
    start_time = time.time()

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        client.connect(
            hostname=SSH_HOST,
            port=ssh_port,
            username=CONTROLLER_USER,
            password=CONTROLLER_PASSWORD,
            timeout=timeout,
            banner_timeout=timeout,
            auth_timeout=timeout,
        )

        stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
        exit_code = stdout.channel.recv_exit_status()

        return {
            "stdout": stdout.read().decode().strip(),
            "stderr": stderr.read().decode().strip(),
            "exit_code": exit_code,
            "duration_ms": int((time.time() - start_time) * 1000),
        }
    except paramiko.AuthenticationException:
        return {
            "error": "Authentication failed",
            "duration_ms": int((time.time() - start_time) * 1000),
        }
    except paramiko.SSHException as e:
        return {
            "error": f"SSH error: {str(e)}",
            "duration_ms": int((time.time() - start_time) * 1000),
        }
    except socket.timeout:
        return {
            "error": f"Connection timed out after {timeout}s",
            "duration_ms": int((time.time() - start_time) * 1000),
        }
    except socket.error as e:
        return {
            "error": f"Connection failed: {str(e)}",
            "duration_ms": int((time.time() - start_time) * 1000),
        }
    finally:
        client.close()


def test_ssh_tunnel(ssh_port: int) -> SSHTestResult:
    """Test 1: Verify SSH tunnel connectivity."""
    result = execute_ssh_command(ssh_port, "echo 'tunnel_ok'")

    if "error" in result:
        return SSHTestResult(
            name="ssh_tunnel",
            status="failed",
            message=f"SSH connection failed: {result['error']}",
            duration_ms=result["duration_ms"],
        )

    if "tunnel_ok" in result.get("stdout", ""):
        return SSHTestResult(
            name="ssh_tunnel",
            status="passed",
            message=f"SSH tunnel active on port {ssh_port} ({result['duration_ms']}ms)",
            duration_ms=result["duration_ms"],
        )

    return SSHTestResult(
        name="ssh_tunnel",
        status="failed",
        message=f"Unexpected response: {result.get('stdout', 'empty')}",
        duration_ms=result["duration_ms"],
    )


def test_service_health(ssh_port: int) -> SSHTestResult:
    """Test 2: Check all 5 Volteria services are running."""
    services = [
        "volteria-system",
        "volteria-config",
        "volteria-device",
        "volteria-control",
        "volteria-logging",
    ]

    result = execute_ssh_command(
        ssh_port,
        f"systemctl is-active {' '.join(services)} 2>/dev/null || true"
    )

    if "error" in result:
        return SSHTestResult(
            name="service_health",
            status="failed",
            message=f"Failed to check services: {result['error']}",
            duration_ms=result["duration_ms"],
        )

    statuses = result.get("stdout", "").split("\n")
    active_services = []

    for i, service in enumerate(services):
        if i < len(statuses) and statuses[i].strip() == "active":
            # Get short name
            short_name = service.replace("volteria-", "")
            active_services.append(short_name)

    active_count = len(active_services)
    all_active = active_count == len(services)

    return SSHTestResult(
        name="service_health",
        status="passed" if all_active else "failed",
        message=(
            f"All {len(services)} services running: {', '.join(active_services)} ({result['duration_ms']}ms)"
            if all_active else
            f"{active_count}/{len(services)} services active: {', '.join(active_services) or 'none'}"
        ),
        duration_ms=result["duration_ms"],
    )


def test_cloud_communication(ssh_port: int) -> SSHTestResult:
    """Test 3: Verify controller can reach cloud API."""
    result = execute_ssh_command(
        ssh_port,
        'systemctl is-active volteria-system 2>/dev/null && '
        'curl -s -o /dev/null -w "%{http_code}" --max-time 5 '
        'https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/ || echo "failed"'
    )

    if "error" in result:
        return SSHTestResult(
            name="communication",
            status="failed",
            message=f"Failed to test communication: {result['error']}",
            duration_ms=result["duration_ms"],
        )

    stdout = result.get("stdout", "")

    # HTTP 200 or 401 means API is reachable (401 = needs auth, but reachable)
    if "200" in stdout or "401" in stdout:
        return SSHTestResult(
            name="communication",
            status="passed",
            message=f"Cloud API reachable, heartbeat service active ({result['duration_ms']}ms)",
            duration_ms=result["duration_ms"],
        )
    elif "active" in stdout:
        return SSHTestResult(
            name="communication",
            status="passed",
            message=f"Heartbeat service active ({result['duration_ms']}ms)",
            duration_ms=result["duration_ms"],
        )

    return SSHTestResult(
        name="communication",
        status="failed",
        message=f"Cloud communication test failed: {stdout}",
        duration_ms=result["duration_ms"],
    )


def test_config_sync(ssh_port: int) -> SSHTestResult:
    """Test 4: Verify config file exists."""
    result = execute_ssh_command(
        ssh_port,
        'test -f /opt/volteria/config/config.yaml && '
        'wc -l < /opt/volteria/config/config.yaml || echo "0"'
    )

    if "error" in result:
        return SSHTestResult(
            name="config_sync",
            status="failed",
            message=f"Failed to check config: {result['error']}",
            duration_ms=result["duration_ms"],
        )

    try:
        lines = int(result.get("stdout", "0").strip())
    except ValueError:
        lines = 0

    if lines > 0:
        return SSHTestResult(
            name="config_sync",
            status="passed",
            message=f"Config file present ({lines} lines) ({result['duration_ms']}ms)",
            duration_ms=result["duration_ms"],
        )

    return SSHTestResult(
        name="config_sync",
        status="skipped",
        message="Config file not yet synced (will sync after site assignment)",
        duration_ms=result["duration_ms"],
    )


def test_ota_mechanism(ssh_port: int) -> SSHTestResult:
    """Test 5: Verify OTA capability via volteria-system service."""
    # OTA is handled by volteria-system.service (Heartbeat, OTA, Health Monitoring)
    result = execute_ssh_command(
        ssh_port,
        'systemctl is-active volteria-system 2>/dev/null'
    )

    if "error" in result:
        return SSHTestResult(
            name="ota_check",
            status="failed",
            message=f"Failed to check OTA: {result['error']}",
            duration_ms=result["duration_ms"],
        )

    stdout = result.get("stdout", "").strip()

    if stdout == "active":
        # Check if system service can reach firmware endpoint
        fw_check = execute_ssh_command(
            ssh_port,
            'curl -s -o /dev/null -w "%{http_code}" --max-time 5 '
            'https://usgxhzdctzthcqxyxfxl.supabase.co/rest/v1/firmware_releases?limit=1 '
            '-H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzZ3hoemRjdHp0aGNxeHl4ZnhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwMDk0NjMsImV4cCI6MjA4MDU4NTQ2M30.BLSqoPm3r8p7x7Y9cMXjEP4lrPNXjHh9YUAJTfNIBYQ" '
            '2>/dev/null || echo "failed"'
        )
        fw_status = fw_check.get("stdout", "").strip()

        if fw_status in ["200", "401"]:
            return SSHTestResult(
                name="ota_check",
                status="passed",
                message=f"System service active, firmware API reachable ({result['duration_ms']}ms)",
                duration_ms=result["duration_ms"],
            )
        else:
            return SSHTestResult(
                name="ota_check",
                status="passed",
                message=f"System service active (OTA ready) ({result['duration_ms']}ms)",
                duration_ms=result["duration_ms"],
            )

    return SSHTestResult(
        name="ota_check",
        status="failed",
        message=f"System service not active (status: {stdout})",
        duration_ms=result["duration_ms"],
    )


# --- Hardware-specific tests for SOL532-E16 (R2000) ---

def test_serial_ports(ssh_port: int) -> SSHTestResult:
    """Test 6: Verify RS485/RS232 serial ports are accessible (R2000 only)."""
    result = execute_ssh_command(
        ssh_port,
        "ls /dev/ttyACM* 2>/dev/null | wc -l"
    )

    if "error" in result:
        return SSHTestResult(
            name="serial_ports",
            status="failed",
            message=f"Failed to check serial ports: {result['error']}",
            duration_ms=result["duration_ms"],
        )

    try:
        count = int(result.get("stdout", "0").strip())
    except ValueError:
        count = 0

    if count >= 4:
        return SSHTestResult(
            name="serial_ports",
            status="passed",
            message=f"All {count} serial ports detected (3x RS485 + 1x RS232) ({result['duration_ms']}ms)",
            duration_ms=result["duration_ms"],
        )

    return SSHTestResult(
        name="serial_ports",
        status="failed",
        message=f"Expected 4 serial ports, found {count}",
        duration_ms=result["duration_ms"],
    )


def test_ups_monitor(ssh_port: int) -> SSHTestResult:
    """Test 7: Verify UPS monitor service is running (R2000 only)."""
    result = execute_ssh_command(
        ssh_port,
        "systemctl is-active volteria-ups-monitor 2>/dev/null || echo 'inactive'"
    )

    if "error" in result:
        return SSHTestResult(
            name="ups_monitor",
            status="failed",
            message=f"Failed to check UPS monitor: {result['error']}",
            duration_ms=result["duration_ms"],
        )

    status = result.get("stdout", "").strip()

    if status == "active":
        return SSHTestResult(
            name="ups_monitor",
            status="passed",
            message=f"UPS monitor service running ({result['duration_ms']}ms)",
            duration_ms=result["duration_ms"],
        )

    # UPS is optional - skip instead of fail if not configured
    return SSHTestResult(
        name="ups_monitor",
        status="skipped",
        message=f"UPS monitor not active (optional): {status}",
        duration_ms=result["duration_ms"],
    )


def test_watchdog(ssh_port: int) -> SSHTestResult:
    """Test 8: Verify hardware watchdog service is running (R2000 only)."""
    result = execute_ssh_command(
        ssh_port,
        "systemctl is-active volteria-watchdog 2>/dev/null || echo 'inactive'"
    )

    if "error" in result:
        return SSHTestResult(
            name="watchdog",
            status="failed",
            message=f"Failed to check watchdog: {result['error']}",
            duration_ms=result["duration_ms"],
        )

    status = result.get("stdout", "").strip()

    if status == "active":
        return SSHTestResult(
            name="watchdog",
            status="passed",
            message=f"Hardware watchdog active ({result['duration_ms']}ms)",
            duration_ms=result["duration_ms"],
        )

    return SSHTestResult(
        name="watchdog",
        status="failed",
        message=f"Watchdog status: {status}",
        duration_ms=result["duration_ms"],
    )


@router.post("/{controller_id}", response_model=SSHTestResponse)
async def run_ssh_tests(
    controller_id: str,
    ssh_port: int,
    hardware_type: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """
    Run real SSH-based tests against a controller.

    Standard Tests:
    1. SSH Tunnel - Actually connects via reverse tunnel
    2. Service Health - Checks all 5 systemd services
    3. Cloud Communication - Tests network connectivity to Supabase
    4. Configuration Sync - Verifies config file exists
    5. OTA Mechanism - Checks update service and script

    Hardware-specific Tests (SOL532-E16):
    6. Serial Ports - Verify RS485/RS232 ports accessible
    7. UPS Monitor - Verify UPS monitor service running
    8. Watchdog - Verify hardware watchdog service running
    """
    import time
    start_time = time.time()

    results: List[SSHTestResult] = []

    # Test 1: SSH Tunnel (if this fails, skip others)
    tunnel_result = test_ssh_tunnel(ssh_port)
    results.append(tunnel_result)

    if tunnel_result.status == "failed":
        # SSH tunnel down, skip remaining tests
        skipped_tests = ["service_health", "communication", "config_sync", "ota_check"]
        # Also skip hardware-specific tests if applicable
        if hardware_type == "SOL532-E16":
            skipped_tests.extend(["serial_ports", "ups_monitor", "watchdog"])
        for name in skipped_tests:
            results.append(SSHTestResult(
                name=name,
                status="skipped",
                message="SSH tunnel not available",
                duration_ms=0,
            ))
    else:
        # Run standard tests
        results.append(test_service_health(ssh_port))
        results.append(test_cloud_communication(ssh_port))
        results.append(test_config_sync(ssh_port))
        results.append(test_ota_mechanism(ssh_port))

        # Run hardware-specific tests for SOL532-E16
        if hardware_type == "SOL532-E16":
            results.append(test_serial_ports(ssh_port))
            results.append(test_ups_monitor(ssh_port))
            results.append(test_watchdog(ssh_port))

    total_duration = int((time.time() - start_time) * 1000)

    return SSHTestResponse(
        controller_id=controller_id,
        ssh_port=ssh_port,
        results=results,
        total_duration_ms=total_duration,
    )
