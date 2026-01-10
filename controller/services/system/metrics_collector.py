"""
System Metrics Collector

Collects system metrics for heartbeat payload:
- CPU usage
- Memory usage
- Disk usage
- CPU temperature
- Uptime
"""

import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class SystemMetrics:
    """System metrics data"""
    cpu_usage_pct: float
    memory_usage_pct: float
    disk_usage_pct: float
    cpu_temp_celsius: float | None
    uptime_seconds: int
    timestamp: str


class MetricsCollector:
    """Collects system metrics from the Raspberry Pi"""

    def __init__(self):
        self._start_time = time.time()

    def collect(self) -> SystemMetrics:
        """Collect current system metrics"""
        return SystemMetrics(
            cpu_usage_pct=self._get_cpu_usage(),
            memory_usage_pct=self._get_memory_usage(),
            disk_usage_pct=self._get_disk_usage(),
            cpu_temp_celsius=self._get_cpu_temp(),
            uptime_seconds=int(time.time() - self._start_time),
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    def _get_cpu_usage(self) -> float:
        """Get CPU usage percentage"""
        try:
            import psutil
            return psutil.cpu_percent(interval=0.1)
        except ImportError:
            # Fallback for systems without psutil
            return self._get_cpu_usage_fallback()

    def _get_cpu_usage_fallback(self) -> float:
        """Fallback CPU usage from /proc/stat"""
        try:
            with open("/proc/stat", "r") as f:
                line = f.readline()
                parts = line.split()
                if parts[0] == "cpu":
                    idle = int(parts[4])
                    total = sum(int(p) for p in parts[1:])
                    return round((1 - idle / total) * 100, 1) if total > 0 else 0.0
        except (FileNotFoundError, IOError, IndexError):
            pass
        return 0.0

    def _get_memory_usage(self) -> float:
        """Get memory usage percentage"""
        try:
            import psutil
            mem = psutil.virtual_memory()
            return round(mem.percent, 1)
        except ImportError:
            return self._get_memory_usage_fallback()

    def _get_memory_usage_fallback(self) -> float:
        """Fallback memory usage from /proc/meminfo"""
        try:
            meminfo = {}
            with open("/proc/meminfo", "r") as f:
                for line in f:
                    parts = line.split()
                    if len(parts) >= 2:
                        meminfo[parts[0].rstrip(":")] = int(parts[1])

            total = meminfo.get("MemTotal", 0)
            available = meminfo.get("MemAvailable", 0)
            if total > 0:
                return round((1 - available / total) * 100, 1)
        except (FileNotFoundError, IOError, KeyError):
            pass
        return 0.0

    def _get_disk_usage(self) -> float:
        """Get disk usage percentage for root filesystem"""
        try:
            import psutil
            disk = psutil.disk_usage("/")
            return round(disk.percent, 1)
        except ImportError:
            return self._get_disk_usage_fallback()

    def _get_disk_usage_fallback(self) -> float:
        """Fallback disk usage using os.statvfs"""
        try:
            stat = os.statvfs("/")
            total = stat.f_blocks * stat.f_frsize
            free = stat.f_bavail * stat.f_frsize
            if total > 0:
                return round((1 - free / total) * 100, 1)
        except (OSError, AttributeError):
            pass
        return 0.0

    def _get_cpu_temp(self) -> float | None:
        """Get CPU temperature in Celsius (Raspberry Pi specific)"""
        # Try Raspberry Pi thermal zone
        thermal_paths = [
            "/sys/class/thermal/thermal_zone0/temp",
            "/sys/devices/virtual/thermal/thermal_zone0/temp",
        ]

        for path in thermal_paths:
            try:
                with open(path, "r") as f:
                    temp_str = f.read().strip()
                    # Temperature is in millidegrees
                    return round(int(temp_str) / 1000, 1)
            except (FileNotFoundError, IOError, ValueError):
                continue

        # Try psutil for non-Raspberry Pi systems
        try:
            import psutil
            temps = psutil.sensors_temperatures()
            if temps:
                for name, entries in temps.items():
                    if entries:
                        return round(entries[0].current, 1)
        except (ImportError, AttributeError):
            pass

        return None

    def get_uptime_seconds(self) -> int:
        """Get service uptime in seconds"""
        return int(time.time() - self._start_time)

    def to_dict(self) -> dict:
        """Get metrics as dictionary"""
        metrics = self.collect()
        return {
            "cpu_usage_pct": metrics.cpu_usage_pct,
            "memory_usage_pct": metrics.memory_usage_pct,
            "disk_usage_pct": metrics.disk_usage_pct,
            "cpu_temp_celsius": metrics.cpu_temp_celsius,
            "uptime_seconds": metrics.uptime_seconds,
        }
