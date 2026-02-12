"""
Configuration Dataclasses

Type-safe configuration structures for the controller.
All configuration is synced from cloud via Config Service.
"""

from dataclasses import dataclass, field
from typing import Any
from enum import Enum


class OperationMode(str, Enum):
    """Supported operation modes"""
    ZERO_DG_REVERSE = "zero_dg_reverse"
    ZERO_DG_PF = "zero_dg_pf"
    ZERO_DG_REACTIVE = "zero_dg_reactive"
    PEAK_SHAVING = "peak_shaving"


class ConfigMode(str, Enum):
    """Configuration mode based on available devices"""
    METER_INVERTER = "meter_inverter"
    DG_INVERTER = "dg_inverter"
    FULL_SYSTEM = "full_system"


class SafeModeType(str, Enum):
    """Safe mode trigger types"""
    TIME_BASED = "time_based"
    ROLLING_AVERAGE = "rolling_average"


class DeviceType(str, Enum):
    """Device types - must match database/frontend types"""
    # Power generation
    INVERTER = "inverter"
    WIND_TURBINE = "wind_turbine"
    BESS = "bess"
    # Generator controllers
    DIESEL_GENERATOR_CONTROLLER = "diesel_generator_controller"
    DIESEL_GENERATOR = "diesel_generator"
    GAS_GENERATOR_CONTROLLER = "gas_generator_controller"
    # Metering
    ENERGY_METER = "energy_meter"
    CAPACITOR_BANK = "capacitor_bank"
    # Sensors
    FUEL_LEVEL_SENSOR = "fuel_level_sensor"
    FUEL_FLOW_METER = "fuel_flow_meter"
    TEMPERATURE_HUMIDITY_SENSOR = "temperature_humidity_sensor"
    SOLAR_RADIATION_SENSOR = "solar_radiation_sensor"
    WIND_SENSOR = "wind_sensor"
    # Industrial
    BELT_SCALE = "belt_scale"
    # Generic
    OTHER_HARDWARE = "other_hardware"
    # Frontend device types (measurement categories)
    LOAD = "load"
    SUBLOAD = "subload"
    SOLAR_METER = "solar_meter"
    SOLAR_SENSOR = "solar_sensor"
    GAS_GENERATOR = "gas_generator"
    OTHER = "other"
    # Legacy (backwards compatibility)
    LOAD_METER = "load_meter"
    DG = "dg"
    SENSOR = "sensor"


class Protocol(str, Enum):
    """Communication protocols"""
    TCP = "tcp"
    RTU_GATEWAY = "rtu_gateway"
    RTU_DIRECT = "rtu_direct"


class RegisterDataType(str, Enum):
    """Modbus register data types"""
    UINT16 = "uint16"
    INT16 = "int16"
    UINT32 = "uint32"
    INT32 = "int32"
    FLOAT32 = "float32"
    FLOAT64 = "float64"
    UTF8 = "utf8"


@dataclass
class ModbusRegister:
    """Modbus register definition"""
    address: int
    name: str
    type: str = "holding"  # holding, input, coil, discrete
    datatype: RegisterDataType = RegisterDataType.UINT16
    access: str = "read"  # read, read_write
    scale: float = 1.0
    unit: str = ""
    size: int = 0  # Register count override (0 = use datatype default)
    poll_interval_ms: int = 1000
    log_to_cloud: bool = True


@dataclass
class AlarmCondition:
    """Alarm threshold condition"""
    operator: str  # >, >=, <, <=, ==, !=
    value: float
    severity: str  # info, warning, major, critical
    message: str


@dataclass
class AlarmDefinition:
    """Alarm definition with thresholds"""
    id: str
    name: str
    source_type: str  # modbus_register, device_info, calculated_field, heartbeat
    source_key: str
    conditions: list[AlarmCondition] = field(default_factory=list)
    enabled_by_default: bool = True
    cooldown_seconds: int = 300
    description: str = ""
    device_id: str | None = None      # Device ID for device-specific alarms
    device_name: str | None = None    # Device name for alarm display


