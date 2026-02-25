"""
Control Service (Layer 4) - Control Algorithm

Responsible for:
- Executing control loop at configured interval
- Calculating solar limit based on operation mode
- Handling safe mode triggering
- Writing limits to inverters via device service
"""

import asyncio
import math
import os
import signal
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml
from aiohttp import web

from common.state import SharedState, set_service_health, get_config, get_readings, set_control_state
from common.config import SafeModeSettings, SafeModeType, DeviceType
from common.logging_setup import get_service_logger, log_control_loop

from .algorithm import get_mode, validate_config_for_mode
from .safe_mode import SafeModeHandler
from .calculated_fields import CalculatedFieldsProcessor, SOLAR_TYPES, LOAD_TYPES, GENERATOR_TYPES
from .state import ControlState

# Ramp rate limits (% of capacity per second)
# Up = slow (protect generators from sudden unloading)
# Down = instant (protect generators from reverse feed)
MAX_RAMP_UP_PCT_PER_SEC = 10.0
MAX_RAMP_DOWN_PCT_PER_SEC = 100.0  # Effectively instant

# Cached load staleness limit
CACHED_LOAD_MAX_AGE_S = 60

logger = get_service_logger("control")

# Health server port
HEALTH_PORT = 8084
# Device service URL
DEVICE_SERVICE_URL = "http://127.0.0.1:8083"


