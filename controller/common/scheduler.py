"""
Unified Scheduler for Precise Interval Execution

Provides ScheduledLoop class that fires callbacks at exact intervals,
accounting for callback execution time to prevent drift.

Unlike asyncio.sleep()-based loops, this scheduler:
- Fires at exact wall-clock boundaries
- Tracks cumulative drift
- Skips missed intervals to catch up
- Reports drift metrics for observability

Usage:
    async def my_callback():
        # Do work...
        pass

    scheduler = ScheduledLoop(60.0, my_callback)  # Every 60 seconds
    await scheduler.start()

    # Later:
    scheduler.stop()
    print(f"Total drift: {scheduler.drift_seconds:.3f}s")
"""

import asyncio
import time
from typing import Callable, Awaitable
from common.logging_setup import get_service_logger

logger = get_service_logger("scheduler")


class ScheduledLoop:
    """
    Precise interval scheduler that accounts for execution time.

    Unlike simple `while True: await asyncio.sleep(interval)` loops,
    this scheduler fires at exact wall-clock boundaries. If callback
    execution takes time, the next iteration is scheduled relative to
    the original schedule, not relative to when the callback finished.

    Attributes:
        interval: The interval in seconds between executions
        callback: Async function to call each interval
        drift_seconds: Total accumulated drift (for observability)
        skipped_count: Number of intervals skipped (to catch up)
    """

    def __init__(
        self,
        interval_seconds: float,
        callback: Callable[[], Awaitable[None]],
        name: str = "unnamed",
    ):
        """
        Initialize a scheduled loop.

        Args:
            interval_seconds: Time between executions (supports sub-second)
            callback: Async function to call each interval
            name: Name for logging/identification
        """
        self.interval = interval_seconds
        self.callback = callback
        self.name = name

        self._next_run: float = 0
        self._running = False
        self._task: asyncio.Task | None = None

        # Observability metrics
        self._drift_total: float = 0
        self._skipped_count: int = 0
        self._execution_count: int = 0
        self._last_execution_time: float = 0
        self._last_drift_ms: float = 0

    async def start(self) -> None:
        """Start the scheduled loop in a background task."""
        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._run())

    def stop(self) -> None:
        """Stop the scheduled loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None

    async def _run(self) -> None:
        """Main loop that fires callback at exact intervals."""
        # Align first run to next interval boundary
        now = time.time()
        self._next_run = ((now // self.interval) + 1) * self.interval

        while self._running:
            now = time.time()

            # Wait until next scheduled time
            sleep_duration = self._next_run - now
            if sleep_duration > 0:
                try:
                    await asyncio.sleep(sleep_duration)
                except asyncio.CancelledError:
                    break

            if not self._running:
                break

            # Track drift (how late we are)
            actual_time = time.time()
            drift = actual_time - self._next_run

            if drift > 30:
                # Clock jump detected (NTP sync after boot, suspend/resume, etc.)
                # Don't accumulate as real drift — this is a system clock correction
                logger.info(
                    f"Scheduler '{self.name}' clock jump detected ({drift:.0f}s), realigning"
                )
                self._last_drift_ms = 0
            else:
                self._drift_total += max(0, drift)
                self._last_drift_ms = drift * 1000

            # Execute callback
            try:
                start = time.time()
                await self.callback()
                self._last_execution_time = time.time() - start
                self._execution_count += 1
            except Exception as e:
                logger.error(f"Scheduled callback '{self.name}' error: {e}")

            # Schedule next run
            # Skip missed intervals to catch up (don't queue up missed executions)
            now = time.time()
            skipped = 0
            while self._next_run <= now:
                self._next_run += self.interval
                skipped += 1

            # First skip is expected (the one we just executed)
            if skipped > 1:
                self._skipped_count += skipped - 1
                logger.warning(
                    f"Scheduler '{self.name}' skipped {skipped - 1} intervals "
                    f"(execution took {self._last_execution_time:.3f}s)"
                )

    @property
    def drift_seconds(self) -> float:
        """Total accumulated drift in seconds."""
        return self._drift_total

    @property
    def drift_ms(self) -> float:
        """Most recent drift in milliseconds."""
        return self._last_drift_ms

    @property
    def skipped_count(self) -> int:
        """Number of intervals skipped to catch up."""
        return self._skipped_count

    @property
    def execution_count(self) -> int:
        """Total number of successful executions."""
        return self._execution_count

    @property
    def last_execution_time(self) -> float:
        """Duration of last callback execution in seconds."""
        return self._last_execution_time

    def get_stats(self) -> dict:
        """Get scheduler statistics for observability."""
        return {
            "name": self.name,
            "interval_s": self.interval,
            "execution_count": self._execution_count,
            "drift_total_s": round(self._drift_total, 3),
            "drift_last_ms": round(self._last_drift_ms, 1),
            "skipped_count": self._skipped_count,
            "last_execution_s": round(self._last_execution_time, 3),
        }


class SchedulerGroup:
    """
    Manage multiple scheduled loops together.

    Provides a single interface to start/stop multiple schedulers
    and aggregate their statistics.
    """

    def __init__(self):
        self._schedulers: dict[str, ScheduledLoop] = {}

    def add(
        self,
        name: str,
        interval_seconds: float,
        callback: Callable[[], Awaitable[None]],
    ) -> ScheduledLoop:
        """Add a scheduler to the group."""
        scheduler = ScheduledLoop(interval_seconds, callback, name)
        self._schedulers[name] = scheduler
        return scheduler

    async def start_all(self) -> None:
        """Start all schedulers."""
        for scheduler in self._schedulers.values():
            await scheduler.start()

    def stop_all(self) -> None:
        """Stop all schedulers."""
        for scheduler in self._schedulers.values():
            scheduler.stop()

    def get_stats(self) -> dict:
        """Get aggregated statistics for all schedulers."""
        return {
            name: scheduler.get_stats()
            for name, scheduler in self._schedulers.items()
        }

    def get(self, name: str) -> ScheduledLoop | None:
        """Get a specific scheduler by name."""
        return self._schedulers.get(name)
