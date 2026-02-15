/**
 * Type definitions for the Solar Diesel Controller
 *
 * These types match the database schema and API responses.
 */

// ============================================
// USER TYPES
// ============================================

export type UserRole =
  | "super_admin"
  | "backend_admin"
  | "admin"           // Legacy role (same level as enterprise_admin)
  | "enterprise_admin"
  | "configurator"
  | "viewer";

export interface User {
  id: string;
  email: string;
  role: UserRole;
  full_name: string | null;
  phone?: string | null;  // Optional - column may not exist in all deployments
  enterprise_id: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

// User with joined enterprise data for list displays
export interface UserWithEnterprise extends User {
  enterprises: { name: string } | null;
}

// Project assignment for a user
export interface UserProjectAssignment {
  project_id: string;
  project_name: string | null;
  enterprise_id: string | null;
  can_edit: boolean;
  can_control: boolean;
  assigned_at: string | null;
}

// ============================================
// PROJECT TYPES
// ============================================

// Note: Control settings, logging settings, safe mode settings, and controller info
// are now managed at the SITE level, not project level.
// Projects are just containers for grouping sites.

export type ControllerStatus = "online" | "offline" | "error";
export type OperationMode = "zero_dg_reverse" | "zero_dg_pf" | "zero_dg_reactive";
export type SafeModeType = "time_based" | "rolling_average";

export interface Project {
  id: string;
  name: string;
  location: string | null;
  description: string | null;
  timezone: string;
  site_count: number;
  is_active: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  location: string | null;
  site_count: number;
  is_active: boolean;
}

// ============================================
// DEVICE TYPES
// ============================================

export type DeviceType =
  // Power generation
  | "inverter"                      // Solar Inverter
  | "wind_turbine"                  // Wind Turbine
  | "bess"                          // Battery Energy Storage System
  // Generator controllers
  | "gas_generator_controller"      // Gas Generator Controller
  | "diesel_generator_controller"   // Diesel Generator Controller
  // Metering
  | "energy_meter"                  // Energy Meter
  | "capacitor_bank"                // Capacitor Bank
  // Sensors
  | "fuel_level_sensor"             // Fuel Level Sensor
  | "fuel_flow_meter"               // Fuel Flow Meter
  | "temperature_humidity_sensor"   // Temperature & Humidity Sensor
  | "solar_radiation_sensor"        // Solar Radiation Sensor
  | "wind_sensor"                   // Wind Sensor
  // Industrial equipment
  | "belt_scale"                    // Belt Scale (conveyor scale integrators)
  // Generic
  | "other_hardware"                // Other Hardware
  // Legacy (backward compatibility)
  | "dg"
  | "load_meter"
  | "sensor";

export type DeviceOperation = "solar" | "dg" | "meter" | "sensor" | "storage" | "other";
export type Protocol = "tcp" | "rtu_gateway" | "rtu_direct";

// Calculated field selection for templates
export interface CalculatedFieldSelection {
  field_id: string;                    // e.g., "daily_kwh_consumption"
  name: string;                        // Human-readable name
  storage_mode: "log" | "viz_only";    // Log to DB or live display only
}

export interface DeviceTemplate {
  id: string;
  template_id: string;
  name: string;
  device_type: DeviceType;
  operation: DeviceOperation;
  brand: string;
  model: string;
  rated_power_kw: number | null;
  rated_power_kva: number | null;
  // Registers for logging AND control (stored in database, used by control logic)
  logging_registers: ModbusRegister[];
  // Registers for live visualization only (NOT stored in database)
  visualization_registers: ModbusRegister[];
  // Alarm registers with thresholds
  alarm_registers?: AlarmRegister[];
  // Alarm definitions (structured alarms with conditions)
  alarm_definitions?: AlarmDefinition[];
  // Calculated field selections for this template
  calculated_fields: CalculatedFieldSelection[];
  specifications: Record<string, unknown>;
  is_active: boolean;
  // Legacy field for backward compatibility (may exist in DB but not used)
  registers?: ModbusRegister[];
  // Template type and enterprise fields (for public vs custom templates)
  template_type?: "public" | "custom";
  enterprise_id?: string | null;
  created_by?: string | null;
}

// Request to duplicate a device template
export interface DeviceTemplateDuplicateRequest {
  new_template_id: string;
  new_name: string;
  enterprise_id?: string;  // Optional, only super_admin/admin can specify
}

export interface ModbusRegister {
  address: number;
  name: string;
  description: string;
  type: "input" | "holding";
  access: "read" | "write" | "readwrite";
  datatype: string;
  scale?: number;
  unit?: string;
  values?: Record<string, unknown>;
}

// Alarm severity levels - unified for both alarm thresholds and general alarms
// "info" for informational, "warning" for low priority, "minor" for medium,
// "major" for high priority, "critical" for immediate attention
export type AlarmSeverity = "info" | "warning" | "minor" | "major" | "critical";
export type ThresholdOperator = ">" | ">=" | "<" | "<=" | "==" | "!=";

export interface AlarmThreshold {
  operator: ThresholdOperator;
  value: number;
  severity: AlarmSeverity;
  message?: string;
}

// Alarm register extends ModbusRegister with optional thresholds
export interface AlarmRegister extends ModbusRegister {
  thresholds?: AlarmThreshold[];
}

// SiteDevice - devices belong to sites, not projects
export interface SiteDevice {
  id: string;
  site_id: string;
  template_id: string | null;
  template?: DeviceTemplate;
  name: string;
  protocol: Protocol;
  ip_address: string | null;
  port: number;
  gateway_ip: string | null;
  gateway_port: number | null;
  slave_id: number;
  rated_power_kw: number | null;
  rated_power_kva: number | null;
  registers: ModbusRegister[];
  alarm_registers: AlarmRegister[];
  logging_interval_ms: number;
  last_seen: string | null;
  is_online: boolean;
  last_error: string | null;
  enabled: boolean;
}

// Legacy alias for backward compatibility
export type ProjectDevice = SiteDevice;

// ============================================
// CONTROL LOG TYPES
// ============================================

export type ConfigMode = "meter_inverter" | "dg_inverter" | "full_system";

export interface ControlLog {
  id: number;
  project_id: string;
  timestamp: string;
  total_load_kw: number;
  dg_power_kw: number;
  solar_output_kw: number;
  solar_limit_pct: number;
  available_headroom_kw: number;
  safe_mode_active: boolean;
  config_mode: ConfigMode;
  load_meters_online: number;
  inverters_online: number;
  generators_online: number;
}

// ============================================
// ALARM TYPES
// ============================================

export type AlarmType =
  | "communication_lost"
  | "control_error"
  | "safe_mode_triggered"
  | "not_reporting"
  | "controller_offline"
  | "write_failed"
  | "command_not_taken";

// Per-project notification settings for a user
export interface UserProjectNotificationSettings {
  // Email settings
  email_enabled: boolean;
  email_min_severity: AlarmSeverity;
  email_on_active: boolean;
  email_on_resolved: boolean;
  // SMS settings (pluggable for future)
  sms_enabled: boolean;
  sms_phone_number: string | null;
  sms_min_severity: AlarmSeverity;
  sms_on_active: boolean;
  sms_on_resolved: boolean;
}

export interface Alarm {
  id: string;
  project_id: string;
  alarm_type: AlarmType;
  device_name: string | null;
  message: string;
  severity: AlarmSeverity;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

// ============================================
// DASHBOARD TYPES
// ============================================

export interface DashboardStats {
  totalProjects: number;
  onlineProjects: number;
  totalAlarms: number;
  criticalAlarms: number;
}

export interface LiveData {
  timestamp: string;
  load_kw: number;
  solar_kw: number;
  dg_kw: number;
  solar_limit_pct: number;
  safe_mode: boolean;
}

// ============================================
// ALARM DEFINITION TYPES
// ============================================

// Source types for alarm definitions
export type AlarmSourceType =
  | "modbus_register"   // From a Modbus register value
  | "device_info"       // From controller heartbeat (cpu_temp, disk_usage, etc.)
  | "calculated_field"  // From a calculated value (total_solar, total_load)
  | "heartbeat";        // Heartbeat timeout detection

// Single threshold condition within an alarm definition
export interface AlarmCondition {
  operator: ThresholdOperator;
  value: number;
  severity: AlarmSeverity;
  message: string;
}

// Complete alarm definition (stored in templates)
export interface AlarmDefinition {
  id: string;                        // Unique ID within template (e.g., "high_cpu_temp")
  name: string;                      // Display name
  description: string;               // Detailed description
  source_type: AlarmSourceType;      // What triggers this alarm
  source_key: string;                // Register name or field name
  conditions: AlarmCondition[];      // Threshold conditions (evaluated in order)
  enabled_by_default: boolean;       // Whether enabled when device is added
  cooldown_seconds: number;          // Deduplication cooldown between alarms
}

// ============================================
// CONTROLLER TEMPLATE TYPES
// ============================================

// System register definition (for controller logging)
export interface SystemRegister {
  name: string;                      // e.g., "cpu_temp"
  source: "device_info" | "calculated";
  field: string;                     // e.g., "cpu_temp_celsius"
  unit: string;                      // e.g., "C"
  description?: string;
}

// Controller template (for Raspberry Pi, gateways)
export interface ControllerTemplate {
  id: string;
  template_id: string;               // e.g., "rpi5_standard"
  name: string;                      // e.g., "Raspberry Pi 5 Standard"
  description: string | null;
  controller_type: "raspberry_pi" | "gateway" | "plc";
  hardware_type_id: string | null;   // Link to approved_hardware
  brand: string | null;
  model: string | null;
  registers: SystemRegister[];       // System metrics to log
  alarm_definitions: AlarmDefinition[];
  calculated_fields: string[];       // References to calculated_field_definitions
  specifications: Record<string, unknown>;
  template_type: "public" | "custom";
  enterprise_id: string | null;      // NULL for public templates
  created_by: string | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

// ============================================
// SITE ALARM OVERRIDE TYPES
// ============================================

// Site-specific alarm configuration override
export interface SiteAlarmOverride {
  id: string;
  site_id: string;
  source_type: "controller_template" | "device_template" | "device";
  source_id: string;                 // Template or device ID
  alarm_definition_id: string;       // Which alarm is being overridden
  enabled: boolean | null;           // NULL = use template default
  conditions_override: AlarmCondition[] | null;  // NULL = use template defaults
  cooldown_seconds_override: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Effective alarm config (template + site override merged)
export interface EffectiveAlarmConfig {
  alarm_definition: AlarmDefinition;
  override?: SiteAlarmOverride;
  enabled: boolean;                  // Final enabled state
  conditions: AlarmCondition[];      // Final conditions
  cooldown_seconds: number;          // Final cooldown
  is_customized: boolean;            // Whether site has overrides
}

// ============================================
// CALCULATED FIELD TYPES
// ============================================

// Calculation types
export type CalculationType =
  | "sum"          // Sum of values (Total Solar, Total Load)
  | "difference"   // A - B (Generator Power = Load - Solar)
  | "cumulative"   // Rolling sum over time (Daily Energy)
  | "average"      // Average of values
  | "max"          // Maximum value
  | "min"          // Minimum value
  | "delta";       // Counter delta over time window (Energy Consumption)

// Time window for cumulative calculations
export type TimeWindow = "hour" | "day" | "week" | "month" | "year";

// Calculation scope
export type CalculationScope = "controller" | "device";

// Calculated field definition
export interface CalculatedFieldDefinition {
  id: string;
  field_id: string;                  // e.g., "total_solar_kw"
  name: string;                      // e.g., "Total Solar Power"
  description: string | null;
  scope: CalculationScope;
  device_types: DeviceType[] | null; // For device scope
  calculation_type: CalculationType;
  time_window: TimeWindow | null;    // For cumulative calculations
  calculation_config: Record<string, unknown>;
  unit: string | null;
  log_enabled: boolean;
  logging_frequency_seconds: number;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
