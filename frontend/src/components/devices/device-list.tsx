"use client";

/**
 * Device List Component
 *
 * Displays devices with edit and delete functionality.
 * Groups devices by type (load meters, inverters, generators).
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

interface DeviceListProps {
  projectId: string;
  devices: Device[];
}

export function DeviceList({ projectId, devices: initialDevices }: DeviceListProps) {
  const router = useRouter();
  const [devices, setDevices] = useState(initialDevices);
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

  // Handle edit submit
  const handleEditSubmit = async () => {
    if (!editDevice) return;
    setLoading(true);

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
    load_meter: { title: "Load Meters", description: "Power measurement devices" },
    inverter: { title: "Solar Inverters", description: "PV power conversion" },
    dg: { title: "Diesel Generators", description: "Generator controllers" },
    unknown: { title: "Other Devices", description: "Uncategorized devices" },
  };

  // Device card component
  const DeviceCard = ({ device }: { device: Device }) => (
    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
      <div className="flex items-center gap-3">
        <div
          className={`h-2 w-2 rounded-full ${
            device.is_online ? "bg-[#6baf4f]" : "bg-gray-400"
          }`}
        />
        <div>
          <p className="font-medium">{device.name}</p>
          <p className="text-sm text-muted-foreground">
            {device.device_templates?.brand} {device.device_templates?.model}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground mr-2">
          Slave ID: {device.slave_id}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => openEditDialog(device)}
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

  return (
    <>
      {/* Load Meters */}
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
              <Link href={`/projects/${projectId}/devices/new`}>Add Device</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Add device button */}
      {devices.length > 0 && (
        <div className="flex justify-end">
          <Button asChild>
            <Link href={`/projects/${projectId}/devices/new`}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-2">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
              Add Device
            </Link>
          </Button>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editDevice} onOpenChange={() => setEditDevice(null)}>
        <DialogContent>
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
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-port">Port</Label>
                  <Input
                    id="edit-port"
                    type="number"
                    value={editPort}
                    onChange={(e) => setEditPort(parseInt(e.target.value))}
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
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-gateway-port">Gateway Port</Label>
                  <Input
                    id="edit-gateway-port"
                    type="number"
                    value={editGatewayPort}
                    onChange={(e) => setEditGatewayPort(parseInt(e.target.value))}
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDevice(null)}>
              Cancel
            </Button>
            <Button onClick={handleEditSubmit} disabled={loading}>
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteDevice} onOpenChange={() => setDeleteDevice(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Device?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove &ldquo;{deleteDevice?.name}&rdquo;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              {loading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
