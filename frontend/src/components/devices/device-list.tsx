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

// Measurement type options - what the device measures for control logic
const measurementTypes = [
  { value: "load", label: "Load (Main)", description: "Primary site load measurement" },
  { value: "sub_load", label: "Sub-load", description: "Secondary/partial load measurement" },
  { value: "solar", label: "Solar", description: "Solar inverter output" },
  { value: "generator", label: "Generator", description: "Power generator output" },
  { value: "fuel", label: "Fuel", description: "Fuel consumption or level" },
];

// Device type
interface Device {
  id: string;
  name: string;
  measurement_type: string | null;  // What the device measures: load, sub_load, solar, generator, fuel
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
  // Logging interval in milliseconds
  logging_interval_ms: number | null;
  device_templates: {
    name: string;
    device_type: string;
    brand: string;
    model: string;
  } | null;
}

// Measurement type labels and colors for display
// Colors: Yellow=Solar, Blue=Load/Sub-load, Black=Generator, Purple=Fuel
const measurementTypeConfig: Record<string, { label: string; color: string }> = {
  load: { label: "Load", color: "bg-blue-100 text-blue-700" },
  sub_load: { label: "Sub-load", color: "bg-blue-100 text-blue-700" },
  solar: { label: "Solar", color: "bg-yellow-100 text-yellow-700" },
  generator: { label: "Generator", color: "bg-slate-200 text-slate-800" },
  fuel: { label: "Fuel", color: "bg-purple-100 text-purple-700" },
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
}

export function DeviceList({ projectId, siteId, devices: initialDevices, latestReadings }: DeviceListProps) {
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
        return { value: latestReadings.dg_power_kw, unit: "kW", label: "DG Power" };
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

  // Edit form state - Registers tab
  const [editRegisters, setEditRegisters] = useState<ModbusRegister[]>([]);
  const [registerFormOpen, setRegisterFormOpen] = useState(false);
  const [registerFormMode, setRegisterFormMode] = useState<"add" | "edit">("add");
  const [editingRegister, setEditingRegister] = useState<ModbusRegister | undefined>();
  const [editingRegisterIndex, setEditingRegisterIndex] = useState<number>(-1);

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
    // Registers tab - load from device
    setEditRegisters(device.registers || []);
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
      .from("project_devices")
      .update(updateData)
      .eq("id", editDevice.id);

    if (error) {
      console.error("Error updating device:", error);
      toast.error("Failed to update device");
    } else {
      toast.success("Device updated successfully");

      // Update local state
      setDevices(devices.map((d) =>
        d.id === editDevice.id
          ? { ...d, ...updateData } as Device
          : d
      ));
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
      .from("project_devices")
      .update({ enabled: false })
      .eq("id", deleteDevice.id);

    if (error) {
      console.error("Error deleting device:", error);
      toast.error("Failed to delete device");
    } else {
      toast.success("Device removed successfully");

      // Remove from local state
      setDevices(devices.filter((d) => d.id !== deleteDevice.id));
    }

    setLoading(false);
    setDeleteDevice(null);
  };

  // Group devices by type
  const devicesByType = devices.reduce(
    (acc, device) => {
      const type = device.device_templates?.device_type || "unknown";
      if (!acc[type]) acc[type] = [];
      acc[type].push(device);
      return acc;
    },
    {} as Record<string, Device[]>
  );

  // Type configurations
  const typeConfigs: Record<string, { title: string; description: string }> = {
    load_meter: { title: "Energy Meters", description: "Power measurement devices" },
    inverter: { title: "Solar Inverters", description: "PV power conversion" },
    dg: { title: "Power Generators", description: "Generator controllers" },
    unknown: { title: "Other Devices", description: "Uncategorized devices" },
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
              {/* Online/Offline status badge */}
              {device.is_online ? (
                <Badge variant="outline" className="flex-shrink-0 text-xs bg-green-50 text-green-700 border-green-200">
                  Online
                </Badge>
              ) : (
                <Badge variant="outline" className="flex-shrink-0 text-xs bg-gray-100 text-gray-600">
                  {device.last_seen ? formatLastSeen(device.last_seen) : "Offline"}
                </Badge>
              )}
              {/* Measurement type badge - shows what the device measures */}
              {device.measurement_type && measurementTypeConfig[device.measurement_type] && (
                <Badge
                  variant="outline"
                  className={`flex-shrink-0 text-xs ${measurementTypeConfig[device.measurement_type].color}`}
                >
                  {measurementTypeConfig[device.measurement_type].label}
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
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Energy Meters */}
      {devicesByType["load_meter"] && devicesByType["load_meter"].length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{typeConfigs.load_meter.title}</CardTitle>
            <CardDescription>{typeConfigs.load_meter.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {devicesByType["load_meter"].map((device) => (
                <DeviceCard key={device.id} device={device} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Inverters */}
      {devicesByType["inverter"] && devicesByType["inverter"].length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{typeConfigs.inverter.title}</CardTitle>
            <CardDescription>{typeConfigs.inverter.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {devicesByType["inverter"].map((device) => (
                <DeviceCard key={device.id} device={device} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* DG Controllers */}
      {devicesByType["dg"] && devicesByType["dg"].length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{typeConfigs.dg.title}</CardTitle>
            <CardDescription>{typeConfigs.dg.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {devicesByType["dg"].map((device) => (
                <DeviceCard key={device.id} device={device} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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

          {/* Tabbed Interface - Connection and Registers only */}
          {/* Logging frequency is now set per-register, not per-device */}
          <Tabs defaultValue="connection" className="w-full">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="connection">Connection</TabsTrigger>
              <TabsTrigger value="registers">Registers</TabsTrigger>
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

              {/* Measurement Type - what the device measures for control logic */}
              <div className="space-y-2">
                <Label htmlFor="edit-measurement-type">Measurement Type</Label>
                <select
                  id="edit-measurement-type"
                  value={editMeasurementType}
                  onChange={(e) => setEditMeasurementType(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
                >
                  <option value="">Select what this device measures...</option>
                  {measurementTypes.map((mt) => (
                    <option key={mt.value} value={mt.value}>
                      {mt.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {editMeasurementType
                    ? measurementTypes.find((mt) => mt.value === editMeasurementType)?.description
                    : "Determines how this device is used in the control logic"}
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
            </TabsContent>

            {/* Registers Tab */}
            <TabsContent value="registers" className="space-y-4 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Modbus Registers</p>
                  <p className="text-xs text-muted-foreground">
                    Device-specific registers (changes don&apos;t affect template)
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
                          <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">Type</th>
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
                            <td className="px-3 py-2 hidden sm:table-cell">
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