class ControlService:
    """
    Control Service - Layer 4

    Executes the control loop:
    1. Get latest readings from device service
    2. Calculate control parameters using operation mode
    3. Check safe mode conditions
    4. Execute control actions via device service
    5. Emit state for logging
    """

    def __init__(self, config_path: str | None = None):
        self.config_path = config_path or self._find_config_path()

        # Initialize components
        self.safe_mode_handler = SafeModeHandler()
        self.calculated_fields = CalculatedFieldsProcessor()

        # Current state
        self._current_state = ControlState()
        self._start_time = datetime.now(timezone.utc)
        self._last_state_update = datetime.now(timezone.utc)

        # Configuration
        self._control_interval_ms = 1000
        self._operation_mode = "zero_generator_feed"
        self._solar_capacity_kw = 100.0
        self._inverter_ids: list[str] = []
        self._device_types: dict[str, str] = {}

        # Site calculations config
        self._site_calculations: list[dict] = []
        self._controller_device_id: str | None = None
        self._device_configs: list[dict] = []

        # Ramp rate state
        self._previous_limit_pct: float = 100.0
        self._last_control_time: float = time.monotonic()

        # Health server
        self._health_app: web.Application | None = None
        self._health_runner: web.AppRunner | None = None

        # State
        self._running = False
        self._control_task: asyncio.Task | None = None
        self._config_watch_task: asyncio.Task | None = None
        self._shutdown_event = asyncio.Event()

    def _find_config_path(self) -> str:
        """Find configuration file"""
        possible_paths = [
            "/etc/volteria/config.yaml",
            "/opt/volteria/config.yaml",
            Path(__file__).parent.parent.parent / "config.yaml",
        ]

        for path in possible_paths:
            path = Path(path)
            if path.exists():
                return str(path)

        return str(possible_paths[0])

    async def start(self) -> None:
        """Start the control service"""
        logger.info("Starting Control Service")

        self._running = True

        # Update service health
        set_service_health("control", {
            "status": "starting",
            "is_healthy": False,
        })

        # Load configuration
        await self._load_config()

        # Start health server
        await self._start_health_server()

        # Start control loop
        self._control_task = asyncio.create_task(self._control_loop())

        # Start config watch task (hot-reload on config changes)
        self._config_watch_task = asyncio.create_task(self._config_watch_loop())

        # Update service health to running
        set_service_health("control", {
            "status": "running",
            "is_healthy": True,
            "started_at": self._start_time.isoformat(),
        })

        logger.info(
            f"Control Service started (mode: {self._operation_mode}, "
            f"interval: {self._control_interval_ms}ms)",
            extra={
                "operation_mode": self._operation_mode,
                "interval_ms": self._control_interval_ms,
            },
        )

        # Setup signal handlers
        self._setup_signal_handlers()

        # Wait for shutdown
        await self._shutdown_event.wait()

    async def stop(self) -> None:
        """Stop the control service"""
        logger.info("Stopping Control Service")

        self._running = False

        # Cancel control task
        if self._control_task:
            self._control_task.cancel()
            try:
                await self._control_task
            except asyncio.CancelledError:
                pass

        # Cancel config watch task
        if self._config_watch_task:
            self._config_watch_task.cancel()
            try:
                await self._config_watch_task
            except asyncio.CancelledError:
                pass

        # Stop health server
        await self._stop_health_server()

        # Update service health
        set_service_health("control", {
            "status": "stopped",
            "is_healthy": False,
        })

        logger.info("Control Service stopped")

    def _setup_signal_handlers(self) -> None:
        """Setup graceful shutdown signal handlers"""
        loop = asyncio.get_event_loop()

        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, self._handle_shutdown)
            except NotImplementedError:
                signal.signal(sig, lambda s, f: self._handle_shutdown())

    def _handle_shutdown(self) -> None:
        """Handle shutdown signal"""
        logger.info("Received shutdown signal")
        self._shutdown_event.set()

    async def _load_config(self) -> None:
        """Load configuration from shared state"""
        # Wait for config to be available
        for _ in range(30):
            config = get_config()
            if config and config.get("id"):
                break
            await asyncio.sleep(1)
            logger.debug("Waiting for configuration...")

        config = get_config()
        if not config:
            logger.warning("No configuration available, using defaults")
            return

        # Extract settings
        self._control_interval_ms = config.get("control_interval_ms", 1000)
        self._operation_mode = config.get("operation_mode", "zero_generator_feed")

        # Safe mode settings
        safe_mode_config = config.get("safe_mode", {})
        safe_mode_settings = SafeModeSettings(
            enabled=safe_mode_config.get("enabled", True),
            type=SafeModeType(safe_mode_config.get("type", "time_based")),
            timeout_s=safe_mode_config.get("timeout_s", 30),
            rolling_window_min=safe_mode_config.get("rolling_window_min", 3),
            threshold_pct=safe_mode_config.get("threshold_pct", 80.0),
            power_limit_kw=safe_mode_config.get("power_limit_kw", 0.0),
        )
        self.safe_mode_handler.update_settings(safe_mode_settings)

        # Extract device info
        devices = config.get("devices", [])
        self._solar_capacity_kw = 0.0
        self._inverter_ids = []
        self._device_types = {}

        for device in devices:
            device_id = device.get("id")
            device_type = device.get("device_type")

            if device_id:
                self._device_types[device_id] = device_type

            if device_type == "inverter":
                self._inverter_ids.append(device_id)
                rated_power = device.get("rated_power_kw", 0)
                if rated_power:
                    self._solar_capacity_kw += rated_power

        # Site calculations config
        self._site_calculations = config.get("site_calculations", [])
        self._controller_device_id = config.get("controller_device_id")
        self._device_configs = devices

        # Validate config for operation mode
        errors = validate_config_for_mode(self._operation_mode, config)
        if errors:
            logger.warning(f"Config validation errors: {errors}")

        logger.info(
            f"Config loaded: {len(devices)} devices, "
            f"{self._solar_capacity_kw:.0f}kW solar capacity, "
            f"{len(self._site_calculations)} site calculations"
        )

    async def _control_loop(self) -> None:
        """Main control loop"""
        interval_seconds = self._control_interval_ms / 1000

        while self._running:
            loop_start = time.time()

            try:
                # Execute control logic
                await self._execute_control()

            except Exception as e:
                logger.error(f"Control loop error: {e}")
                self._current_state.write_success = False
                self._current_state.write_error = str(e)

            # Calculate execution time
            execution_time_ms = (time.time() - loop_start) * 1000
            self._current_state.execution_time_ms = execution_time_ms

            # Update shared state
            set_control_state(self._current_state.to_dict())

            # Log control loop
            log_control_loop(
                logger,
                solar_limit_pct=self._current_state.solar_limit_pct,
                total_load_kw=self._current_state.total_load_kw,
                solar_output_kw=self._current_state.solar_output_kw,
                execution_time_ms=execution_time_ms,
            )

            # Wait for next interval
            elapsed = time.time() - loop_start
            sleep_time = max(0, interval_seconds - elapsed)
            await asyncio.sleep(sleep_time)

    async def _execute_control(self) -> None:
        """
        Execute single control loop iteration.

        7-layer architecture:
        L1: Data acquisition (SharedState)
        L2: Load estimation (fallback chain: meters → generators → cached → safe mode)
        L3: Setpoint calculation (headroom = load - reserve)
        L4: Ramp rate limiter (10%/s up, instant down)
        L5: Sanity checks (NaN, range, impossible values)
        L6: Emergency ramp-down (bypass ramp on critical anomaly)
        L7: Safe mode (full solar shutdown)
        """
        config = get_config()
        if not config:
            return

        now = time.monotonic()
        dt_s = now - self._last_control_time
        self._last_control_time = now

        # ── L1: DATA ACQUISITION ──────────────────────────────────────
        readings_data = get_readings()
        raw_devices = readings_data.get("devices", {})
        device_status = readings_data.get("status", {})

        # Unwrap 'readings' subkey → flat {device_id: {register_name: {value, ...}}}
        device_readings = {}
        for dev_id, dev_data in raw_devices.items():
            if isinstance(dev_data, dict) and "readings" in dev_data:
                device_readings[dev_id] = dev_data["readings"]
            else:
                device_readings[dev_id] = dev_data

        # Compute totals using fixed type sets
        totals = self.calculated_fields.compute_standard_totals(
            readings=device_readings,
            device_types=self._device_types,
        )

        # Update state with readings
        self._current_state.timestamp = datetime.now(timezone.utc)
        total_load_kw = totals.get("total_load_kw", 0.0)
        total_solar_kw = totals.get("total_solar_kw", 0.0)
        total_dg_kw = totals.get("total_dg_kw", 0.0)
        total_gg_kw = totals.get("total_gg_kw", 0.0)
        total_generator_kw = totals.get("total_generator_kw", 0.0)

        self._current_state.solar_output_kw = total_solar_kw
        self._current_state.dg_power_kw = total_dg_kw
        self._current_state.gg_power_kw = total_gg_kw
        self._current_state.generator_power_kw = total_generator_kw
        self._current_state.solar_capacity_kw = self._solar_capacity_kw
        self._current_state.operation_mode = self._operation_mode
        self._current_state.config_mode = config.get("config_mode", "full_system")

        # Get generator reserve from config (top-level is always correct)
        mode_settings = config.get("mode_settings", {})
        generator_reserve = config.get(
            "dg_reserve_kw", mode_settings.get("dg_reserve_kw", 0)
        )
        self._current_state.dg_reserve_kw = generator_reserve

        # Count online devices (match all equivalent device type strings)
        self._current_state.inverters_online = sum(
            1 for d_id, s in device_status.items()
            if self._device_types.get(d_id) in SOLAR_TYPES and s.get("is_online")
        )
        self._current_state.load_meters_online = sum(
            1 for d_id, s in device_status.items()
            if self._device_types.get(d_id) in LOAD_TYPES and s.get("is_online")
        )
        self._current_state.generators_online = sum(
            1 for d_id, s in device_status.items()
            if self._device_types.get(d_id) in GENERATOR_TYPES and s.get("is_online")
        )

        # ── L2: LOAD ESTIMATION (fallback chain) ─────────────────────
        estimated_load = 0.0
        load_source = "none"

        if self._current_state.load_meters_online > 0 and total_load_kw > 0:
            # Priority 1: Load meters (direct measurement, most accurate)
            estimated_load = total_load_kw
            load_source = "load_meter"
        elif self._current_state.generators_online > 0 and total_generator_kw > 0:
            # Priority 2: Generator power (off-grid: gen output ≈ load)
            estimated_load = total_generator_kw
            load_source = "generator_fallback"
        elif (
            self._current_state.last_known_load_kw > 0
            and self._current_state.last_known_load_timestamp
            and (datetime.now(timezone.utc) - self._current_state.last_known_load_timestamp).total_seconds() < CACHED_LOAD_MAX_AGE_S
        ):
            # Priority 3: Cached value (< 60s stale)
            estimated_load = self._current_state.last_known_load_kw
            load_source = "cached"
        else:
            # Priority 4: No reliable data → safe mode
            load_source = "safe_mode"

        # Update cached value when we have a good reading
        if load_source in ("load_meter", "generator_fallback"):
            self._current_state.last_known_load_kw = estimated_load
            self._current_state.last_known_load_timestamp = datetime.now(timezone.utc)

        self._current_state.total_load_kw = estimated_load
        self._current_state.load_source = load_source

        # ── L7: SAFE MODE CHECK ───────────────────────────────────────
        device_online_status = {
            d_id: s.get("is_online", False)
            for d_id, s in device_status.items()
        }

        safe_mode_active = self.safe_mode_handler.check_and_trigger(
            state=self._current_state,
            device_status=device_online_status,
        )

        # Trigger safe mode if load fallback chain exhausted
        if load_source == "safe_mode" and not safe_mode_active:
            self.safe_mode_handler._trigger(
                "No reliable load data (all sources exhausted)"
            )
            safe_mode_active = True

        self._current_state.safe_mode_active = safe_mode_active
        if safe_mode_active:
            self._current_state.safe_mode_reason = (
                self.safe_mode_handler.get_state().trigger_reason
            )
        else:
            self._current_state.safe_mode_reason = None

        # ── L3 + L6: SETPOINT CALCULATION ─────────────────────────────
        if safe_mode_active:
            # L7: Safe mode — use configured safe limit
            solar_limit_pct = self.safe_mode_handler.get_safe_limit_pct(
                self._solar_capacity_kw
            )
            solar_limit_kw = self.safe_mode_handler.get_safe_limit()
            self._current_state.ramp_limited = False
        else:
            # Use operation mode algorithm
            mode = get_mode(self._operation_mode)

            algo_readings = {
                "total_load_kw": estimated_load,
                "total_solar_kw": total_solar_kw,
                "total_generator_kw": total_generator_kw,
                "solar_capacity_kw": self._solar_capacity_kw,
                "load_meters_online": self._current_state.load_meters_online,
                "generators_online": self._current_state.generators_online,
            }

            output = mode.calculate(algo_readings, config)
            target_pct = output.solar_limit_pct
            solar_limit_kw = output.solar_limit_kw

            # Update load_source from algorithm if it provided one
            if output.load_source != "none":
                self._current_state.load_source = output.load_source

            # ── L5: SANITY CHECKS ─────────────────────────────────────
            if math.isnan(target_pct) or math.isinf(target_pct):
                logger.warning("NaN/Inf detected in solar limit, forcing 0%")
                target_pct = 0.0
                solar_limit_kw = 0.0

            target_pct = max(0.0, min(100.0, target_pct))

            # L6: Emergency — negative load in off-grid is impossible
            if estimated_load < 0 and config.get("grid_connection") == "off_grid":
                logger.warning(f"Impossible negative load ({estimated_load:.1f}kW) in off-grid, emergency curtailment")
                target_pct = 0.0
                solar_limit_kw = 0.0

            # ── L4: RAMP RATE LIMITER ─────────────────────────────────
            delta = target_pct - self._previous_limit_pct

            if delta > 0:
                # Ramping UP solar (conservative — protect generators)
                max_up = MAX_RAMP_UP_PCT_PER_SEC * dt_s
                if delta > max_up:
                    solar_limit_pct = self._previous_limit_pct + max_up
                    self._current_state.ramp_limited = True
                else:
                    solar_limit_pct = target_pct
                    self._current_state.ramp_limited = False
            else:
                # Ramping DOWN solar (instant — protect from reverse feed)
                solar_limit_pct = target_pct
                self._current_state.ramp_limited = False

            solar_limit_pct = round(solar_limit_pct, 1)

            # Recalculate kW from final percentage
            if self._solar_capacity_kw > 0:
                solar_limit_kw = round(solar_limit_pct / 100 * self._solar_capacity_kw, 2)
            else:
                solar_limit_kw = 0.0

        # Track for next cycle's ramp calculation
        self._previous_limit_pct = solar_limit_pct

        # Update state
        self._current_state.solar_limit_pct = solar_limit_pct
        self._current_state.solar_limit_kw = solar_limit_kw
        self._current_state.available_headroom_kw = round(
            estimated_load - generator_reserve, 2
        )

        # ── WRITE TO INVERTERS ────────────────────────────────────────
        if self._inverter_ids:
            write_success = await self._write_solar_limit(solar_limit_pct)
            self._current_state.write_success = write_success
            if not write_success:
                self._current_state.write_error = "Failed to write solar limit"
        else:
            self._current_state.write_success = True

    async def _write_solar_limit(self, limit_pct: float) -> bool:
        """
        Write solar limit to all inverters via device service.

        Commands are written to SharedState 'write_commands' and
        picked up by the device service's command queue loop.
        """
        all_success = True

        for inverter_id in self._inverter_ids:
            try:
                # Write command to shared state for device service to pick up
                commands = SharedState.read("write_commands")
                if "commands" not in commands:
                    commands["commands"] = []

                commands["commands"].append({
                    "device_id": inverter_id,
                    "command": "write_solar_limit",
                    "value": limit_pct,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

                SharedState.write("write_commands", commands)

                logger.debug(
                    f"Queued solar limit command: {limit_pct}% for {inverter_id}"
                )

            except Exception as e:
                logger.error(f"Failed to queue solar limit for {inverter_id}: {e}")
                all_success = False

        return all_success

    async def _config_watch_loop(self) -> None:
        """
        Watch for config changes and reload when detected.

        Directly compares config content hash instead of relying on
        notification flags. Simpler and more reliable.
        """
        import hashlib
        import json

        watch_interval = 15.0  # Check every 15 seconds

        def compute_config_hash(config: dict) -> str:
            """Compute hash of control-relevant config content"""
            # Extract device fingerprints (id, type, rated_power) for change detection
            devices = config.get("devices", [])
            device_fingerprints = [
                {"id": d.get("id"), "device_type": d.get("device_type"), "rated_power_kw": d.get("rated_power_kw")}
                for d in devices
            ]
            content = {
                "operation_mode": config.get("operation_mode"),
                "dg_reserve_kw": config.get("dg_reserve_kw"),
                "control_interval_ms": config.get("control_interval_ms"),
                "safe_mode": config.get("safe_mode", {}),
                "mode_settings": config.get("mode_settings", {}),
                "site_calculations": config.get("site_calculations", []),
                "devices": device_fingerprints,
            }
            content_str = json.dumps(content, sort_keys=True, default=str)
            return hashlib.md5(content_str.encode()).hexdigest()

        # Store current config hash
        current_hash = ""
        initial_config = get_config()
        if initial_config:
            current_hash = compute_config_hash(initial_config)

        while self._running:
            try:
                # Read fresh config from SharedState
                config = SharedState.read_fresh("config")
                if not config:
                    await asyncio.sleep(watch_interval)
                    continue

                new_hash = compute_config_hash(config)

                if new_hash != current_hash:
                    logger.info(f"Config change detected (hash: {current_hash[:8]} → {new_hash[:8]}), reloading...")

                    # Reload configuration
                    await self._load_config()

                    current_hash = new_hash

                    logger.info(
                        f"Config reloaded: mode={self._operation_mode}, "
                        f"interval={self._control_interval_ms}ms",
                        extra={
                            "operation_mode": self._operation_mode,
                            "interval_ms": self._control_interval_ms,
                        },
                    )

            except Exception as e:
                logger.error(f"Error in config watch loop: {e}")

            await asyncio.sleep(watch_interval)

    async def _start_health_server(self) -> None:
        """Start the health check HTTP server"""
        self._health_app = web.Application()
        self._health_app.router.add_get("/health", self._health_handler)
        self._health_app.router.add_get("/state", self._state_handler)

        self._health_runner = web.AppRunner(self._health_app)
        await self._health_runner.setup()

        site = web.TCPSite(self._health_runner, "127.0.0.1", HEALTH_PORT)
        await site.start()

        logger.info(f"Health server started on port {HEALTH_PORT}")

    async def _stop_health_server(self) -> None:
        """Stop the health check HTTP server"""
        if self._health_runner:
            await self._health_runner.cleanup()

    async def _health_handler(self, request: web.Request) -> web.Response:
        """Handle health check requests"""
        uptime = (datetime.now(timezone.utc) - self._start_time).total_seconds()

        return web.json_response({
            "status": "healthy" if self._running else "unhealthy",
            "service": "control",
            "uptime": int(uptime),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "operation_mode": self._operation_mode,
            "safe_mode_active": self._current_state.safe_mode_active,
            "solar_limit_pct": self._current_state.solar_limit_pct,
        })

    async def _state_handler(self, request: web.Request) -> web.Response:
        """Return current control state"""
        return web.json_response(self._current_state.to_dict())


async def main() -> None:
    """Main entry point"""
    service = ControlService()

    try:
        await service.start()
    finally:
        await service.stop()


if __name__ == "__main__":
    asyncio.run(main())