@dataclass
class DeviceConfig:
    """Device configuration"""
    id: str
    name: str
    device_type: DeviceType
    protocol: Protocol
    host: str
    port: int = 502
    slave_id: int = 1
    registers: list[ModbusRegister] = field(default_factory=list)
    alarm_definitions: list[AlarmDefinition] = field(default_factory=list)
    rated_power_kw: float | None = None
    rated_power_kva: float | None = None
    # RTU Direct serial port settings (used when protocol == RTU_DIRECT)
    serial_port: str = ""         # e.g., "/dev/ttyACM1"
    baudrate: int = 9600          # 9600, 19200, 38400, 115200
    parity: str = "N"             # N=None, E=Even, O=Odd
    stopbits: int = 1             # 1 or 2


@dataclass
class CalculatedField:
    """Calculated field definition"""
    field_id: str
    name: str
    calculation_type: str  # sum, difference, cumulative, average, max, min
    source_devices: list[str]  # Device types
    source_register: str
    unit: str = ""
    time_window: str | None = None  # hour, day, week, month, year


@dataclass
class ModeSettings:
    """Operation mode-specific settings"""
    dg_reserve_kw: float | None = None  # zero_dg_reverse, zero_dg_pf
    target_power_factor: float | None = None  # zero_dg_pf
    max_reactive_kvar: float | None = None  # zero_dg_reactive
    peak_threshold_kw: float | None = None  # peak_shaving
    battery_reserve_pct: float | None = None  # peak_shaving


@dataclass
class LoggingSettings:
    """Logging interval configuration"""
    local_write_interval_s: int = 10  # Write to SQLite
    cloud_sync_interval_s: int = 120  # Sync to cloud (2 minutes)
    aggregation_method: str = "last"  # last, avg
    include_min_max: bool = True
    local_retention_days: int = 7
    instant_sync_alarms: bool = True


@dataclass
class SafeModeSettings:
    """Safe mode configuration"""
    enabled: bool = True
    type: SafeModeType = SafeModeType.TIME_BASED
    timeout_s: int = 30
    rolling_window_min: int = 3
    threshold_pct: float = 80.0
    power_limit_kw: float = 0.0


@dataclass
class SiteConfig:
    """Complete site configuration (synced from cloud)"""
    id: str
    name: str
    operation_mode: OperationMode = OperationMode.ZERO_DG_REVERSE
    config_mode: ConfigMode = ConfigMode.FULL_SYSTEM
    control_interval_ms: int = 1000

    # Mode-specific settings
    mode_settings: ModeSettings = field(default_factory=ModeSettings)

    # Logging configuration
    logging: LoggingSettings = field(default_factory=LoggingSettings)

    # Safe mode configuration
    safe_mode: SafeModeSettings = field(default_factory=SafeModeSettings)

    # Devices
    devices: list[DeviceConfig] = field(default_factory=list)

    # Calculated fields
    calculated_fields: list[CalculatedField] = field(default_factory=list)

    # Alarm definitions (site-level overrides)
    alarm_overrides: dict[str, dict] = field(default_factory=dict)

    # Sync metadata
    updated_at: str = ""
    synced_at: str = ""

    def get_devices_by_type(self, device_type: DeviceType) -> list[DeviceConfig]:
        """Get all devices of a specific type"""
        return [d for d in self.devices if d.device_type == device_type]

    def get_inverters(self) -> list[DeviceConfig]:
        """Get all inverter devices"""
        return self.get_devices_by_type(DeviceType.INVERTER)

    def get_load_meters(self) -> list[DeviceConfig]:
        """Get all load meter devices (matches load, load_meter, energy_meter types)"""
        load_types = {DeviceType.LOAD_METER, DeviceType.LOAD, DeviceType.ENERGY_METER}
        return [d for d in self.devices if d.device_type in load_types]

    def get_generators(self) -> list[DeviceConfig]:
        """Get all DG devices"""
        return self.get_devices_by_type(DeviceType.DG)

    def get_total_solar_capacity(self) -> float:
        """Get total rated solar capacity in kW"""
        return sum(d.rated_power_kw or 0 for d in self.get_inverters())


@dataclass
class ControllerConfig:
    """Controller-level configuration"""
    id: str
    serial_number: str
    hardware_type: str
    firmware_version: str
    site_id: str | None = None


