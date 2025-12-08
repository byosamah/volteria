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
import { toast } from "sonner";
import Link from "next/link";

// Device type
interface Device {
  id: string;
  name: string;
  protocol: string;
  slave_id: number;
  ip_address: string | null;
  port: number | null;
  gateway_ip: string | null;
  gateway_port: number | null;
  is_online: boolean;
  last_seen: string | null;
  device_templates: {
    name: string;
    device_type: string;
    brand: string;
    model: string;
  } | null;
}

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

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editSlaveId, setEditSlaveId] = useState(1);
  const [editIpAddress, setEditIpAddress] = useState("");
  const [editPort, setEditPort] = useState(502);
  const [editGatewayIp, setEditGatewayIp] = useState("");
  const [editGatewayPort, setEditGatewayPort] = useState(502);

  // Open edit dialog
  const openEditDialog = (device: Device) => {
    setEditDevice(device);
    setEditName(device.name);
    setEditSlaveId(device.slave_id);
    setEditIpAddress(device.ip_address || "");
    setEditPort(device.port || 502);
    setEditGatewayIp(device.gateway_ip || "");
    setEditGatewayPort(device.gateway_port || 502);
  };

  // Check for Modbus address conflicts when editing
  const checkEditConflicts = async (): Promise<string | null> => {
    if (!editDevice) return null;

    // Check other devices in the same project for conflicts
    for (const device of devices) {
      // Skip the device being edited
      if (device.id === editDevice.id) continue;

      if (editDevice.protocol === "tcp" && device.protocol === "tcp") {
        // TCP: Check IP + Port + Slave ID
        if (
          device.ip_address === editIpAddress.trim() &&
          device.port === editPort &&
          device.slave_id === editSlaveId
        ) {
          return `Conflict: Device "${device.name}" already uses IP ${device.ip_address}:${device.port} with Slave ID ${device.slave_id}`;
        }
      } else if (editDevice.protocol === "rtu_gateway" && device.protocol === "rtu_gateway") {
        // RTU Gateway: Check Gateway IP + Port + Slave ID
        if (
          device.gateway_ip === editGatewayIp.trim() &&
          device.gateway_port === editGatewayPort &&
          device.slave_id === editSlaveId
        ) {
          return `Conflict: Device "${device.name}" already uses Gateway ${device.gateway_ip}:${device.gateway_port} with Slave ID ${device.slave_id}`;
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

    // Prepare update data based on protocol
    const updateData: Record<string, unknown> = {
      name: editName.trim(),
      slave_id: editSlaveId,
    };

    if (editDevice.protocol === "tcp") {
      updateData.ip_address = editIpAddress.trim();
      updateData.port = editPort;
    } else if (editDevice.protocol === "rtu_gateway") {
      updateData.gateway_ip = editGatewayIp.trim();
      updateData.gateway_port = editGatewayPort;
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
    dg: { title: "Diesel Generators", description: "Generator controllers" },
    unknown: { title: "Other Devices", description: "Uncategorized devices" },
  };

  // Device card component - MOBILE-FRIENDLY with 44px touch targets
  const DeviceCard = ({ device }: { device: Device }) => {
    const reading = getDeviceReading(device.device_templates?.device_type);

    return (
      <div className="flex flex-col gap-3 p-3 rounded-lg bg-muted/50 sm:flex-row sm:items-center sm:justify-between">
        {/* Device info */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className={`h-3 w-3 rounded-full flex-shrink-0 ${
              device.is_online ? "bg-[#6baf4f]" : "bg-gray-400"
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium truncate">{device.name}</p>
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
            {/* Slave ID and IP shown on mobile */}
            <p className="text-xs text-muted-foreground sm:hidden">
              Slave ID: {device.slave_id}
              {device.ip_address && ` | ${device.ip_address}`}
              {device.gateway_ip && ` | ${device.gateway_ip}`}
            </p>
          </div>
        </div>
        {/* Actions - 44px touch targets */}
        <div className="flex items-center gap-2 justify-end">
          <span className="text-sm text-muted-foreground mr-2 hidden sm:inline">
            Slave ID: {device.slave_id}
            {/* Show IP address based on protocol */}
            {device.ip_address && ` | IP: ${device.ip_address}`}
            {device.gateway_ip && ` | Gateway: ${device.gateway_ip}`}
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

      {/* Edit Dialog - MOBILE-FRIENDLY */}
      <Dialog open={!!editDevice} onOpenChange={() => setEditDevice(null)}>
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Device</DialogTitle>
            <DialogDescription>
              Update device settings. Changes will be applied immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Device Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="min-h-[44px]"
              />
            </div>

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
            </div>

            {editDevice?.protocol === "tcp" && (
              <>
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
              </>
            )}

            {editDevice?.protocol === "rtu_gateway" && (
              <>
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
              </>
            )}
          </div>

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
