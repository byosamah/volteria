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

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Helper to determine if controller is online (heartbeat within last 90 seconds)
// Note: Controllers send heartbeats every 30 seconds
// Using 90 seconds (instead of 60) provides buffer for network latency and clock skew
// This means a controller must miss 2+ heartbeats before showing offline
const isControllerOnline = (lastHeartbeat: string | null): boolean => {
  if (!lastHeartbeat) return false;
  const thresholdMs = 90 * 1000; // 90 seconds
  return Date.now() - new Date(lastHeartbeat).getTime() < thresholdMs;
};

// Helper to format time since last heartbeat
const formatTimeSince = (timestamp: string | null): string => {
  if (!timestamp) return "Never";
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
};
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  // Modbus settings (for controllers)
  modbus_physical?: string | null;
  modbus_baud_rate?: number | null;
  modbus_parity?: string | null;
  modbus_stop_bits?: number | null;
  modbus_frame_type?: string | null;
  modbus_extra_delay?: number | null;
  modbus_slave_timeout?: number | null;
  modbus_write_function?: string | null;
  calculated_fields?: { field_id: string; enabled: boolean; storage_mode: string }[] | null;
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

// Calculated field definition
interface CalculatedFieldDef {
  field_id: string;
  name: string;
  description: string | null;
  unit: string | null;
  calculation_type: string;
  time_window: string | null;
}

interface MasterDeviceListProps {
  projectId: string;
  siteId: string;
  masterDevices: MasterDevice[];
  userRole?: string; // User role for permission checks
}

// ============================================
// COMPONENT
// ============================================

