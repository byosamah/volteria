"use client";

/**
 * Master Device List Component
 *
 * Displays controllers and gateways assigned to a site.
 * Shows above regular devices in the site detail page.
 *
 * Features:
 * - Controller: Links to claimed enterprise controller
 * - Gateway: Netbiter or other API gateway with credentials
 * - Edit/Delete functionality
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

// ============================================
// TYPES
// ============================================

interface MasterDevice {
  id: string;
  site_id: string;
  device_type: "controller" | "gateway";
  name: string;
  ip_address: string | null;
  port: number | null;
  // Controller fields
  controller_id: string | null;
  controllers?: {
    serial_number: string;
    firmware_version: string | null;
    approved_hardware?: {
      name: string;
      manufacturer: string;
    } | null;
  } | null;
  // Gateway fields
  gateway_type: "netbiter" | "other" | null;
  netbiter_account_id: string | null;
  netbiter_username: string | null;
  netbiter_system_id: string | null;
  gateway_api_url: string | null;
  // Status
  is_online: boolean;
  last_seen: string | null;
  last_error: string | null;
}

interface MasterDeviceListProps {
  projectId: string;
  siteId: string;
  masterDevices: MasterDevice[];
}

// ============================================
// COMPONENT
// ============================================

export function MasterDeviceList({
  projectId,
  siteId,
  masterDevices: initialDevices,
}: MasterDeviceListProps) {
  const router = useRouter();
  const [devices, setDevices] = useState(initialDevices);
  const [editingDevice, setEditingDevice] = useState<MasterDevice | null>(null);
  const [deletingDevice, setDeletingDevice] = useState<MasterDevice | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editIpAddress, setEditIpAddress] = useState("");
  const [editPort, setEditPort] = useState("");

  // Check if site already has a controller
  const hasController = devices.some((d) => d.device_type === "controller");

  // Open edit dialog
  const handleEdit = (device: MasterDevice) => {
    setEditingDevice(device);
    setEditName(device.name);
    setEditIpAddress(device.ip_address || "");
    setEditPort(device.port?.toString() || "");
  };

  // Save edit
  const handleSaveEdit = async () => {
    if (!editingDevice) return;

    setIsSaving(true);
    try {
      const supabase = createClient();

      const { error } = await supabase
        .from("site_master_devices")
        .update({
          name: editName.trim(),
          ip_address: editIpAddress.trim() || null,
          port: editPort ? parseInt(editPort) : null,
        })
        .eq("id", editingDevice.id);

      if (error) throw error;

      // Update local state
      setDevices((prev) =>
        prev.map((d) =>
          d.id === editingDevice.id
            ? {
                ...d,
                name: editName.trim(),
                ip_address: editIpAddress.trim() || null,
                port: editPort ? parseInt(editPort) : null,
              }
            : d
        )
      );

      toast.success("Master device updated");
      setEditingDevice(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update device");
    } finally {
      setIsSaving(false);
    }
  };

  // Delete device
  const handleDelete = async () => {
    if (!deletingDevice) return;

    setIsDeleting(true);
    try {
      const supabase = createClient();

      const { error } = await supabase
        .from("site_master_devices")
        .delete()
        .eq("id", deletingDevice.id);

      if (error) throw error;

      // Update local state
      setDevices((prev) => prev.filter((d) => d.id !== deletingDevice.id));

      toast.success("Master device removed");
      setDeletingDevice(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove device");
    } finally {
      setIsDeleting(false);
    }
  };

  // Get badge variant for device type
  const getTypeBadge = (device: MasterDevice) => {
    if (device.device_type === "controller") {
      return (
        <Badge variant="default" className="bg-blue-600">
          Controller
        </Badge>
      );
    }
    if (device.gateway_type === "netbiter") {
      return (
        <Badge variant="default" className="bg-orange-600">
          Netbiter
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        Gateway
      </Badge>
    );
  };

  // Get device description
  const getDeviceDescription = (device: MasterDevice) => {
    const parts: string[] = [];

    if (device.device_type === "controller" && device.controllers) {
      parts.push(device.controllers.serial_number);
      if (device.controllers.approved_hardware?.name) {
        parts.push(device.controllers.approved_hardware.name);
      }
    } else if (device.gateway_type === "netbiter") {
      parts.push("Netbiter Gateway");
      if (device.netbiter_system_id) {
        parts.push(`System: ${device.netbiter_system_id}`);
      }
    } else {
      parts.push("API Gateway");
    }

    if (device.ip_address) {
      parts.push(`${device.ip_address}${device.port ? `:${device.port}` : ""}`);
    }

    return parts.join(" • ");
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="text-lg">Master Devices</CardTitle>
            <CardDescription>
              Controllers and gateways managing this site
            </CardDescription>
          </div>
          <Link href={`/projects/${projectId}/sites/${siteId}/master-devices/new`}>
            <Button size="sm" className="min-h-[44px]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 mr-2"
              >
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
              Add Device
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {devices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-12 w-12 mx-auto mb-4 opacity-50"
              >
                <rect width="20" height="14" x="2" y="3" rx="2" />
                <line x1="8" x2="16" y1="21" y2="21" />
                <line x1="12" x2="12" y1="17" y2="21" />
              </svg>
              <p>No master devices configured</p>
              <p className="text-sm mt-1">
                Add a controller or gateway to manage this site
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {devices.map((device) => (
                <div
                  key={device.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Online/Offline indicator */}
                    <div
                      className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                        device.is_online ? "bg-green-500" : "bg-gray-300"
                      }`}
                      title={device.is_online ? "Online" : "Offline"}
                    />

                    {/* Device info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{device.name}</span>
                        {getTypeBadge(device)}
                      </div>
                      <p className="text-sm text-muted-foreground truncate mt-0.5">
                        {getDeviceDescription(device)}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => handleEdit(device)}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4"
                      >
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        <path d="m15 5 4 4" />
                      </svg>
                      <span className="sr-only">Edit</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-destructive hover:text-destructive"
                      onClick={() => setDeletingDevice(device)}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4"
                      >
                        <path d="M3 6h18" />
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        <line x1="10" x2="10" y1="11" y2="17" />
                        <line x1="14" x2="14" y1="11" y2="17" />
                      </svg>
                      <span className="sr-only">Delete</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Info about controller limit */}
          {hasController && (
            <p className="text-xs text-muted-foreground mt-4">
              This site already has a controller assigned. Only one controller per site is allowed.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingDevice} onOpenChange={() => setEditingDevice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Master Device</DialogTitle>
            <DialogDescription>
              Update the device name and connection settings
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="min-h-[44px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-ip">IP Address</Label>
              <Input
                id="edit-ip"
                value={editIpAddress}
                onChange={(e) => setEditIpAddress(e.target.value)}
                placeholder="e.g., 192.168.1.100"
                className="min-h-[44px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-port">Port</Label>
              <Input
                id="edit-port"
                type="number"
                value={editPort}
                onChange={(e) => setEditPort(e.target.value)}
                placeholder="e.g., 502"
                className="min-h-[44px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingDevice(null)}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={isSaving || !editName.trim()}
              className="min-h-[44px]"
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingDevice} onOpenChange={() => setDeletingDevice(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Master Device</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove &quot;{deletingDevice?.name}&quot;?
              {deletingDevice?.device_type === "controller" && (
                <span className="block mt-2 text-amber-600">
                  This will unassign the controller from this site.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 min-h-[44px]"
            >
              {isDeleting ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