@dataclass
class ServiceConfig:
    """Service runtime configuration"""
    service_name: str
    health_port: int
    log_level: str = "INFO"

    # Retry policies
    max_retries: int = 3
    retry_backoff: list[float] = field(default_factory=lambda: [1.0, 2.0, 4.0])


# Helper function to load config from dict
def load_site_config(data: dict) -> SiteConfig:
    """Load SiteConfig from dictionary (e.g., from JSON file)"""
    mode_settings = ModeSettings(
        dg_reserve_kw=data.get("mode_settings", {}).get("dg_reserve_kw"),
        target_power_factor=data.get("mode_settings", {}).get("target_power_factor"),
        max_reactive_kvar=data.get("mode_settings", {}).get("max_reactive_kvar"),
        peak_threshold_kw=data.get("mode_settings", {}).get("peak_threshold_kw"),
        battery_reserve_pct=data.get("mode_settings", {}).get("battery_reserve_pct"),
    )

    logging_data = data.get("logging", {})
    logging_settings = LoggingSettings(
        local_write_interval_s=logging_data.get("local_write_interval_s", 10),
        cloud_sync_interval_s=logging_data.get("cloud_sync_interval_s", 120),
        aggregation_method=logging_data.get("aggregation_method", "last"),
        include_min_max=logging_data.get("include_min_max", True),
        local_retention_days=logging_data.get("local_retention_days", 7),
        instant_sync_alarms=logging_data.get("instant_sync_alarms", True),
    )

    safe_mode_data = data.get("safe_mode", {})
    safe_mode_settings = SafeModeSettings(
        enabled=safe_mode_data.get("enabled", True),
        type=SafeModeType(safe_mode_data.get("type", "time_based")),
        timeout_s=safe_mode_data.get("timeout_s", 30),
        rolling_window_min=safe_mode_data.get("rolling_window_min", 3),
        threshold_pct=safe_mode_data.get("threshold_pct", 80.0),
        power_limit_kw=safe_mode_data.get("power_limit_kw", 0.0),
    )

    devices = []
    for d in data.get("devices", []):
        registers = [
            ModbusRegister(
                address=r["address"],
                name=r["name"],
                type=r.get("type", "holding"),
                datatype=RegisterDataType(r.get("datatype", "uint16")),
                access=r.get("access", "read"),
                scale=r.get("scale", 1.0),
                unit=r.get("unit", ""),
                size=r.get("size", 0),
                poll_interval_ms=r.get("poll_interval_ms", 1000),
                log_to_cloud=r.get("log_to_cloud", True),
            )
            for r in d.get("registers", [])
        ]

        devices.append(DeviceConfig(
            id=d["id"],
            name=d["name"],
            device_type=DeviceType(d["device_type"]),
            protocol=Protocol(d.get("protocol", "tcp")),
            host=d.get("host", ""),
            port=d.get("port", 502),
            slave_id=d.get("slave_id", 1),
            registers=registers,
            rated_power_kw=d.get("rated_power_kw"),
            rated_power_kva=d.get("rated_power_kva"),
            serial_port=d.get("serial_port", d.get("port_path", "")),
            baudrate=d.get("baudrate", 9600),
            parity=d.get("parity", "N"),
            stopbits=d.get("stopbits", 1),
        ))

    calculated_fields = [
        CalculatedField(
            field_id=cf["field_id"],
            name=cf["name"],
            calculation_type=cf["calculation_type"],
            source_devices=cf.get("source_devices", []),
            source_register=cf.get("source_register", ""),
            unit=cf.get("unit", ""),
            time_window=cf.get("time_window"),
        )
        for cf in data.get("calculated_fields", [])
    ]

    return SiteConfig(
        id=data.get("id", ""),
        name=data.get("name", ""),
        operation_mode=OperationMode(data.get("operation_mode", "zero_dg_reverse")),
        config_mode=ConfigMode(data.get("config_mode", "full_system")),
        control_interval_ms=data.get("control_interval_ms", 1000),
        mode_settings=mode_settings,
        logging=logging_settings,
        safe_mode=safe_mode_settings,
        devices=devices,
        calculated_fields=calculated_fields,
        alarm_overrides=data.get("alarm_overrides", {}),
        updated_at=data.get("updated_at", ""),
        synced_at=data.get("synced_at", ""),
    )