export function MasterDeviceList({
  projectId,
  siteId,
  masterDevices: initialDevices,
  userRole,
}: MasterDeviceListProps) {
  // Only admins can delete - configurators and viewers cannot
  const canDelete = userRole && !["configurator", "viewer"].includes(userRole);
  const router = useRouter();
  const [devices, setDevices] = useState(initialDevices);
  const [editingDevice, setEditingDevice] = useState<MasterDevice | null>(null);
  const [deletingDevice, setDeletingDevice] = useState<MasterDevice | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Heartbeat polling state - for live connection status
  const [heartbeats, setHeartbeats] = useState<Record<string, string>>({});
  const [isPolling, setIsPolling] = useState(false);

  // Fetch heartbeats from API with retry logic and merge to prevent false offline flickers
  const fetchHeartbeats = useCallback(async () => {
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch("/api/controllers/heartbeats");
        if (res.ok) {
          const data = await res.json();
          // Only update if we got valid data (not an error object)
          if (!data.error && typeof data === "object") {
            // Merge new heartbeats with existing ones to prevent false offline flickers
            // Only update a timestamp if it's newer than what we have
            setHeartbeats((prev) => {
              const merged = { ...prev };
              for (const [controllerId, timestamp] of Object.entries(data)) {
                const newTime = new Date(timestamp as string).getTime();
                const existingTime = prev[controllerId] ? new Date(prev[controllerId]).getTime() : 0;
                // Only update if new timestamp is more recent (or we didn't have one)
                if (newTime >= existingTime) {
                  merged[controllerId] = timestamp as string;
                }
              }
              return merged;
            });
          }
          return; // Success, exit
        }
        // Non-OK response, will retry
        lastError = new Error(`HTTP ${res.status}`);
      } catch (error) {
        lastError = error as Error;
      }

      // Wait 1 second before retry (except on last attempt)
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // All retries failed - keep existing heartbeat data (don't clear it)
    console.error("Failed to fetch heartbeats after retries:", lastError);
  }, []);

  // Smart polling effect - polls every 30s when tab is visible
  useEffect(() => {
    // Only poll if we have controller-type devices
    const hasControllers = devices.some(d => d.device_type === "controller" && d.controller_id);
    if (!hasControllers) return;

    // Initial fetch
    fetchHeartbeats();
    setIsPolling(true);

    // Set up polling interval
    let intervalId: NodeJS.Timeout;

    const startPolling = () => {
      intervalId = setInterval(fetchHeartbeats, 30000); // 30 seconds
    };

    // Handle tab visibility changes
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearInterval(intervalId);
        setIsPolling(false);
      } else {
        fetchHeartbeats();
        startPolling();
        setIsPolling(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    startPolling();

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchHeartbeats, devices]);

  // Helper to get heartbeat for a controller
  const getControllerHeartbeat = (controllerId: string | null): string | null => {
    if (!controllerId) return null;
    return heartbeats[controllerId] || null;
  };

  // Edit form state - Basic fields
  const [editName, setEditName] = useState("");
  const [editIpAddress, setEditIpAddress] = useState("");
  const [editPort, setEditPort] = useState("");

  // Edit form state - Gateway fields
  // These are only shown when editing a gateway device (not controller)
  const [editGatewayType, setEditGatewayType] = useState<"netbiter" | "other" | null>(null);

  // Netbiter credentials
  const [editNetbiterAccountId, setEditNetbiterAccountId] = useState("");
  const [editNetbiterUsername, setEditNetbiterUsername] = useState("");
  const [editNetbiterPassword, setEditNetbiterPassword] = useState("");
  const [editNetbiterSystemId, setEditNetbiterSystemId] = useState("");

  // Other gateway credentials
  const [editGatewayApiUrl, setEditGatewayApiUrl] = useState("");
  const [editGatewayApiKey, setEditGatewayApiKey] = useState("");
  const [editGatewayApiSecret, setEditGatewayApiSecret] = useState("");

  // Track if password/secret was modified (only update if user typed something)
  const [passwordModified, setPasswordModified] = useState(false);
  const [secretModified, setSecretModified] = useState(false);

  // Edit form state - Modbus settings (for controllers)
  const [editModbusPhysical, setEditModbusPhysical] = useState("RS-485");
  const [editModbusBaudRate, setEditModbusBaudRate] = useState("9600");
  const [editModbusParity, setEditModbusParity] = useState("none");
  const [editModbusStopBits, setEditModbusStopBits] = useState("1");
  const [editModbusFrameType, setEditModbusFrameType] = useState("RTU");
  const [editModbusExtraDelay, setEditModbusExtraDelay] = useState("0");
  const [editModbusSlaveTimeout, setEditModbusSlaveTimeout] = useState("1000");
  const [editModbusWriteFunction, setEditModbusWriteFunction] = useState("auto");

  // Edit form state - Calculated fields (for controllers)
  const [editSelectedCalculatedFields, setEditSelectedCalculatedFields] = useState<string[]>([]);
  const [availableCalculatedFields, setAvailableCalculatedFields] = useState<CalculatedFieldDef[]>([]);
  const [loadingCalculatedFields, setLoadingCalculatedFields] = useState(false);

  // Check if site already has a controller
  const hasController = devices.some((d) => d.device_type === "controller");

  // Open edit dialog
  const handleEdit = async (device: MasterDevice) => {
    setEditingDevice(device);

    // Basic fields
    setEditName(device.name);
    setEditIpAddress(device.ip_address || "");
    setEditPort(device.port?.toString() || "");

    // Gateway-specific fields (only relevant for gateway devices)
    setEditGatewayType(device.gateway_type);
    setEditNetbiterAccountId(device.netbiter_account_id || "");
    setEditNetbiterUsername(device.netbiter_username || "");
    setEditNetbiterPassword(""); // Never pre-fill passwords (security)
    setEditNetbiterSystemId(device.netbiter_system_id || "");
    setEditGatewayApiUrl(device.gateway_api_url || "");
    setEditGatewayApiKey(""); // Never pre-fill API keys (security)
    setEditGatewayApiSecret(""); // Never pre-fill secrets (security)

    // Reset modification flags
    setPasswordModified(false);
    setSecretModified(false);

    // Controller-specific fields (Modbus settings)
    if (device.device_type === "controller") {
      setEditModbusPhysical(device.modbus_physical || "RS-485");
      setEditModbusBaudRate(device.modbus_baud_rate?.toString() || "9600");
      setEditModbusParity(device.modbus_parity || "none");
      setEditModbusStopBits(device.modbus_stop_bits?.toString() || "1");
      setEditModbusFrameType(device.modbus_frame_type || "RTU");
      setEditModbusExtraDelay(device.modbus_extra_delay?.toString() || "0");
      setEditModbusSlaveTimeout(device.modbus_slave_timeout?.toString() || "1000");
      setEditModbusWriteFunction(device.modbus_write_function || "auto");

      // Load calculated fields from existing selection
      const existingFieldIds = device.calculated_fields?.map(f => f.field_id) || [];
      setEditSelectedCalculatedFields(existingFieldIds);

      // Load available calculated field definitions if there are any
      if (existingFieldIds.length > 0) {
        setLoadingCalculatedFields(true);
        try {
          const supabase = createClient();
          const { data: fieldDefs } = await supabase
            .from("calculated_field_definitions")
            .select("field_id, name, description, unit, calculation_type, time_window")
            .in("field_id", existingFieldIds);

          if (fieldDefs) {
            setAvailableCalculatedFields(fieldDefs);
          }
        } catch (err) {
          console.error("Failed to load calculated fields:", err);
        } finally {
          setLoadingCalculatedFields(false);
        }
      } else {
        setAvailableCalculatedFields([]);
      }
    }
  };

  // Save edit
  const handleSaveEdit = async () => {
    if (!editingDevice) return;

    setIsSaving(true);
    try {
      const supabase = createClient();

      // Build update object - always include basic fields
      const updateData: Record<string, unknown> = {
        name: editName.trim(),
        ip_address: editIpAddress.trim() || null,
        port: editPort ? parseInt(editPort) : null,
      };

      // Add controller-specific fields (Modbus settings)
      if (editingDevice.device_type === "controller") {
        updateData.modbus_physical = editModbusPhysical;
        updateData.modbus_baud_rate = parseInt(editModbusBaudRate);
        updateData.modbus_parity = editModbusParity;
        updateData.modbus_stop_bits = parseInt(editModbusStopBits);
        updateData.modbus_frame_type = editModbusFrameType;
        updateData.modbus_extra_delay = parseInt(editModbusExtraDelay);
        updateData.modbus_slave_timeout = parseInt(editModbusSlaveTimeout);
        updateData.modbus_write_function = editModbusWriteFunction;

        // Add calculated fields selection
        updateData.calculated_fields = editSelectedCalculatedFields.map(id => ({
          field_id: id,
          enabled: true,
          storage_mode: "log"
        }));
      }

      // Add gateway-specific fields if this is a gateway device
      if (editingDevice.device_type === "gateway") {
        updateData.gateway_type = editGatewayType;

        if (editGatewayType === "netbiter") {
          // Netbiter credentials
          updateData.netbiter_account_id = editNetbiterAccountId.trim() || null;
          updateData.netbiter_username = editNetbiterUsername.trim() || null;
          updateData.netbiter_system_id = editNetbiterSystemId.trim() || null;

          // Only update password if user actually typed something new
          if (passwordModified && editNetbiterPassword.trim()) {
            updateData.netbiter_password = editNetbiterPassword.trim();
          }

          // Clear "other" gateway fields when using Netbiter
          updateData.gateway_api_url = null;
          updateData.gateway_api_key = null;
          updateData.gateway_api_secret = null;
        } else if (editGatewayType === "other") {
          // Other gateway credentials
          updateData.gateway_api_url = editGatewayApiUrl.trim() || null;

          // Only update key/secret if user actually typed something new
          if (editGatewayApiKey.trim()) {
            updateData.gateway_api_key = editGatewayApiKey.trim();
          }
          if (secretModified && editGatewayApiSecret.trim()) {
            updateData.gateway_api_secret = editGatewayApiSecret.trim();
          }

          // Clear Netbiter fields when using Other gateway
          updateData.netbiter_account_id = null;
          updateData.netbiter_username = null;
          updateData.netbiter_password = null;
          updateData.netbiter_system_id = null;
        }
      }

      const { error } = await supabase
        .from("site_master_devices")
        .update(updateData)
        .eq("id", editingDevice.id);

      if (error) throw error;

      // Update local state with all changed fields
      setDevices((prev) =>
        prev.map((d) =>
          d.id === editingDevice.id
            ? {
                ...d,
                name: editName.trim(),
                ip_address: editIpAddress.trim() || null,
                port: editPort ? parseInt(editPort) : null,
                // Gateway fields (only relevant for gateway devices)
                gateway_type:
                  editingDevice.device_type === "gateway"
                    ? editGatewayType
                    : d.gateway_type,
                netbiter_account_id:
                  editGatewayType === "netbiter"
                    ? editNetbiterAccountId.trim() || null
                    : null,
                netbiter_username:
                  editGatewayType === "netbiter"
                    ? editNetbiterUsername.trim() || null
                    : null,
                netbiter_system_id:
                  editGatewayType === "netbiter"
                    ? editNetbiterSystemId.trim() || null
                    : null,
                gateway_api_url:
                  editGatewayType === "other"
                    ? editGatewayApiUrl.trim() || null
                    : null,
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
                    {/* Online/Offline indicator - uses live heartbeat data for controllers */}
                    {device.device_type === "controller" && device.controller_id ? (
                      // Controller: use polled heartbeat data with visible status text
                      (() => {
                        const heartbeat = getControllerHeartbeat(device.controller_id);
                        const online = isControllerOnline(heartbeat);
                        return (
                          <div
                            className="flex items-center gap-1.5 flex-shrink-0"
                            title={online ? "Online" : heartbeat ? formatTimeSince(heartbeat) : "Offline"}
                          >
                            {online ? (
                              <>
                                <span className="relative flex h-2.5 w-2.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                                </span>
                                <span className="text-xs text-green-600 font-medium">Online</span>
                              </>
                            ) : (
                              <>
                                <span className="relative flex h-2.5 w-2.5">
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-gray-300"></span>
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {heartbeat ? formatTimeSince(heartbeat) : "Offline"}
                                </span>
                              </>
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      // Gateway: use static is_online field
                      <div
                        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                          device.is_online ? "bg-green-500" : "bg-gray-300"
                        }`}
                        title={device.is_online ? "Online" : "Offline"}
                      />
                    )}

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
                    {canDelete && (
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
                    )}
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
        <DialogContent className="max-h-[90vh] overflow-y-auto">
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

            {/* Controller-specific fields - Modbus Settings */}
            {editingDevice?.device_type === "controller" && (
              <>
                {/* Modbus Settings Section */}
                <div className="border-t pt-4 mt-2">
                  <h4 className="font-medium text-sm mb-4">Modbus Settings</h4>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Physical */}
                  <div className="space-y-2">
                    <Label>Physical</Label>
                    <Select value={editModbusPhysical} onValueChange={setEditModbusPhysical}>
                      <SelectTrigger className="min-h-[44px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="RS-485">RS-485</SelectItem>
                        <SelectItem value="RS-232">RS-232</SelectItem>
                        <SelectItem value="TCP">TCP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Baud Rate */}
                  <div className="space-y-2">
                    <Label>Baud Rate</Label>
                    <Select value={editModbusBaudRate} onValueChange={setEditModbusBaudRate}>
                      <SelectTrigger className="min-h-[44px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="9600">9600 bps</SelectItem>
                        <SelectItem value="19200">19200 bps</SelectItem>
                        <SelectItem value="38400">38400 bps</SelectItem>
                        <SelectItem value="57600">57600 bps</SelectItem>
                        <SelectItem value="115200">115200 bps</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Parity */}
                  <div className="space-y-2">
                    <Label>Parity</Label>
                    <Select value={editModbusParity} onValueChange={setEditModbusParity}>
                      <SelectTrigger className="min-h-[44px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="even">Even</SelectItem>
                        <SelectItem value="odd">Odd</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Stop Bits */}
                  <div className="space-y-2">
                    <Label>Stop Bits</Label>
                    <Select value={editModbusStopBits} onValueChange={setEditModbusStopBits}>
                      <SelectTrigger className="min-h-[44px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1</SelectItem>
                        <SelectItem value="2">2</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Frame Type */}
                  <div className="space-y-2">
                    <Label>Frame Type</Label>
                    <Select value={editModbusFrameType} onValueChange={setEditModbusFrameType}>
                      <SelectTrigger className="min-h-[44px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="RTU">RTU</SelectItem>
                        <SelectItem value="ASCII">ASCII</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Extra Delay */}
                  <div className="space-y-2">
                    <Label>Extra Delay</Label>
                    <Select value={editModbusExtraDelay} onValueChange={setEditModbusExtraDelay}>
                      <SelectTrigger className="min-h-[44px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">None</SelectItem>
                        <SelectItem value="10">10 ms</SelectItem>
                        <SelectItem value="50">50 ms</SelectItem>
                        <SelectItem value="100">100 ms</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Slave Timeout */}
                  <div className="space-y-2">
                    <Label>Slave Timeout</Label>
                    <Select value={editModbusSlaveTimeout} onValueChange={setEditModbusSlaveTimeout}>
                      <SelectTrigger className="min-h-[44px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="500">500 ms</SelectItem>
                        <SelectItem value="1000">1000 ms</SelectItem>
                        <SelectItem value="2000">2000 ms</SelectItem>
                        <SelectItem value="5000">5000 ms</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Write Function */}
                  <div className="space-y-2">
                    <Label>Write Function</Label>
                    <Select value={editModbusWriteFunction} onValueChange={setEditModbusWriteFunction}>
                      <SelectTrigger className="min-h-[44px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="single">Single (FC6)</SelectItem>
                        <SelectItem value="multiple">Multiple (FC16)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Calculated Fields Section */}
                {availableCalculatedFields.length > 0 && (
                  <>
                    <div className="border-t pt-4 mt-4">
                      <h4 className="font-medium text-sm mb-1">Calculated Fields</h4>
                      <p className="text-xs text-muted-foreground mb-4">
                        Enable or disable calculated fields for this controller
                      </p>
                    </div>

                    {loadingCalculatedFields ? (
                      <div className="text-sm text-muted-foreground">Loading fields...</div>
                    ) : (
                      <div className="space-y-2">
                        {availableCalculatedFields.map((field) => (
                          <div
                            key={field.field_id}
                            className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20"
                          >
                            <Checkbox
                              id={`edit-${field.field_id}`}
                              checked={editSelectedCalculatedFields.includes(field.field_id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setEditSelectedCalculatedFields([...editSelectedCalculatedFields, field.field_id]);
                                } else {
                                  setEditSelectedCalculatedFields(editSelectedCalculatedFields.filter(id => id !== field.field_id));
                                }
                              }}
                            />
                            <div className="flex-1 min-w-0">
                              <label
                                htmlFor={`edit-${field.field_id}`}
                                className="font-medium text-sm cursor-pointer"
                              >
                                {field.name}
                              </label>
                              {field.description && (
                                <p className="text-xs text-muted-foreground truncate">
                                  {field.description}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {field.unit && (
                                <Badge variant="outline" className="text-xs">
                                  {field.unit}
                                </Badge>
                              )}
                              <Badge variant="secondary" className="text-xs">
                                {field.calculation_type}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* Gateway-specific fields - only shown for gateway devices */}
            {editingDevice?.device_type === "gateway" && (
              <>
                {/* Section divider */}
                <div className="border-t pt-4 mt-2">
                  <h4 className="font-medium text-sm mb-4">Gateway Configuration</h4>
                </div>

                {/* Gateway Type Selector */}
                <div className="space-y-2">
                  <Label>Gateway Type</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {/* Netbiter option */}
                    <button
                      type="button"
                      onClick={() => setEditGatewayType("netbiter")}
                      className={`p-3 rounded-lg border-2 text-left transition-all ${
                        editGatewayType === "netbiter"
                          ? "border-primary bg-primary/5"
                          : "border-muted hover:border-muted-foreground/50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            editGatewayType === "netbiter"
                              ? "border-primary"
                              : "border-muted-foreground/50"
                          }`}
                        >
                          {editGatewayType === "netbiter" && (
                            <div className="w-2 h-2 rounded-full bg-primary" />
                          )}
                        </div>
                        <span className="font-medium text-sm">Netbiter</span>
                      </div>
                    </button>

                    {/* Other option */}
                    <button
                      type="button"
                      onClick={() => setEditGatewayType("other")}
                      className={`p-3 rounded-lg border-2 text-left transition-all ${
                        editGatewayType === "other"
                          ? "border-primary bg-primary/5"
                          : "border-muted hover:border-muted-foreground/50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            editGatewayType === "other"
                              ? "border-primary"
                              : "border-muted-foreground/50"
                          }`}
                        >
                          {editGatewayType === "other" && (
                            <div className="w-2 h-2 rounded-full bg-primary" />
                          )}
                        </div>
                        <span className="font-medium text-sm">Other</span>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Netbiter Credentials */}
                {editGatewayType === "netbiter" && (
                  <div className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <Label htmlFor="edit-netbiter-account">Account ID</Label>
                      <Input
                        id="edit-netbiter-account"
                        value={editNetbiterAccountId}
                        onChange={(e) => setEditNetbiterAccountId(e.target.value)}
                        placeholder="Enter your Netbiter account ID"
                        className="min-h-[44px]"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="edit-netbiter-username">Username</Label>
                      <Input
                        id="edit-netbiter-username"
                        value={editNetbiterUsername}
                        onChange={(e) => setEditNetbiterUsername(e.target.value)}
                        placeholder="API username"
                        className="min-h-[44px]"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="edit-netbiter-password">
                        Password
                        <span className="text-xs text-muted-foreground ml-2">
                          (leave empty to keep current)
                        </span>
                      </Label>
                      <Input
                        id="edit-netbiter-password"
                        type="password"
                        value={editNetbiterPassword}
                        onChange={(e) => {
                          setEditNetbiterPassword(e.target.value);
                          setPasswordModified(true);
                        }}
                        placeholder="Enter new password to change"
                        className="min-h-[44px]"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="edit-netbiter-system">
                        System ID
                        <span className="text-xs text-muted-foreground ml-2">
                          (optional)
                        </span>
                      </Label>
                      <Input
                        id="edit-netbiter-system"
                        value={editNetbiterSystemId}
                        onChange={(e) => setEditNetbiterSystemId(e.target.value)}
                        placeholder="Netbiter system/device ID"
                        className="min-h-[44px]"
                      />
                    </div>
                  </div>
                )}

                {/* Other Gateway Credentials */}
                {editGatewayType === "other" && (
                  <div className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <Label htmlFor="edit-api-url">API URL</Label>
                      <Input
                        id="edit-api-url"
                        value={editGatewayApiUrl}
                        onChange={(e) => setEditGatewayApiUrl(e.target.value)}
                        placeholder="https://api.example.com"
                        className="min-h-[44px]"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="edit-api-key">
                        API Key
                        <span className="text-xs text-muted-foreground ml-2">
                          (leave empty to keep current)
                        </span>
                      </Label>
                      <Input
                        id="edit-api-key"
                        value={editGatewayApiKey}
                        onChange={(e) => setEditGatewayApiKey(e.target.value)}
                        placeholder="Enter new API key to change"
                        className="min-h-[44px]"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="edit-api-secret">
                        API Secret
                        <span className="text-xs text-muted-foreground ml-2">
                          (leave empty to keep current)
                        </span>
                      </Label>
                      <Input
                        id="edit-api-secret"
                        type="password"
                        value={editGatewayApiSecret}
                        onChange={(e) => {
                          setEditGatewayApiSecret(e.target.value);
                          setSecretModified(true);
                        }}
                        placeholder="Enter new API secret to change"
                        className="min-h-[44px]"
                      />
                    </div>
                  </div>
                )}
              </>
            )}
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
