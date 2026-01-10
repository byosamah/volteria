"""
Reboot Handler

Handles safe reboot commands from cloud with proper shutdown sequence.
Requires double confirmation from frontend before command is sent.
"""

import asyncio
import subprocess
from datetime import datetime, timezone
from typing import Callable, Awaitable

import httpx

from common.state import SharedState
from common.logging_setup import get_service_logger

logger = get_service_logger("system.reboot")


class RebootHandler:
    """
    Handles remote reboot commands.

    Flow:
    1. Frontend sends reboot command to control_commands table
    2. System service polls for pending commands
    3. On reboot command: graceful shutdown sequence
    4. Send final heartbeat with "rebooting" status
    5. Execute system reboot
    """

    POLL_INTERVAL_SECONDS = 10

    def __init__(
        self,
        controller_id: str,
        supabase_url: str,
        supabase_key: str,
        heartbeat_callback: Callable[[], Awaitable[None]] | None = None,
    ):
        self.controller_id = controller_id
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        self.heartbeat_callback = heartbeat_callback

        self._running = False
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        """Start command polling"""
        self._running = True
        self._task = asyncio.create_task(self._poll_loop())
        logger.info("Reboot handler started")

    async def stop(self) -> None:
        """Stop command polling"""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Reboot handler stopped")

    async def _poll_loop(self) -> None:
        """Poll for pending commands"""
        while self._running:
            try:
                await self._check_commands()
            except Exception as e:
                logger.error(f"Error checking commands: {e}")

            await asyncio.sleep(self.POLL_INTERVAL_SECONDS)

    async def _check_commands(self) -> None:
        """Check for pending reboot commands"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.supabase_url}/rest/v1/control_commands",
                    params={
                        "controller_id": f"eq.{self.controller_id}",
                        "command_type": "eq.reboot",
                        "status": "eq.pending",
                        "order": "created_at.asc",
                        "limit": "1",
                    },
                    headers={
                        "apikey": self.supabase_key,
                        "Authorization": f"Bearer {self.supabase_key}",
                    },
                    timeout=10.0,
                )
                response.raise_for_status()
                commands = response.json()

                if commands:
                    await self._execute_reboot(commands[0])

        except httpx.HTTPError as e:
            logger.error(f"HTTP error checking commands: {e}")

    async def _execute_reboot(self, command: dict) -> None:
        """Execute a reboot command"""
        command_id = command["id"]
        graceful = command.get("parameters", {}).get("graceful", True)

        logger.info(
            f"Executing reboot command {command_id}",
            extra={"command_id": command_id, "graceful": graceful},
        )

        try:
            # 1. Update command status to "executing"
            await self._update_command_status(command_id, "executing")

            # 2. Stop services gracefully if requested
            if graceful:
                await self._stop_services_gracefully()

            # 3. Send final heartbeat
            if self.heartbeat_callback:
                await self.heartbeat_callback()

            # 4. Update status to sent (before actual reboot)
            await self._update_command_status(command_id, "sent")

            # 5. Write reboot pending flag for after-reboot verification
            SharedState.write("reboot_pending", {
                "command_id": command_id,
                "initiated_at": datetime.now(timezone.utc).isoformat(),
            })

            # 6. Execute system reboot
            logger.info("Initiating system reboot")
            subprocess.run(
                ["sudo", "reboot"],
                check=True,
                timeout=10,
            )

        except subprocess.CalledProcessError as e:
            logger.error(f"Reboot command failed: {e}")
            await self._update_command_status(
                command_id, "failed", f"Reboot failed: {e}"
            )
        except subprocess.TimeoutExpired:
            logger.error("Reboot command timed out")
            await self._update_command_status(
                command_id, "failed", "Reboot command timed out"
            )
        except FileNotFoundError:
            # For Windows development - simulate reboot
            logger.warning("Reboot not available (development mode)")
            await self._update_command_status(
                command_id, "completed", "Simulated (dev mode)"
            )

    async def _stop_services_gracefully(self) -> None:
        """Stop all services in reverse order before reboot"""
        services = [
            "volteria-logging",
            "volteria-control",
            "volteria-device",
            "volteria-config",
        ]

        for svc in services:
            try:
                result = subprocess.run(
                    ["sudo", "systemctl", "stop", svc],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                if result.returncode == 0:
                    logger.info(f"Stopped {svc}")
                else:
                    logger.warning(f"Error stopping {svc}: {result.stderr}")
            except subprocess.TimeoutExpired:
                logger.warning(f"Timeout stopping {svc}")
            except FileNotFoundError:
                logger.debug(f"systemctl not available, skipping {svc}")

        # Give services time to stop
        await asyncio.sleep(2)

    async def _update_command_status(
        self,
        command_id: str,
        status: str,
        error: str | None = None,
    ) -> None:
        """Update command status in database"""
        try:
            update_data = {
                "status": status,
            }

            if status == "executing":
                update_data["executed_at"] = datetime.now(timezone.utc).isoformat()
            elif status in ["completed", "failed"]:
                update_data["completed_at"] = datetime.now(timezone.utc).isoformat()
            elif status == "sent":
                update_data["sent_at"] = datetime.now(timezone.utc).isoformat()

            if error:
                update_data["error_message"] = error

            async with httpx.AsyncClient() as client:
                response = await client.patch(
                    f"{self.supabase_url}/rest/v1/control_commands",
                    params={"id": f"eq.{command_id}"},
                    json=update_data,
                    headers={
                        "apikey": self.supabase_key,
                        "Authorization": f"Bearer {self.supabase_key}",
                        "Content-Type": "application/json",
                        "Prefer": "return=minimal",
                    },
                    timeout=10.0,
                )
                response.raise_for_status()

        except Exception as e:
            logger.error(f"Failed to update command status: {e}")

    async def check_post_reboot(self) -> None:
        """
        Check if we just rebooted and update command status.

        Called on system service startup.
        """
        reboot_pending = SharedState.read("reboot_pending")

        if reboot_pending:
            command_id = reboot_pending.get("command_id")
            if command_id:
                logger.info(f"Post-reboot: completing command {command_id}")
                await self._update_command_status(command_id, "completed")

            # Clear the pending flag
            SharedState.delete("reboot_pending")

    async def execute_immediate_reboot(self, graceful: bool = True) -> None:
        """
        Execute immediate reboot (for local/emergency use).

        This bypasses the cloud command queue.
        """
        logger.warning("Executing immediate reboot")

        if graceful:
            await self._stop_services_gracefully()

        if self.heartbeat_callback:
            await self.heartbeat_callback()

        try:
            subprocess.run(["sudo", "reboot"], check=True, timeout=10)
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            logger.error(f"Immediate reboot failed: {e}")
