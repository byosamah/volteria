/**
 * Live Registers Types
 *
 * Type definitions for the live registers feature.
 * Provides real-time Modbus register reading and writing.
 */

import type { ModbusRegister } from "@/components/devices/register-form";
import type { AlarmSeverity } from "@/lib/types";

// Value returned from a register read
export interface RegisterValue {
  raw_value: number | string;       // Raw value from Modbus (string for UTF8)
  scaled_value: number | string;    // After applying scale/offset (string for UTF8)
  timestamp: string;       // ISO timestamp
}

// State for register values map
// Key format: "section-address" e.g., "logging-5006"
export type RegisterValuesMap = Map<string, RegisterValue>;

// Loading state for groups
export type LoadingGroupsSet = Set<string>;

// Write status for a register
export type WriteStatus = "pending" | "success" | "error";
export type WriteStatusMap = Map<string, WriteStatus>;

// Pending write values
export type PendingWritesMap = Map<string, string>;

// Section types for registers
export type RegisterSection = "logging" | "visualization" | "alarms";

// Group of registers (by register.group or auto-chunked)
export interface RegisterGroup {
  name: string;              // Group name or "Group 1", "Group 2" for auto-chunked
  registers: ModbusRegister[];
}

// Alarm status based on current value vs thresholds
export type AlarmStatus = "ok" | "warning" | "minor" | "major" | "critical";

// Props for components
export interface LiveRegistersClientProps {
  device: {
    id: string;
    name: string;
    device_type: string | null;
    is_online: boolean;
    registers: ModbusRegister[] | null;
    visualization_registers: ModbusRegister[] | null;
    alarm_registers: ModbusRegister[] | null;
    device_templates: {
      name: string;
      brand: string;
      model: string;
    } | null;
  };
  projectId: string;
  siteId: string;
  controllerId: string | null;
}

export interface RegisterSectionProps {
  title: string;
  section: RegisterSection;
  groups: RegisterGroup[];
  registerValues: RegisterValuesMap;
  loadingGroups: LoadingGroupsSet;
  pendingWrites: PendingWritesMap;
  writeStatus: WriteStatusMap;
  onRequestData: (section: RegisterSection, groupName: string, registers: ModbusRegister[]) => void;
  onWriteValue: (section: RegisterSection, register: ModbusRegister, value: string) => void;
  onPendingWriteChange: (key: string, value: string) => void;
}

export interface RegisterGroupProps {
  group: RegisterGroup;
  section: RegisterSection;
  isLoading: boolean;
  registerValues: RegisterValuesMap;
  pendingWrites: PendingWritesMap;
  writeStatus: WriteStatusMap;
  onRequestData: () => void;
  onWriteValue: (register: ModbusRegister, value: string) => void;
  onPendingWriteChange: (key: string, value: string) => void;
}

export interface RegisterRowProps {
  register: ModbusRegister;
  section: RegisterSection;
  value: RegisterValue | undefined;
  pendingWrite: string | undefined;
  writeStatus: WriteStatus | undefined;
  onWriteValue: (value: string) => void;
  onPendingWriteChange: (value: string) => void;
}

// Evaluate alarm status based on value and thresholds
export function evaluateAlarmStatus(
  value: number | undefined,
  thresholds: ModbusRegister["thresholds"]
): AlarmStatus {
  if (value === undefined || !thresholds || thresholds.length === 0) {
    return "ok";
  }

  // Evaluate thresholds in order (first match wins)
  for (const threshold of thresholds) {
    let matches = false;
    switch (threshold.operator) {
      case ">":
        matches = value > threshold.value;
        break;
      case ">=":
        matches = value >= threshold.value;
        break;
      case "<":
        matches = value < threshold.value;
        break;
      case "<=":
        matches = value <= threshold.value;
        break;
      case "==":
        matches = value === threshold.value;
        break;
      case "!=":
        matches = value !== threshold.value;
        break;
    }
    if (matches) {
      return threshold.severity as AlarmStatus;
    }
  }

  return "ok";
}

// Get color classes for alarm status
export function getAlarmStatusColor(status: AlarmStatus): string {
  switch (status) {
    case "critical":
      return "text-red-600 bg-red-50";
    case "major":
      return "text-orange-600 bg-orange-50";
    case "minor":
      return "text-amber-600 bg-amber-50";
    case "warning":
      return "text-yellow-600 bg-yellow-50";
    default:
      return "text-green-600 bg-green-50";
  }
}

// Get severity color for threshold badge
export function getSeverityColor(severity: AlarmSeverity): string {
  switch (severity) {
    case "critical":
      return "bg-red-100 text-red-800 border-red-300";
    case "major":
      return "bg-orange-100 text-orange-800 border-orange-300";
    case "minor":
      return "bg-amber-100 text-amber-800 border-amber-300";
    case "warning":
      return "bg-yellow-100 text-yellow-800 border-yellow-300";
    default:
      return "bg-blue-100 text-blue-800 border-blue-300";
  }
}
