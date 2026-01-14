"use client";

/**
 * Device List Component
 *
 * Displays devices with edit and delete functionality.
 * Groups devices by type (energy meters, inverters, generators).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import Link from "next/link";
import { RegisterForm, type ModbusRegister } from "./register-form";

// Format logging frequency (in seconds) into readable labels
// This converts the per-register logging_frequency value to user-friendly text
function formatLoggingFrequency(seconds?: number): string {
  if (!seconds) return "1 min";  // Default: 60 seconds
  if (seconds < 1) return `${seconds * 1000}ms`;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

// Format "last seen" time for device status display
function formatLastSeen(timestamp: string | null): string {
  if (!timestamp) return "Never";
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// Protocol options - same as add device form
const protocols = [
  { value: "tcp", label: "Modbus TCP", description: "Direct TCP connection" },
  { value: "rtu_gateway", label: "RTU via Gateway", description: "RTU through a TCP gateway (e.g., Netbiter)" },
  { value: "rtu_direct", label: "Direct RTU", description: "Direct RS485 connection" },
];

// Device type options - used for control logic and calculated fields
const deviceTypes = [
  { value: "diesel_generator", label: "Diesel Generator", description: "Diesel generator control and monitoring" },
  { value: "gas_generator", label: "Gas Generator", description: "Gas generator control and monitoring" },
  { value: "inverter", label: "Solar Inverter", description: "PV power conversion" },
  { value: "solar_meter", label: "Solar Meter", description: "Solar energy metering" },
  { value: "load", label: "Load", description: "Main load measurement" },
  { value: "subload", label: "SubLoad", description: "Sub load measurement" },
  { value: "solar_sensor", label: "Solar Sensor", description: "Solar irradiance measurement" },
  { value: "temperature_humidity_sensor", label: "Temperature & Humidity Sensor", description: "Environmental monitoring" },
  { value: "wind_sensor", label: "Wind Sensor", description: "Wind speed and direction" },
  { value: "wind_turbine", label: "Wind Turbine", description: "Wind turbine power generation" },
  { value: "bess", label: "Battery Energy Storage System", description: "Battery storage system" },
  { value: "capacitor_bank", label: "Capacitor Bank", description: "Reactive power compensation" },
  { value: "other", label: "Other Devices", description: "Other device types" },
];

// Predefined calculated fields per device type (matches template-form-dialog.tsx)
const CALCULATED_FIELDS_BY_TYPE: Record<string, { field_id: string; name: string; unit: string }[]> = {
  // Load meters
  load: [
    { field_id: "daily_kwh_consumption", name: "Daily kWh Consumption", unit: "kWh" },
    { field_id: "daily_peak_load", name: "Daily Peak Load", unit: "kW" },
    { field_id: "daily_avg_load", name: "Daily Average Load", unit: "kW" },
  ],
  load_meter: [
    { field_id: "daily_kwh_consumption", name: "Daily kWh Consumption", unit: "kWh" },
    { field_id: "daily_peak_load", name: "Daily Peak Load", unit: "kW" },
    { field_id: "daily_avg_load", name: "Daily Average Load", unit: "kW" },
  ],
  energy_meter: [
    { field_id: "daily_kwh_consumption", name: "Daily kWh Consumption", unit: "kWh" },
    { field_id: "daily_peak_load", name: "Daily Peak Load", unit: "kW" },
    { field_id: "daily_avg_load", name: "Daily Average Load", unit: "kW" },
  ],
  // Solar inverters
  inverter: [
    { field_id: "daily_kwh_production", name: "Daily kWh Production", unit: "kWh" },
    { field_id: "daily_peak_kw", name: "Daily Peak kW", unit: "kW" },
    { field_id: "daily_avg_kw", name: "Daily Average kW", unit: "kW" },
  ],
  // Generator controllers
  diesel_generator: [
    { field_id: "daily_kwh_production", name: "Daily kWh Production", unit: "kWh" },
    { field_id: "daily_peak_kw", name: "Daily Peak kW", unit: "kW" },
    { field_id: "daily_avg_kw", name: "Daily Average kW", unit: "kW" },
  ],
  gas_generator: [
    { field_id: "daily_kwh_production", name: "Daily kWh Production", unit: "kWh" },
    { field_id: "daily_peak_kw", name: "Daily Peak kW", unit: "kW" },
    { field_id: "daily_avg_kw", name: "Daily Average kW", unit: "kW" },
  ],
  dg: [
    { field_id: "daily_kwh_production", name: "Daily kWh Production", unit: "kWh" },
    { field_id: "daily_peak_kw", name: "Daily Peak kW", unit: "kW" },
    { field_id: "daily_avg_kw", name: "Daily Average kW", unit: "kW" },
  ],
  // Wind turbine
  wind_turbine: [
    { field_id: "daily_kwh_production", name: "Daily kWh Production", unit: "kWh" },
    { field_id: "daily_peak_kw", name: "Daily Peak kW", unit: "kW" },
    { field_id: "daily_avg_kw", name: "Daily Average kW", unit: "kW" },
  ],
  // Battery storage
  bess: [
    { field_id: "daily_kwh_charged", name: "Daily kWh Charged", unit: "kWh" },
    { field_id: "daily_kwh_discharged", name: "Daily kWh Discharged", unit: "kWh" },
    { field_id: "daily_avg_soc", name: "Daily Average SOC", unit: "%" },
  ],
  // Fuel sensors
  fuel_level_sensor: [
    { field_id: "daily_fuel_level_difference_l", name: "Daily Fuel Level Difference (L)", unit: "L" },
    { field_id: "daily_fuel_level_difference_pct", name: "Daily Fuel Level Difference (%)", unit: "%" },
  ],
  // Environmental sensors
  temperature_humidity_sensor: [
    { field_id: "daily_peak_temp", name: "Daily Peak Temperature", unit: "°C" },
    { field_id: "daily_avg_temp", name: "Daily Average Temperature", unit: "°C" },
    { field_id: "daily_peak_humidity", name: "Daily Peak Humidity", unit: "%" },
    { field_id: "daily_avg_humidity", name: "Daily Average Humidity", unit: "%" },
  ],
  solar_sensor: [
    { field_id: "daily_peak_irradiance", name: "Daily Peak Irradiance", unit: "W/m²" },
    { field_id: "daily_avg_irradiance", name: "Daily Average Irradiance", unit: "W/m²" },
  ],
  solar_radiation_sensor: [
    { field_id: "daily_peak_irradiance", name: "Daily Peak Irradiance", unit: "W/m²" },
    { field_id: "daily_avg_irradiance", name: "Daily Average Irradiance", unit: "W/m²" },
  ],
  wind_sensor: [
    { field_id: "daily_peak_wind_speed", name: "Daily Peak Wind Speed", unit: "m/s" },
    { field_id: "daily_avg_wind_speed", name: "Daily Average Wind Speed", unit: "m/s" },
  ],
};

// Calculated field selection for devices
interface CalculatedFieldSelection {
  field_id: string;
  name: string;
  storage_mode: "log" | "viz_only";
}

// Device type
interface Device {
  id: string;
  name: string;
  measurement_type: string | null;  // Device type: inverter, load_meter, dg, sensor, etc.
  protocol: string;
  slave_id: number;
  // TCP fields
  ip_address: string | null;
  port: number | null;
  // RTU Gateway fields
  gateway_ip: string | null;
  gateway_port: number | null;
  // RTU Direct fields
  serial_port: string | null;
  baudrate: number | null;
  // Status
  is_online: boolean;
  last_seen: string | null;
  // Device-specific registers (copied from template, can be customized)
  registers: ModbusRegister[] | null;
  // Device-specific visualization registers (live display only, not logged to DB)
  visualization_registers: ModbusRegister[] | null;
  // Device-specific alarm registers (copied from template, can be customized)
  alarm_registers: ModbusRegister[] | null;
  // Calculated fields for this device
  calculated_fields: CalculatedFieldSelection[] | null;
  // Template sync timestamp
  template_id: string | null;
  template_synced_at: string | null;
  // Logging interval in milliseconds
  logging_interval_ms: number | null;
  // Connection alarm settings (optional - may not exist in older records)
  connection_alarm_enabled?: boolean | null;
  connection_timeout_multiplier?: number | null;
  device_templates: {
    name: string;
    device_type: string;
    brand: string;
    model: string;
  } | null;
}

// Device type labels and colors for display (matches Device Templates)
const deviceTypeConfig: Record<string, { label: string; color: string }> = {
  // Generators
  diesel_generator: { label: "Diesel Generator", color: "bg-slate-900 text-white" },
  gas_generator: { label: "Gas Generator", color: "bg-gray-400 text-gray-900" },
  dg: { label: "Generator", color: "bg-slate-900 text-white" },  // Legacy

  // Solar
  inverter: { label: "Solar Inverter", color: "bg-yellow-100 text-yellow-700" },
  solar_meter: { label: "Solar Meter", color: "bg-amber-100 text-amber-700" },
  solar_sensor: { label: "Solar Sensor", color: "bg-orange-100 text-orange-700" },
  solar_radiation_sensor: { label: "Solar Radiation", color: "bg-orange-100 text-orange-700" },

  // Load
  load: { label: "Load", color: "bg-blue-200 text-blue-800" },
  load_meter: { label: "Energy Meter", color: "bg-blue-200 text-blue-800" },  // Legacy
  subload: { label: "SubLoad", color: "bg-blue-100 text-blue-600" },

  // Fuel
  fuel: { label: "Fuel Sensor", color: "bg-purple-100 text-purple-700" },
  fuel_level_sensor: { label: "Fuel Sensor", color: "bg-purple-100 text-purple-700" },

  // Sensors
  sensor: { label: "Sensor", color: "bg-gray-100 text-gray-700" },
  temperature_humidity_sensor: { label: "Temp/Humidity", color: "bg-green-100 text-green-700" },
  wind_sensor: { label: "Wind Sensor", color: "bg-cyan-100 text-cyan-700" },

  // Other energy systems
  wind_turbine: { label: "Wind Turbine", color: "bg-teal-100 text-teal-700" },
  bess: { label: "Battery Storage", color: "bg-emerald-100 text-emerald-700" },
  capacitor_bank: { label: "Capacitor Bank", color: "bg-indigo-100 text-indigo-700" },

  // Fallback
  other: { label: "Other", color: "bg-gray-100 text-gray-600" },
};

// Latest power readings from control logs (aggregate values)
interface LatestReadings {
  total_load_kw: number;
  solar_output_kw: number;
  solar_limit_pct: number;
  dg_power_kw: number;
  timestamp: string;
}

interface DeviceListProps {
  projectId: string;
  siteId?: string;  // Optional: for sites architecture
  devices: Device[];
  latestReadings?: LatestReadings | null; // Optional: latest power readings
  userRole?: string; // User role for permission checks
}

export function DeviceList({ projectId, siteId, devices: initialDevices, latestReadings, userRole }: DeviceListProps) {
  // Only admins can delete - configurators and viewers cannot
  const canDelete = userRole && !["configurator", "viewer"].includes(userRole);
  const router = useRouter();
  const [devices, setDevices] = useState(initialDevices);

  // Get the display reading for a device based on its type
  // Note: These are aggregate readings (sum of all devices of each type)
  const getDeviceReading = (deviceType: string | undefined) => {
    if (!latestReadings) return null;

    switch (deviceType) {
      case "load_meter":
        return { value: latestReadings.total_load_kw, unit: "kW", label: "Load" };
      case "inverter":
        return {
          value: latestReadings.solar_output_kw,
          unit: "kW",
          label: `Solar (${latestReadings.solar_limit_pct}%)`,
        };
      case "dg":
        return { value: latestReadings.dg_power_kw, unit: "kW", label: "Generator Power" };
      default:
        return null;
    }
  };
  const [editDevice, setEditDevice] = useState<Device | null>(null);
  const [deleteDevice, setDeleteDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(false);

  // Edit form state - Connection tab
  const [editName, setEditName] = useState("");
  const [editProtocol, setEditProtocol] = useState("tcp");
  const [editMeasurementType, setEditMeasurementType] = useState("");
  const [editSlaveId, setEditSlaveId] = useState(1);
  // TCP fields
  const [editIpAddress, setEditIpAddress] = useState("");
  const [editPort, setEditPort] = useState(502);
  // RTU Gateway fields
  const [editGatewayIp, setEditGatewayIp] = useState("");
  const [editGatewayPort, setEditGatewayPort] = useState(502);
  // RTU Direct fields
  const [editSerialPort, setEditSerialPort] = useState("");
  const [editBaudrate, setEditBaudrate] = useState(9600);
  // Connection alarm settings
  const [editConnectionAlarmEnabled, setEditConnectionAlarmEnabled] = useState(true);
  const [editConnectionTimeoutMultiplier, setEditConnectionTimeoutMultiplier] = useState(3.0);

  // Edit form state - Registers tab
  const [editRegisters, setEditRegisters] = useState<ModbusRegister[]>([]);
  const [registerFormOpen, setRegisterFormOpen] = useState(false);
  const [registerFormMode, setRegisterFormMode] = useState<"add" | "edit">("add");
  const [editingRegister, setEditingRegister] = useState<ModbusRegister | undefined>();
  const [editingRegisterIndex, setEditingRegisterIndex] = useState<number>(-1);

  // Edit form state - Alarm Registers tab
  const [editAlarmRegisters, setEditAlarmRegisters] = useState<ModbusRegister[]>([]);
  const [alarmRegisterFormOpen, setAlarmRegisterFormOpen] = useState(false);
  const [alarmRegisterFormMode, setAlarmRegisterFormMode] = useState<"add" | "edit">("add");
  const [editingAlarmRegister, setEditingAlarmRegister] = useState<ModbusRegister | undefined>();
  const [editingAlarmRegisterIndex, setEditingAlarmRegisterIndex] = useState<number>(-1);

  // Edit form state - Visualization Registers tab
  const [editVisualizationRegisters, setEditVisualizationRegisters] = useState<ModbusRegister[]>([]);
  const [vizRegisterFormOpen, setVizRegisterFormOpen] = useState(false);
  const [vizRegisterFormMode, setVizRegisterFormMode] = useState<"add" | "edit">("add");
  const [editingVizRegister, setEditingVizRegister] = useState<ModbusRegister | undefined>();
  const [editingVizRegisterIndex, setEditingVizRegisterIndex] = useState<number>(-1);

  // Edit form state - Calculated Fields tab
  const [editCalculatedFields, setEditCalculatedFields] = useState<CalculatedFieldSelection[]>([]);

  // Open edit dialog
  const openEditDialog = (device: Device) => {
    setEditDevice(device);
    // Basic info
    setEditName(device.name);
    setEditProtocol(device.protocol || "tcp");
    setEditMeasurementType(device.measurement_type || "");
    setEditSlaveId(device.slave_id);
    // TCP fields
    setEditIpAddress(device.ip_address || "");
    setEditPort(device.port || 502);
    // RTU Gateway fields
    setEditGatewayIp(device.gateway_ip || "");
    setEditGatewayPort(device.gateway_port || 502);
    // RTU Direct fields
    setEditSerialPort(device.serial_port || "");
    setEditBaudrate(device.baudrate || 9600);
    // Connection alarm settings
    setEditConnectionAlarmEnabled(device.connection_alarm_enabled ?? true);
    setEditConnectionTimeoutMultiplier(device.connection_timeout_multiplier ?? 3.0);
    // Logging Registers tab - load from device
    setEditRegisters(device.registers || []);
    // Visualization Registers tab - load from device
    setEditVisualizationRegisters(device.visualization_registers || []);
    // Alarm Registers tab - load from device
    setEditAlarmRegisters(device.alarm_registers || []);
    // Calculated Fields tab - load from device
    setEditCalculatedFields(device.calculated_fields || []);
  };

  // Register management functions for editing
  const handleAddRegister = () => {
    setRegisterFormMode("add");
    setEditingRegister(undefined);
    setEditingRegisterIndex(-1);
    setRegisterFormOpen(true);
  };

  const handleEditRegister = (register: ModbusRegister, index: number) => {
    setRegisterFormMode("edit");
    setEditingRegister(register);
    setEditingRegisterIndex(index);
    setRegisterFormOpen(true);
  };

  const handleDeleteRegister = (index: number) => {
    setEditRegisters((prev) => prev.filter((_, i) => i !== index));
    toast.success("Register removed");
  };

  const handleSaveRegister = (register: ModbusRegister) => {
    if (registerFormMode === "edit" && editingRegisterIndex >= 0) {
      // Update existing register
      setEditRegisters((prev) =>
        prev.map((r, i) => (i === editingRegisterIndex ? register : r))
      );
      toast.success("Register updated");
    } else {
      // Add new register (sorted by address)
      setEditRegisters((prev) => [...prev, register].sort((a, b) => a.address - b.address));
      toast.success("Register added");
    }
  };

  // Alarm Register management functions for editing
  const handleAddAlarmRegister = () => {
    setAlarmRegisterFormMode("add");
    setEditingAlarmRegister(undefined);
    setEditingAlarmRegisterIndex(-1);
    setAlarmRegisterFormOpen(true);
  };

  const handleEditAlarmRegister = (register: ModbusRegister, index: number) => {
    setAlarmRegisterFormMode("edit");
    setEditingAlarmRegister(register);
    setEditingAlarmRegisterIndex(index);
    setAlarmRegisterFormOpen(true);
  };

  const handleDeleteAlarmRegister = (index: number) => {
    setEditAlarmRegisters((prev) => prev.filter((_, i) => i !== index));
    toast.success("Alarm register removed");
  };

  const handleSaveAlarmRegister = (register: ModbusRegister) => {
    if (alarmRegisterFormMode === "edit" && editingAlarmRegisterIndex >= 0) {
      // Update existing alarm register
      setEditAlarmRegisters((prev) =>
        prev.map((r, i) => (i === editingAlarmRegisterIndex ? register : r))
      );
      toast.success("Alarm register updated");
    } else {
      // Add new alarm register (sorted by address)
      setEditAlarmRegisters((prev) => [...prev, register].sort((a, b) => a.address - b.address));
      toast.success("Alarm register added");
    }
  };

  // Visualization Register management functions
  const handleAddVizRegister = () => {
    setVizRegisterFormMode("add");
    setEditingVizRegister(undefined);
    setEditingVizRegisterIndex(-1);
    setVizRegisterFormOpen(true);
  };

  const handleEditVizRegister = (register: ModbusRegister, index: number) => {
    setVizRegisterFormMode("edit");
    setEditingVizRegister(register);
    setEditingVizRegisterIndex(index);
    setVizRegisterFormOpen(true);
  };

  const handleDeleteVizRegister = (index: number) => {
    setEditVisualizationRegisters((prev) => prev.filter((_, i) => i !== index));
    toast.success("Visualization register removed");
  };

  const handleSaveVizRegister = (register: ModbusRegister) => {
    if (vizRegisterFormMode === "edit" && editingVizRegisterIndex >= 0) {
      // Update existing visualization register
      setEditVisualizationRegisters((prev) =>
        prev.map((r, i) => (i === editingVizRegisterIndex ? register : r))
      );
      toast.success("Visualization register updated");
    } else {
      // Add new visualization register (sorted by address)
      setEditVisualizationRegisters((prev) => [...prev, register].sort((a, b) => a.address - b.address));
      toast.success("Visualization register added");
    }
  };

  // Calculated field management functions
  const handleToggleCalculatedField = (fieldId: string, fieldName: string) => {
    setEditCalculatedFields((prev) => {
      const existing = prev.find((f) => f.field_id === fieldId);
      if (existing) {
        // Remove field
        return prev.filter((f) => f.field_id !== fieldId);
      } else {
        // Add field
        return [...prev, { field_id: fieldId, name: fieldName, storage_mode: "log" as const }];
      }
    });
  };

  const handleChangeFieldStorageMode = (fieldId: string, mode: "log" | "viz_only") => {
    setEditCalculatedFields((prev) =>
      prev.map((f) => (f.field_id === fieldId ? { ...f, storage_mode: mode } : f))
    );
  };

  // Check for Modbus address conflicts when editing
  // Uses editProtocol (the selected protocol) to check conflicts with other devices
  const checkEditConflicts = async (): Promise<string | null> => {
    if (!editDevice) return null;

    // Check other devices in the same project for conflicts
    for (const device of devices) {
      // Skip the device being edited
      if (device.id === editDevice.id) continue;

      if (editProtocol === "tcp" && device.protocol === "tcp") {
        // TCP: Check IP + Port + Slave ID
        if (
          device.ip_address === editIpAddress.trim() &&
          device.port === editPort &&
          device.slave_id === editSlaveId
        ) {
          return `Conflict: Device "${device.name}" already uses IP ${device.ip_address}:${device.port} with Slave ID ${device.slave_id}`;
        }
      } else if (editProtocol === "rtu_gateway" && device.protocol === "rtu_gateway") {
        // RTU Gateway: Check Gateway IP + Port + Slave ID
        if (
          device.gateway_ip === editGatewayIp.trim() &&
          device.gateway_port === editGatewayPort &&
          device.slave_id === editSlaveId
        ) {
          return `Conflict: Device "${device.name}" already uses Gateway ${device.gateway_ip}:${device.gateway_port} with Slave ID ${device.slave_id}`;
        }
      } else if (editProtocol === "rtu_direct" && device.protocol === "rtu_direct") {
        // RTU Direct: Check Serial Port + Slave ID
        if (
          device.serial_port === editSerialPort.trim() &&
          device.slave_id === editSlaveId
        ) {
          return `Conflict: Device "${device.name}" already uses ${device.serial_port} with Slave ID ${device.slave_id}`;
        }
      }
    }

    return null; // No conflicts
  };

  // Handle edit submit
  const handleEditSubmit = async () => {
    if (!editDevice) return;
    setLoading(true);

    // Check for Modbus address conflicts
    const conflictError = await checkEditConflicts();
    if (conflictError) {
      toast.error(conflictError);
      setLoading(false);
      return;
    }

    const supabase = createClient();

    // Prepare update data based on selected protocol
    // Note: logging frequency is now per-register (stored in the registers array)
    const updateData: Record<string, unknown> = {
      name: editName.trim(),
      protocol: editProtocol,
      measurement_type: editMeasurementType || null,
      slave_id: editSlaveId,
      registers: editRegisters.length > 0 ? editRegisters : null,
      visualization_registers: editVisualizationRegisters.length > 0 ? editVisualizationRegisters : null,
      alarm_registers: editAlarmRegisters.length > 0 ? editAlarmRegisters : null,
      calculated_fields: editCalculatedFields.length > 0 ? editCalculatedFields : null,
      // Connection alarm settings
      connection_alarm_enabled: editConnectionAlarmEnabled,
      connection_timeout_multiplier: editConnectionTimeoutMultiplier,
      // Clear all protocol-specific fields first, then set the right ones
      ip_address: null,
      port: null,
      gateway_ip: null,
      gateway_port: null,
      serial_port: null,
      baudrate: null,
    };

    // Set protocol-specific fields based on selected protocol
    if (editProtocol === "tcp") {
      updateData.ip_address = editIpAddress.trim();
      updateData.port = editPort;
    } else if (editProtocol === "rtu_gateway") {
      updateData.gateway_ip = editGatewayIp.trim();
      updateData.gateway_port = editGatewayPort;
    } else if (editProtocol === "rtu_direct") {
      updateData.serial_port = editSerialPort.trim();
      updateData.baudrate = editBaudrate;
    }

    const { error } = await supabase
      .from("site_devices")
      .update(updateData)
      .eq("id", editDevice.id);

    if (error) {
      console.error("Error updating device:", error);
      toast.error("Failed to update device");
    } else {
      // Also update site's updated_at to trigger config sync detection
      if (siteId) {
        await supabase
          .from("sites")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", siteId);
      }

      toast.success("Device updated successfully");

      // Update local state
      setDevices(devices.map((d) =>
        d.id === editDevice.id
          ? { ...d, ...updateData } as Device
          : d
      ));

      // Dispatch event to notify sync status component to refresh
      window.dispatchEvent(new CustomEvent("device-config-changed"));
    }

    setLoading(false);
    setEditDevice(null);
  };

  // Handle delete
  const handleDelete = async () => {
    if (!deleteDevice) return;
    setLoading(true);

    const supabase = createClient();

    // Soft delete by setting enabled to false
    const { error } = await supabase
      .from("site_devices")
      .update({ enabled: false })
      .eq("id", deleteDevice.id);

    if (error) {
      console.error("Error deleting device:", error);
      toast.error("Failed to delete device");
    } else {
      // Also update site's updated_at to trigger config sync detection
      if (siteId) {
        await supabase
          .from("sites")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", siteId);
      }

      toast.success("Device removed successfully");

      // Remove from local state
      setDevices(devices.filter((d) => d.id !== deleteDevice.id));

      // Dispatch event to notify sync status component to refresh
      window.dispatchEvent(new CustomEvent("device-config-changed"));
    }

    setLoading(false);
    setDeleteDevice(null);
  };

  // Group devices by device type (matches Device Templates)
  const devicesByType = devices.reduce(
    (acc, device) => {
      const type = device.measurement_type || "unknown";
      if (!acc[type]) acc[type] = [];
      acc[type].push(device);
      return acc;
    },
    {} as Record<string, Device[]>
  );

  // Type configurations for device types (matches Device Templates)
  const typeConfigs: Record<string, { title: string; description: string }> = {
    // Generators
    diesel_generator: { title: "Diesel Generator", description: "Devices in this category" },
    gas_generator: { title: "Gas Generator", description: "Devices in this category" },
    dg: { title: "Generator Controllers", description: "Generator control and monitoring" },

    // Solar
    inverter: { title: "Solar Inverters", description: "PV power conversion" },
    solar_meter: { title: "Solar Meters", description: "Solar energy metering" },
    solar_sensor: { title: "Solar Sensors", description: "Irradiance measurement" },
    solar_radiation_sensor: { title: "Solar Radiation Sensors", description: "Irradiance measurement" },

    // Load
    load: { title: "Load Meters", description: "Main load measurement" },
    load_meter: { title: "Energy Meters", description: "Load measurement devices" },
    subload: { title: "SubLoad Meters", description: "Sub load measurement" },

    // Fuel
    fuel: { title: "Fuel Sensors", description: "Fuel tank monitoring" },
    fuel_level_sensor: { title: "Fuel Level Sensors", description: "Fuel tank monitoring" },

    // Sensors
    sensor: { title: "Sensors (Generic)", description: "Generic sensor devices" },
    temperature_humidity_sensor: { title: "Temp & Humidity Sensors", description: "Environmental monitoring" },
    wind_sensor: { title: "Wind Sensors", description: "Wind speed and direction" },

    // Other energy systems
    wind_turbine: { title: "Wind Turbines", description: "Wind turbine power generation" },
    bess: { title: "Battery Storage", description: "Battery energy storage systems" },
    capacitor_bank: { title: "Capacitor Banks", description: "Reactive power compensation" },

    // Fallback
    other: { title: "Other Devices", description: "Other device types" },
    unknown: { title: "Other Devices", description: "Devices without type specified" },
  };

  // Device card component - MOBILE-FRIENDLY with 44px touch targets
  const DeviceCard = ({ device }: { device: Device }) => {
    const reading = getDeviceReading(device.device_templates?.device_type);

    return (
      <div className="flex flex-col gap-3 p-3 rounded-lg bg-muted/50 sm:flex-row sm:items-center sm:justify-between">
        {/* Device info */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Status indicator - green pulse when online, gray when offline */}
          <div className="flex-shrink-0" title={device.is_online ? "Online" : `Last seen: ${formatLastSeen(device.last_seen)}`}>
            {device.is_online ? (
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
            ) : (
              <span className="relative flex h-3 w-3">
                <span className="relative inline-flex rounded-full h-3 w-3 bg-gray-400"></span>
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium truncate">{device.name}</p>
              {/* Online status badge - only show for online devices (offline indicated by gray circle) */}
              {device.is_online && (
                <Badge variant="outline" className="flex-shrink-0 text-xs bg-green-50 text-green-700 border-green-200">
                  Online
                </Badge>
              )}
              {/* Device type badge - matches Device Templates */}
              {device.measurement_type && deviceTypeConfig[device.measurement_type] && (
                <Badge
                  variant="outline"
                  className={`flex-shrink-0 text-xs ${deviceTypeConfig[device.measurement_type].color}`}
                >
                  {deviceTypeConfig[device.measurement_type].label}
                </Badge>
              )}
              {/* Show reading badge if available and device is online */}
              {reading && device.is_online && (
                <Badge variant="outline" className="flex-shrink-0 text-xs font-mono">
                  {reading.value.toFixed(1)} {reading.unit}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate">
              {device.device_templates?.brand} {device.device_templates?.model}
            </p>
            {/* Protocol, Slave ID, and IP shown on mobile */}
            <p className="text-xs text-muted-foreground sm:hidden">
              {device.protocol === "tcp" && "TCP"}
              {device.protocol === "rtu_gateway" && "RTU Gateway"}
              {device.protocol === "rtu_direct" && "RTU Direct"}
              {" | "}Slave ID: {device.slave_id}
              {device.protocol === "tcp" && device.ip_address && ` | ${device.ip_address}:${device.port || 502}`}
              {device.protocol === "rtu_gateway" && device.gateway_ip && ` | ${device.gateway_ip}:${device.gateway_port || 502}`}
            </p>
          </div>
        </div>
        {/* Actions - 44px touch targets */}
        <div className="flex items-center gap-2 justify-end">
          <span className="text-sm text-muted-foreground mr-2 hidden sm:inline">
            {device.protocol === "tcp" && "TCP"}
            {device.protocol === "rtu_gateway" && "RTU Gateway"}
            {device.protocol === "rtu_direct" && "RTU Direct"}
            {" | "}Slave ID: {device.slave_id}
            {device.protocol === "tcp" && device.ip_address && ` | ${device.ip_address}:${device.port || 502}`}
            {device.protocol === "rtu_gateway" && device.gateway_ip && ` | ${device.gateway_ip}:${device.gateway_port || 502}`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openEditDialog(device)}
            className="min-w-[44px] min-h-[44px]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </Button>
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteDevice(device)}
              className="min-w-[44px] min-h-[44px]"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-red-500">
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </Button>
          )}
        </div>
      </div>
    );
  };

  // Define display order for device types
  const typeOrder = [
    // Load first
    "load", "load_meter", "subload",
    // Then solar
    "inverter", "solar_meter", "solar_sensor", "solar_radiation_sensor",
    // Then generators
    "diesel_generator", "gas_generator", "dg",
    // Then other energy systems
    "wind_turbine", "bess", "capacitor_bank",
    // Then sensors
    "fuel", "fuel_level_sensor", "temperature_humidity_sensor", "wind_sensor", "sensor",
    // Finally other/unknown
    "other", "unknown"
  ];

  return (
    <>
      {/* Render device groups in order */}
      {typeOrder
        .filter((type) => devicesByType[type] && devicesByType[type].length > 0)
        .map((type) => (
          <Card key={type}>
            <CardHeader>
              <CardTitle className="text-lg">
                {typeConfigs[type]?.title || type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
              </CardTitle>
              <CardDescription>
                {typeConfigs[type]?.description || "Devices in this category"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {devicesByType[type].map((device) => (
                  <DeviceCard key={device.id} device={device} />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}

      {/* Render any other device types not in typeOrder */}
      {Object.entries(devicesByType)
        .filter(([type]) => !typeOrder.includes(type))
        .map(([type, typeDevices]) => (
          <Card key={type}>
            <CardHeader>
              <CardTitle className="text-lg">
                {typeConfigs[type]?.title || type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
              </CardTitle>
              <CardDescription>
                {typeConfigs[type]?.description || "Devices in this category"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {typeDevices.map((device) => (
                  <DeviceCard key={device.id} device={device} />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}

      {/* No devices message */}
      {devices.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-4">No devices configured</p>
            <Button variant="outline" asChild>
              <Link href={siteId
                ? `/projects/${projectId}/sites/${siteId}/devices/new`
                : `/projects/${projectId}/devices/new`
              }>Add Device</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Add device button */}
      {devices.length > 0 && (
        <div className="flex justify-end">
          <Button asChild>
            <Link href={siteId
              ? `/projects/${projectId}/sites/${siteId}/devices/new`
              : `/projects/${projectId}/devices/new`
            }>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-2">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
              Add Device
            </Link>
          </Button>
        </div>
      )}

      {/* Edit Dialog - MOBILE-FRIENDLY with Tabs */}
      <Dialog open={!!editDevice} onOpenChange={() => setEditDevice(null)}>
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Device: {editDevice?.name}</DialogTitle>
            <DialogDescription>
              {editDevice?.device_templates?.brand} {editDevice?.device_templates?.model}
            </DialogDescription>
            {/* Protocol badge - shows connection type */}
            {editDevice && (
              <div className="pt-2">
                <Badge variant="outline" className="bg-slate-100 text-slate-700">
                  {editDevice.protocol === "tcp"
                    ? "Modbus TCP"
                    : editDevice.protocol === "rtu_gateway"
                    ? "RTU Gateway"
                    : "RTU Direct"}
                </Badge>
              </div>
            )}
          </DialogHeader>

          {/* Tabbed Interface - 5 tabs: Connection, Logging, Visualization, Alarms, Calculated */}
          {/* Matches device template structure for easy sync */}
          <Tabs defaultValue="connection" className="w-full">
            <TabsList className="w-full grid grid-cols-5">
              <TabsTrigger value="connection" className="text-xs sm:text-sm">Connection</TabsTrigger>
              <TabsTrigger value="logging" className="text-xs sm:text-sm">Logging</TabsTrigger>
              <TabsTrigger value="visualization" className="text-xs sm:text-sm">Visualization</TabsTrigger>
              <TabsTrigger value="alarms" className="text-xs sm:text-sm">Alarms</TabsTrigger>
              <TabsTrigger value="calculated" className="text-xs sm:text-sm">Calculated</TabsTrigger>
            </TabsList>

            {/* Connection Tab */}
            <TabsContent value="connection" className="space-y-4 py-4">
              {/* Device Name */}
              <div className="space-y-2">
                <Label htmlFor="edit-name">Device Name</Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="min-h-[44px]"
                />
              </div>

              {/* Device Type - matches Device Templates for consistency */}
              <div className="space-y-2">
                <Label htmlFor="edit-device-type">Device Type</Label>
                <select
                  id="edit-device-type"
                  value={editMeasurementType}
                  onChange={(e) => setEditMeasurementType(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
                >
                  <option value="">Select device type...</option>
                  {deviceTypes.map((dt) => (
                    <option key={dt.value} value={dt.value}>
                      {dt.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Used for control logic and calculated fields
                </p>
              </div>

              {/* Protocol Selection */}
              <div className="space-y-2">
                <Label htmlFor="edit-protocol">Protocol</Label>
                <select
                  id="edit-protocol"
                  value={editProtocol}
                  onChange={(e) => setEditProtocol(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
                >
                  {protocols.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {protocols.find((p) => p.value === editProtocol)?.description}
                </p>
              </div>

              {/* Slave ID - common to all protocols */}
              <div className="space-y-2">
                <Label htmlFor="edit-slave-id">Slave ID</Label>
                <Input
                  id="edit-slave-id"
                  type="number"
                  min={1}
                  max={247}
                  value={editSlaveId}
                  onChange={(e) => setEditSlaveId(parseInt(e.target.value))}
                  className="min-h-[44px]"
                />
                <p className="text-xs text-muted-foreground">
                  Modbus device address (1-247)
                </p>
              </div>

              {/* TCP Fields - shown when protocol is tcp */}
              {editProtocol === "tcp" && (
                <div className="space-y-4 pl-4 border-l-2 border-muted">
                  <div className="space-y-2">
                    <Label htmlFor="edit-ip">IP Address</Label>
                    <Input
                      id="edit-ip"
                      value={editIpAddress}
                      onChange={(e) => setEditIpAddress(e.target.value)}
                      placeholder="192.168.1.30"
                      className="min-h-[44px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-port">Port</Label>
                    <Input
                      id="edit-port"
                      type="number"
                      value={editPort}
                      onChange={(e) => setEditPort(parseInt(e.target.value))}
                      className="min-h-[44px]"
                    />
                  </div>
                </div>
              )}

              {/* RTU Gateway Fields - shown when protocol is rtu_gateway */}
              {editProtocol === "rtu_gateway" && (
                <div className="space-y-4 pl-4 border-l-2 border-muted">
                  <div className="space-y-2">
                    <Label htmlFor="edit-gateway-ip">Gateway IP</Label>
                    <Input
                      id="edit-gateway-ip"
                      value={editGatewayIp}
                      onChange={(e) => setEditGatewayIp(e.target.value)}
                      placeholder="192.168.1.1"
                      className="min-h-[44px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-gateway-port">Gateway Port</Label>
                    <Input
                      id="edit-gateway-port"
                      type="number"
                      value={editGatewayPort}
                      onChange={(e) => setEditGatewayPort(parseInt(e.target.value))}
                      className="min-h-[44px]"
                    />
                  </div>
                </div>
              )}

              {/* RTU Direct Fields - shown when protocol is rtu_direct */}
              {editProtocol === "rtu_direct" && (
                <div className="space-y-4 pl-4 border-l-2 border-muted">
                  <div className="space-y-2">
                    <Label htmlFor="edit-serial-port">Serial Port</Label>
                    <Input
                      id="edit-serial-port"
                      value={editSerialPort}
                      onChange={(e) => setEditSerialPort(e.target.value)}
                      placeholder="/dev/ttyUSB0"
                      className="min-h-[44px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-baudrate">Baudrate</Label>
                    <select
                      id="edit-baudrate"
                      value={editBaudrate}
                      onChange={(e) => setEditBaudrate(parseInt(e.target.value))}
                      className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
                    >
                      <option value={9600}>9600</option>
                      <option value={19200}>19200</option>
                      <option value={38400}>38400</option>
                      <option value={57600}>57600</option>
                      <option value={115200}>115200</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Connection Alarm Section */}
              <div className="space-y-4 pt-4 border-t">
                <div>
                  <p className="text-sm font-medium">Connection Alarm</p>
                  <p className="text-xs text-muted-foreground">
                    Trigger alarm when device stops responding
                  </p>
                </div>

                {/* Enable/disable toggle */}
                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-connection-alarm" className="cursor-pointer">
                    Enable connection alarm
                  </Label>
                  <input
                    type="checkbox"
                    id="edit-connection-alarm"
                    checked={editConnectionAlarmEnabled}
                    onChange={(e) => setEditConnectionAlarmEnabled(e.target.checked)}
                    className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                </div>

                {/* Timeout multiplier - only shown when alarm is enabled */}
                {editConnectionAlarmEnabled && (
                  <div className="space-y-2 pl-4 border-l-2 border-muted">
                    <Label htmlFor="edit-timeout-multiplier">Timeout Multiplier</Label>
                    <Input
                      id="edit-timeout-multiplier"
                      type="number"
                      step="0.5"
                      min="2"
                      max="10"
                      value={editConnectionTimeoutMultiplier}
                      onChange={(e) => setEditConnectionTimeoutMultiplier(parseFloat(e.target.value) || 3.0)}
                      className="min-h-[44px]"
                    />
                    <p className="text-xs text-muted-foreground">
                      Timeout = lowest register logging frequency × {editConnectionTimeoutMultiplier}
                    </p>
                    {/* Show calculated timeout based on registers */}
                    {editRegisters.length > 0 && (
                      <p className="text-xs font-medium text-blue-600">
                        Calculated timeout:{" "}
                        {(() => {
                          const minFreq = Math.min(
                            ...editRegisters
                              .map((r) => r.logging_frequency || 60)
                              .filter((f) => f > 0)
                          );
                          const timeout = minFreq * editConnectionTimeoutMultiplier;
                          // Format based on value
                          if (timeout < 1) return `${(timeout * 1000).toFixed(0)}ms`;
                          if (timeout < 60) return `${timeout % 1 === 0 ? timeout.toFixed(0) : timeout.toFixed(1)}s`;
                          if (timeout < 3600) return `${(timeout / 60).toFixed(1)} min`;
                          return `${(timeout / 3600).toFixed(1)}h`;
                        })()}
                        {" "}(min freq: {Math.min(...editRegisters.map((r) => r.logging_frequency || 60).filter((f) => f > 0))}s)
                      </p>
                    )}
                    {editRegisters.length === 0 && (
                      <p className="text-xs text-amber-600">
                        Add logging registers to see calculated timeout
                      </p>
                    )}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Logging Tab - Registers stored in DB */}
            <TabsContent value="logging" className="space-y-4 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Logging Registers</p>
                  <p className="text-xs text-muted-foreground">
                    Registers stored in database for historical data and control logic
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddRegister}
                  className="min-h-[36px]"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-1">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add Register
                </Button>
              </div>

              {/* Registers Table */}
              {editRegisters.length > 0 ? (
                <div className="border rounded-md overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Addr</th>
                          <th className="px-3 py-2 text-left font-medium">Name</th>
                          <th className="px-3 py-2 text-left font-medium">Type</th>
                          <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Datatype</th>
                          <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">Logging</th>
                          <th className="px-3 py-2 text-right font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {editRegisters.map((reg, index) => (
                          <tr key={index} className="hover:bg-muted/30">
                            <td className="px-3 py-2 font-mono text-xs">{reg.address}</td>
                            <td className="px-3 py-2 font-mono text-xs">{reg.name}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                reg.type === "holding" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                              }`}>
                                {reg.type}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground hidden md:table-cell">{reg.datatype}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground hidden lg:table-cell">
                              {formatLoggingFrequency(reg.logging_frequency)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleEditRegister(reg, index)}
                                  className="p-1.5 rounded hover:bg-muted transition-colors"
                                  title="Edit register"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted-foreground">
                                    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                                    <path d="m15 5 4 4"/>
                                  </svg>
                                </button>
                                {canDelete && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteRegister(index)}
                                    className="p-1.5 rounded hover:bg-red-100 transition-colors"
                                    title="Delete register"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-red-500">
                                      <path d="M3 6h18"/>
                                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                                    </svg>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="border rounded-md p-6 text-center text-muted-foreground">
                  <p className="text-sm">No registers configured for this device.</p>
                  <p className="text-xs mt-1">Click &quot;Add Register&quot; to define Modbus registers.</p>
                </div>
              )}
            </TabsContent>

            {/* Visualization Tab - Registers for live display only */}
            <TabsContent value="visualization" className="space-y-4 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Visualization Registers</p>
                  <p className="text-xs text-muted-foreground">
                    Registers for live display only (not stored in database)
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddVizRegister}
                  className="min-h-[36px]"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-1">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add Register
                </Button>
              </div>

              {/* Visualization Registers Table */}
              {editVisualizationRegisters.length > 0 ? (
                <div className="border rounded-md overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Addr</th>
                          <th className="px-3 py-2 text-left font-medium">Name</th>
                          <th className="px-3 py-2 text-left font-medium">Type</th>
                          <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Datatype</th>
                          <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">Unit</th>
                          <th className="px-3 py-2 text-right font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {editVisualizationRegisters.map((reg, index) => (
                          <tr key={index} className="hover:bg-muted/30">
                            <td className="px-3 py-2 font-mono text-xs">{reg.address}</td>
                            <td className="px-3 py-2 font-mono text-xs">{reg.name}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                reg.type === "holding" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                              }`}>
                                {reg.type}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground hidden md:table-cell">{reg.datatype}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground hidden lg:table-cell">{reg.unit || "-"}</td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleEditVizRegister(reg, index)}
                                  className="p-1.5 rounded hover:bg-muted transition-colors"
                                  title="Edit register"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted-foreground">
                                    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                                    <path d="m15 5 4 4"/>
                                  </svg>
                                </button>
                                {canDelete && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteVizRegister(index)}
                                    className="p-1.5 rounded hover:bg-red-100 transition-colors"
                                    title="Delete register"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-red-500">
                                      <path d="M3 6h18"/>
                                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                                    </svg>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="border rounded-md p-6 text-center text-muted-foreground">
                  <p className="text-sm">No visualization registers configured.</p>
                  <p className="text-xs mt-1">These registers are for live display only and are not stored in the database.</p>
                </div>
              )}
            </TabsContent>

            {/* Alarms Tab */}
            <TabsContent value="alarms" className="space-y-4 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Alarm Registers</p>
                  <p className="text-xs text-muted-foreground">
                    Event-based alarms with threshold conditions
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddAlarmRegister}
                  className="min-h-[36px]"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-1">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add Alarm Register
                </Button>
              </div>

              {/* Alarm Registers Table */}
              {editAlarmRegisters.length > 0 ? (
                <div className="border rounded-md overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Addr</th>
                          <th className="px-3 py-2 text-left font-medium">Name</th>
                          <th className="px-3 py-2 text-left font-medium">Type</th>
                          <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Datatype</th>
                          <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">Thresholds</th>
                          <th className="px-3 py-2 text-right font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {editAlarmRegisters.map((reg, index) => (
                          <tr key={index} className="hover:bg-muted/30">
                            <td className="px-3 py-2 font-mono text-xs">{reg.address}</td>
                            <td className="px-3 py-2 font-mono text-xs">{reg.name}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                reg.type === "holding" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                              }`}>
                                {reg.type}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground hidden md:table-cell">{reg.datatype}</td>
                            <td className="px-3 py-2 hidden lg:table-cell">
                              {reg.thresholds && reg.thresholds.length > 0 ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                  {reg.thresholds.length} configured
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">None</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleEditAlarmRegister(reg, index)}
                                  className="p-1.5 rounded hover:bg-muted transition-colors"
                                  title="Edit alarm register"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted-foreground">
                                    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                                    <path d="m15 5 4 4"/>
                                  </svg>
                                </button>
                                {canDelete && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteAlarmRegister(index)}
                                    className="p-1.5 rounded hover:bg-red-100 transition-colors"
                                    title="Delete alarm register"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-red-500">
                                      <path d="M3 6h18"/>
                                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                                    </svg>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="border rounded-md p-6 text-center text-muted-foreground">
                  <p className="text-sm">No alarm registers configured for this device.</p>
                  <p className="text-xs mt-1">Click &quot;Add Alarm Register&quot; to define alarm-specific registers.</p>
                </div>
              )}
            </TabsContent>

            {/* Calculated Tab - Derived values */}
            <TabsContent value="calculated" className="space-y-4 py-4">
              <div>
                <p className="text-sm font-medium">Calculated Fields</p>
                <p className="text-xs text-muted-foreground">
                  Select calculated fields for this device. These are derived from register values.
                </p>
              </div>

              {/* Calculated fields list - show all available fields with checkboxes */}
              {(() => {
                const deviceType = editMeasurementType || editDevice?.measurement_type || "";
                const availableFields = CALCULATED_FIELDS_BY_TYPE[deviceType] || [];

                if (availableFields.length > 0) {
                  return (
                    <div className="border rounded-md divide-y">
                      {availableFields.map((field) => {
                        const isSelected = editCalculatedFields.some((f) => f.field_id === field.field_id);
                        const selectedField = editCalculatedFields.find((f) => f.field_id === field.field_id);
                        return (
                          <div key={field.field_id} className="flex items-center justify-between p-3 hover:bg-muted/30">
                            <div className="flex items-center gap-3">
                              <Checkbox
                                id={`calc-${field.field_id}`}
                                checked={isSelected}
                                onCheckedChange={() => handleToggleCalculatedField(field.field_id, field.name)}
                              />
                              <label htmlFor={`calc-${field.field_id}`} className="text-sm cursor-pointer">
                                <span className="font-medium">{field.name}</span>
                                <span className="text-xs text-muted-foreground ml-2">({field.unit})</span>
                              </label>
                            </div>
                            {isSelected && (
                              <Select
                                value={selectedField?.storage_mode || "log"}
                                onValueChange={(value) => handleChangeFieldStorageMode(field.field_id, value as "log" | "viz_only")}
                              >
                                <SelectTrigger className="w-[110px] h-8">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="log">Log to DB</SelectItem>
                                  <SelectItem value="viz_only">Viz Only</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                } else {
                  return (
                    <div className="border rounded-md p-6 text-center text-muted-foreground">
                      <p className="text-sm">No calculated fields available for this device type.</p>
                      <p className="text-xs mt-1">
                        {deviceType
                          ? `Device type "${deviceType}" does not have predefined calculated fields.`
                          : "Select a device type in the Connection tab to see available calculated fields."}
                      </p>
                    </div>
                  );
                }
              })()}

              {/* Info about template sync */}
              {editDevice?.template_id && (
                <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
                  <p>
                    This device is linked to a template. Use the &quot;Synchronize configuration&quot; button on the site page to sync calculated fields from the template.
                  </p>
                  {editDevice.template_synced_at && (
                    <p className="mt-1">
                      Last synced: {new Date(editDevice.template_synced_at).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setEditDevice(null)} className="min-h-[44px] w-full sm:w-auto">
              Cancel
            </Button>
            <Button onClick={handleEditSubmit} disabled={loading} className="min-h-[44px] w-full sm:w-auto">
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Register Form Dialog (nested) - for adding/editing registers */}
      <RegisterForm
        mode={registerFormMode}
        register={editingRegister}
        existingRegisters={editRegisters}
        open={registerFormOpen}
        onOpenChange={setRegisterFormOpen}
        onSave={handleSaveRegister}
      />

      {/* Alarm Register Form Dialog (nested) - for adding/editing alarm registers */}
      <RegisterForm
        mode={alarmRegisterFormMode}
        register={editingAlarmRegister}
        existingRegisters={editAlarmRegisters}
        open={alarmRegisterFormOpen}
        onOpenChange={setAlarmRegisterFormOpen}
        onSave={handleSaveAlarmRegister}
        isAlarmRegister={true}
      />

      {/* Visualization Register Form Dialog (nested) - for adding/editing visualization registers */}
      <RegisterForm
        mode={vizRegisterFormMode}
        register={editingVizRegister}
        existingRegisters={editVisualizationRegisters}
        open={vizRegisterFormOpen}
        onOpenChange={setVizRegisterFormOpen}
        onSave={handleSaveVizRegister}
        isVisualizationRegister={true}
      />

      {/* Delete Confirmation Dialog - MOBILE-FRIENDLY & COMPACT */}
      <AlertDialog open={!!deleteDevice} onOpenChange={() => setDeleteDevice(null)}>
        <AlertDialogContent className="mx-4 max-w-sm sm:max-w-md">
          <AlertDialogHeader className="text-center sm:text-left">
            <div className="mx-auto sm:mx-0 mb-4 h-12 w-12 rounded-full bg-red-100 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-red-600">
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </div>
            <AlertDialogTitle>Delete Device?</AlertDialogTitle>
            <AlertDialogDescription className="text-center sm:text-left">
              Remove <span className="font-medium text-foreground">&ldquo;{deleteDevice?.name}&rdquo;</span> from this project? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 min-h-[44px]"
            >
              {loading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
