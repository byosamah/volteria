/**
 * Type definitions for the Solar Diesel Controller
 *
 * These types match the database schema and API responses.
 */

// ============================================
// USER TYPES
// ============================================

export type UserRole = "super_admin" | "admin" | "configurator" | "viewer";

export interface User {
  id: string;
  email: string;
  role: UserRole;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

// ============================================
// PROJECT TYPES
// ============================================

export type ControllerStatus = "online" | "offline" | "error";
export type OperationMode = "zero_dg_reverse" | "zero_dg_pf" | "zero_dg_reactive";
export type SafeModeType = "time_based" | "rolling_average";

export interface Project {
  id: string;
  name: string;
  location: string | null;
  description: string | null;

  // Controller info
  controller_serial_number: string | null;
  controller_hardware_type: string;
  controller_firmware_version: string | null;
  controller_registered_at: string | null;
  controller_last_seen: string | null;
  controller_status: ControllerStatus;

  // Control settings
  control_interval_ms: number;
  dg_reserve_kw: number;
  operation_mode: OperationMode;

  // Logging settings
  logging_local_interval_ms: number;
  logging_cloud_interval_ms: number;
  logging_local_retention_days: number;

  // Safe mode settings
  safe_mode_enabled: boolean;
  safe_mode_type: SafeModeType;
  safe_mode_timeout_s: number;
  safe_mode_rolling_window_min: number;
  safe_mode_threshold_pct: number;

  // Metadata
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  location: string | null;
  controller_status: ControllerStatus;
  device_count: number;
  is_active: boolean;
}

// ============================================
// DEVICE TYPES
// ============================================

export type DeviceType = "inverter" | "dg" | "load_meter";
export type DeviceOperation = "solar" | "dg" | "meter";
export type Protocol = "tcp" | "rtu_gateway" | "rtu_direct";

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
  registers: ModbusRegister[];
  specifications: Record<string, unknown>;
  is_active: boolean;
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

export interface ProjectDevice {
  id: string;
  project_id: string;
  template_id: string;
  template?: DeviceTemplate;
  name: string;
  protocol: Protocol;
  ip_address: string | null;
  port: number;
  gateway_ip: string | null;
  gateway_port: number;
  slave_id: number;
  rated_power_kw: number | null;
  rated_power_kva: number | null;
  last_seen: string | null;
  is_online: boolean;
  last_error: string | null;
  enabled: boolean;
}

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

export type AlarmSeverity = "info" | "warning" | "critical";

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
