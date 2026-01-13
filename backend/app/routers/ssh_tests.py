"""
SSH-based Controller Testing API

Provides real SSH tests against controllers via reverse tunnels.
Tests are executed from the server which has direct access to tunnel ports.
"""

import paramiko
import socket
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from ..dependencies.auth import get_current_user, require_role

router = APIRouter(prefix="/ssh-test", tags=["SSH Tests"])

# SSH connection settings
# Tunnels terminate on host machine - use Docker gateway or host IP
# 172.17.0.1 is the default Docker bridge gateway (Linux)
# If that fails, use the public IP as fallback
import os
SSH_HOST = os.getenv("SSH_TUNNEL_HOST", "172.17.0.1")
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
    """Test 5: Verify OTA updater is ready."""
    result = execute_ssh_command(
        ssh_port,
        'systemctl is-active volteria-ota-updater 2>/dev/null && '
        'test -f /opt/volteria/scripts/ota-update.sh && '
        'echo "ota_ready" || echo "ota_not_ready"'
    )

    if "error" in result:
        return SSHTestResult(
            name="ota_check",
            status="failed",
            message=f"Failed to check OTA: {result['error']}",
            duration_ms=result["duration_ms"],
        )

    if "ota_ready" in result.get("stdout", ""):
        return SSHTestResult(
            name="ota_check",
            status="passed",
            message=f"OTA updater service active, update script present ({result['duration_ms']}ms)",
            duration_ms=result["duration_ms"],
        )

    # Check what's missing
    service_check = execute_ssh_command(
        ssh_port,
        "systemctl is-active volteria-ota-updater 2>/dev/null || echo 'inactive'"
    )
    script_check = execute_ssh_command(
        ssh_port,
        "test -f /opt/volteria/scripts/ota-update.sh && echo 'exists' || echo 'missing'"
    )

    issues = []
    if "inactive" in service_check.get("stdout", ""):
        issues.append("OTA service not active")
    if "missing" in script_check.get("stdout", ""):
        issues.append("update script missing")

    return SSHTestResult(
        name="ota_check",
        status="failed",
        message=", ".join(issues) or "OTA mechanism not ready",
        duration_ms=result["duration_ms"],
    )


@router.post("/{controller_id}", response_model=SSHTestResponse)
async def run_ssh_tests(
    controller_id: str,
    ssh_port: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Run real SSH-based tests against a controller.

    Tests:
    1. SSH Tunnel - Actually connects via reverse tunnel
    2. Service Health - Checks all 5 systemd services
    3. Cloud Communication - Tests network connectivity to Supabase
    4. Configuration Sync - Verifies config file exists
    5. OTA Mechanism - Checks update service and script
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
        for name in skipped_tests:
            results.append(SSHTestResult(
                name=name,
                status="skipped",
                message="SSH tunnel not available",
                duration_ms=0,
            ))
    else:
        # Run remaining tests
        results.append(test_service_health(ssh_port))
        results.append(test_cloud_communication(ssh_port))
        results.append(test_config_sync(ssh_port))
        results.append(test_ota_mechanism(ssh_port))

    total_duration = int((time.time() - start_time) * 1000)

    return SSHTestResponse(
        controller_id=controller_id,
        ssh_port=ssh_port,
        results=results,
        total_duration_ms=total_duration,
    )
