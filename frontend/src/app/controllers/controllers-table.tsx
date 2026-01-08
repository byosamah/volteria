"use client";

/**
 * Controllers Table Component
 *
 * Client component that displays:
 * - Table of claimed controllers
 * - Claim new controller dialog
 * - Update firmware dialog
 * - Live connection status with polling
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Helper to determine if controller is online (heartbeat within last 1 minute)
// Note: Controllers send heartbeats every 30 seconds
const isControllerOnline = (lastHeartbeat: string | null): boolean => {
  if (!lastHeartbeat) return false;
  const oneMinuteAgo = Date.now() - 60 * 1000;
  return new Date(lastHeartbeat).getTime() > oneMinuteAgo;
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// Type definitions
interface Controller {
  id: string;
  serial_number: string;
  status: string;
  firmware_version: string | null;
  firmware_updated_at: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  enterprise_id: string | null;
  project_id: string | null;
  approved_hardware: {
    name: string;
    manufacturer: string;
    hardware_type: string;
  } | null;
  enterprises: {
    name: string;
  } | null;
  last_heartbeat: string | null;
}

interface HardwareType {
  id: string;
  hardware_type: string;
  name: string;
  manufacturer: string;
}

interface Enterprise {
  id: string;
  name: string;
}

interface ControllersTableProps {
  controllers: Controller[];
  hardwareTypes: HardwareType[];
  enterprises: Enterprise[];
  canEdit: boolean;
  isSuperAdmin: boolean;
  userEnterpriseId: string | null;
  userEnterpriseName: string | null;
}

// Status badge colors - matches Controller Master List styling
// draft = gray, ready = yellow (can be claimed), claimed = blue (owned but no site)
// deployed = green (on a site), deactivated = amber (disabled), eol = red (decommissioned)
const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  ready: "bg-yellow-100 text-yellow-800",
  claimed: "bg-blue-100 text-blue-800",
  deployed: "bg-green-100 text-green-800",
  deactivated: "bg-amber-100 text-amber-800",
  eol: "bg-red-100 text-red-800",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={`${statusColors[status] || "bg-gray-100 text-gray-800"} capitalize`}>
      {status}
    </Badge>
  );
}

export function ControllersTable({
  controllers,
  hardwareTypes,
  enterprises,
  canEdit,
  isSuperAdmin,
  userEnterpriseId,
  userEnterpriseName,
}: ControllersTableProps) {
  const router = useRouter();
  const supabase = createClient();

  // Claim dialog state
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimForm, setClaimForm] = useState({
    hardwareTypeId: "",
    serialNumber: "",
    passcode: "",
    enterpriseId: userEnterpriseId || "",
  });

  // Firmware dialog state
  const [firmwareOpen, setFirmwareOpen] = useState(false);
  const [firmwareLoading, setFirmwareLoading] = useState(false);
  const [selectedController, setSelectedController] = useState<Controller | null>(null);
  const [newFirmwareVersion, setNewFirmwareVersion] = useState("");

  // Heartbeat polling state - for auto-updating connection status
  const [heartbeats, setHeartbeats] = useState<Record<string, string>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch heartbeats from API with merge logic to prevent false offline flickers
  const fetchHeartbeats = useCallback(async () => {
    setIsRefreshing(true);
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
          setLastUpdated(new Date());
        }
      }
    } catch (error) {
      console.error("Failed to fetch heartbeats:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Smart polling effect - polls every 30s when tab is visible
  useEffect(() => {
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
        // Tab is hidden - stop polling
        clearInterval(intervalId);
        setIsPolling(false);
      } else {
        // Tab is visible - fetch immediately and resume polling
        fetchHeartbeats();
        startPolling();
        setIsPolling(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    startPolling();

    // Cleanup
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchHeartbeats]);

  // Helper to get heartbeat for a controller (polled data or initial prop)
  const getControllerHeartbeat = (controllerId: string, initialHeartbeat: string | null): string | null => {
    return heartbeats[controllerId] || initialHeartbeat;
  };

  // Handle claim form submission
  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setClaimLoading(true);

    try {
      // Validate inputs
      if (!claimForm.serialNumber.trim()) {
        toast.error("Serial number is required");
        setClaimLoading(false);
        return;
      }

      if (!claimForm.passcode.trim()) {
        toast.error("Passcode is required");
        setClaimLoading(false);
        return;
      }

      // Find the controller by serial number
      const { data: controller, error: findError } = await supabase
        .from("controllers")
        .select("id, status, passcode, enterprise_id, hardware_type_id")
        .eq("serial_number", claimForm.serialNumber.trim())
        .single();

      if (findError || !controller) {
        toast.error("Controller not found. Check the serial number.");
        setClaimLoading(false);
        return;
      }

      // Check if already claimed
      if (controller.enterprise_id) {
        toast.error("This controller is already claimed by another enterprise.");
        setClaimLoading(false);
        return;
      }

      // Check status is "ready"
      if (controller.status !== "ready") {
        toast.error(`Controller status is "${controller.status}". Only "ready" controllers can be claimed.`);
        setClaimLoading(false);
        return;
      }

      // Verify passcode
      if (controller.passcode !== claimForm.passcode.trim()) {
        toast.error("Invalid passcode. Please check and try again.");
        setClaimLoading(false);
        return;
      }

      // Controller model is required
      if (!claimForm.hardwareTypeId) {
        toast.error("Please select a controller model");
        setClaimLoading(false);
        return;
      }

      // Verify selected hardware type matches the controller
      if (controller.hardware_type_id !== claimForm.hardwareTypeId) {
        toast.error("Controller model doesn't match. Please verify the model selection.");
        setClaimLoading(false);
        return;
      }

      // Validate enterprise selection for super admin
      const selectedEnterpriseId = isSuperAdmin ? claimForm.enterpriseId : userEnterpriseId;
      if (!selectedEnterpriseId) {
        toast.error("Please select an enterprise");
        setClaimLoading(false);
        return;
      }

      // Get current user for claimed_by
      const { data: { user } } = await supabase.auth.getUser();

      // Claim the controller - status becomes 'claimed' (not 'deployed')
      // Controller will become 'deployed' automatically when added to a site
      const { error: updateError } = await supabase
        .from("controllers")
        .update({
          enterprise_id: selectedEnterpriseId,
          claimed_at: new Date().toISOString(),
          claimed_by: user?.id,
          status: "claimed",
        })
        .eq("id", controller.id);

      if (updateError) {
        console.error("Error claiming controller:", updateError);
        toast.error("Failed to claim controller. Please try again.");
        setClaimLoading(false);
        return;
      }

      // Success!
      toast.success("Controller claimed successfully!");
      setClaimOpen(false);
      setClaimForm({ hardwareTypeId: "", serialNumber: "", passcode: "", enterpriseId: userEnterpriseId || "" });
      router.refresh();
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred.");
    } finally {
      setClaimLoading(false);
    }
  };

  // Handle firmware update
  const handleFirmwareUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedController) return;

    setFirmwareLoading(true);

    try {
      if (!newFirmwareVersion.trim()) {
        toast.error("Firmware version is required");
        setFirmwareLoading(false);
        return;
      }

      // Update firmware version
      const { error } = await supabase
        .from("controllers")
        .update({
          firmware_version: newFirmwareVersion.trim(),
          firmware_updated_at: new Date().toISOString(),
        })
        .eq("id", selectedController.id);

      if (error) {
        console.error("Error updating firmware:", error);
        toast.error("Failed to update firmware version.");
        setFirmwareLoading(false);
        return;
      }

      toast.success("Firmware version updated!");
      setFirmwareOpen(false);
      setSelectedController(null);
      setNewFirmwareVersion("");
      router.refresh();
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred.");
    } finally {
      setFirmwareLoading(false);
    }
  };

  // Open firmware dialog for a controller
  const openFirmwareDialog = (controller: Controller) => {
    setSelectedController(controller);
    setNewFirmwareVersion(controller.firmware_version || "");
    setFirmwareOpen(true);
  };

  // Format date for display
  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="space-y-4">
      {/* Actions bar with live indicator and claim button */}
      <div className="flex items-center justify-between gap-4">
        {/* Auto-refresh status indicator */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {isPolling && (
            <span className="flex items-center gap-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="hidden sm:inline">Live</span>
            </span>
          )}
          {lastUpdated && (
            <span className="hidden sm:inline">
              Updated {formatTimeSince(lastUpdated.toISOString())}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchHeartbeats}
            disabled={isRefreshing}
            className="h-8 w-8 p-0"
            title="Refresh connection status"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
          </Button>
        </div>

        {/* Claim button - available to users with edit permission */}
        {canEdit && (
          <Dialog open={claimOpen} onOpenChange={setClaimOpen}>
            <DialogTrigger asChild>
              <Button>
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
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Claim Controller
              </Button>
            </DialogTrigger>
            {/* MOBILE-FRIENDLY: Dialog with proper margins */}
            <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Claim a Controller</DialogTitle>
                <DialogDescription>
                  Enter the controller details to claim it for your enterprise.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleClaim} className="space-y-4">
                {/* Model Selection (required) */}
                <div className="space-y-2">
                  <Label htmlFor="hardwareType">
                    Controller Model <span className="text-red-500">*</span>
                  </Label>
                  {/* MOBILE-FRIENDLY: 44px touch target */}
                  <select
                    id="hardwareType"
                    value={claimForm.hardwareTypeId}
                    onChange={(e) =>
                      setClaimForm((prev) => ({ ...prev, hardwareTypeId: e.target.value }))
                    }
                    className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
                    required
                  >
                    <option value="">Select a model</option>
                    {hardwareTypes.map((hw) => (
                      <option key={hw.id} value={hw.id}>
                        {hw.hardware_type}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Must match the controller hardware
                  </p>
                </div>

                {/* Enterprise Selection - editable only for super admin */}
                <div className="space-y-2">
                  <Label htmlFor="enterprise">
                    Enterprise {isSuperAdmin && <span className="text-red-500">*</span>}
                  </Label>
                  {isSuperAdmin ? (
                    <>
                      <select
                        id="enterprise"
                        value={claimForm.enterpriseId}
                        onChange={(e) =>
                          setClaimForm((prev) => ({ ...prev, enterpriseId: e.target.value }))
                        }
                        className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
                        required
                      >
                        <option value="">Select an enterprise</option>
                        {enterprises.map((ent) => (
                          <option key={ent.id} value={ent.id}>
                            {ent.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground">
                        Select which enterprise will own this controller
                      </p>
                    </>
                  ) : (
                    <>
                      <Input
                        id="enterprise"
                        value={userEnterpriseName || "Not assigned"}
                        disabled
                        className="min-h-[44px] bg-muted"
                      />
                      <p className="text-xs text-muted-foreground">
                        Controller will be claimed for your enterprise
                      </p>
                    </>
                  )}
                </div>

                {/* Serial Number */}
                <div className="space-y-2">
                  <Label htmlFor="serialNumber">
                    Serial Number <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="serialNumber"
                    placeholder="e.g., RPI5-001"
                    value={claimForm.serialNumber}
                    onChange={(e) =>
                      setClaimForm((prev) => ({ ...prev, serialNumber: e.target.value }))
                    }
                    required
                    className="min-h-[44px]"
                  />
                </div>

                {/* Passcode */}
                <div className="space-y-2">
                  <Label htmlFor="passcode">
                    Passcode <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="passcode"
                    type="password"
                    placeholder="Enter controller passcode"
                    value={claimForm.passcode}
                    onChange={(e) =>
                      setClaimForm((prev) => ({ ...prev, passcode: e.target.value }))
                    }
                    required
                    className="min-h-[44px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    The passcode provided with the controller
                  </p>
                </div>

                {/* MOBILE-FRIENDLY: Stacked buttons on mobile */}
                <DialogFooter className="flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setClaimOpen(false)}
                    disabled={claimLoading}
                    className="min-h-[44px] w-full sm:w-auto"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={claimLoading} className="min-h-[44px] w-full sm:w-auto">
                    {claimLoading ? "Claiming..." : "Claim Controller"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Empty State */}
      {controllers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
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
          <h3 className="text-lg font-medium mb-2">No controllers claimed</h3>
          <p className="text-sm">
            {canEdit
              ? "Click \"Claim Controller\" to add your first controller."
              : "No controllers have been claimed for your enterprise yet."}
          </p>
        </div>
      ) : (
        <>
          {/* MOBILE-FRIENDLY: Card view for mobile */}
          <div className="sm:hidden space-y-3">
            {controllers.map((controller) => (
              <div
                key={controller.id}
                className="rounded-lg border bg-card p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{controller.serial_number}</p>
                    <p className="text-sm text-muted-foreground">
                      {controller.approved_hardware?.name || "Unknown model"}
                    </p>
                  </div>
                  <StatusBadge status={controller.status} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-muted-foreground">Connection</p>
                    {(() => {
                      const heartbeat = getControllerHeartbeat(controller.id, controller.last_heartbeat);
                      if (isControllerOnline(heartbeat)) {
                        return (
                          <div className="flex items-center gap-1.5">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                            </span>
                            <span className="text-green-600 font-medium">Online</span>
                          </div>
                        );
                      } else if (heartbeat) {
                        return (
                          <div className="flex items-center gap-1.5">
                            <span className="relative flex h-2 w-2">
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-400"></span>
                            </span>
                            <span className="text-muted-foreground">{formatTimeSince(heartbeat)}</span>
                          </div>
                        );
                      } else {
                        return <span className="text-muted-foreground">—</span>;
                      }
                    })()}
                  </div>
                  <div>
                    <p className="text-muted-foreground">Firmware</p>
                    <p>{controller.firmware_version || "-"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Claimed</p>
                    <p>{formatDate(controller.claimed_at)}</p>
                  </div>
                  {canEdit && (
                    <div>
                      <p className="text-muted-foreground">Enterprise</p>
                      <p>{controller.enterprises?.name || "Unclaimed"}</p>
                    </div>
                  )}
                </div>
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openFirmwareDialog(controller)}
                    className="w-full min-h-[44px]"
                  >
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
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" x2="12" y1="3" y2="15" />
                    </svg>
                    Update Firmware
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: Table view */}
          <div className="hidden sm:block rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Connection</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Hardware</TableHead>
                  {isSuperAdmin && <TableHead>Enterprise</TableHead>}
                  <TableHead>Claimed</TableHead>
                  <TableHead>Firmware</TableHead>
                  {canEdit && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {controllers.map((controller) => (
                  <TableRow key={controller.id}>
                    <TableCell>
                      {/* Connection status with pulse animation for online */}
                      {(() => {
                        const heartbeat = getControllerHeartbeat(controller.id, controller.last_heartbeat);
                        if (isControllerOnline(heartbeat)) {
                          return (
                            <div className="flex items-center gap-2">
                              <span className="relative flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                              </span>
                              <span className="text-sm text-green-600 font-medium">Online</span>
                            </div>
                          );
                        } else if (heartbeat) {
                          return (
                            <div className="flex items-center gap-2">
                              <span className="relative flex h-3 w-3">
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-400"></span>
                              </span>
                              <span className="text-sm text-muted-foreground">
                                {formatTimeSince(heartbeat)}
                              </span>
                            </div>
                          );
                        } else {
                          return <span className="text-sm text-muted-foreground">—</span>;
                        }
                      })()}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={controller.status} />
                    </TableCell>
                    <TableCell>
                      {controller.approved_hardware?.name || (
                        <span className="text-muted-foreground">Unknown</span>
                      )}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        {controller.enterprises?.name || (
                          <span className="text-muted-foreground">Unclaimed</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>{formatDate(controller.claimed_at)}</TableCell>
                    <TableCell>
                      {controller.firmware_version || (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    {canEdit && (
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openFirmwareDialog(controller)}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4 mr-1"
                          >
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" x2="12" y1="3" y2="15" />
                          </svg>
                          Update Firmware
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Firmware Update Dialog - MOBILE-FRIENDLY */}
      <Dialog open={firmwareOpen} onOpenChange={setFirmwareOpen}>
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Update Firmware Version</DialogTitle>
            <DialogDescription>
              {selectedController && (
                <>
                  Update firmware version for controller{" "}
                  <strong>{selectedController.serial_number}</strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleFirmwareUpdate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="firmwareVersion">
                Firmware Version <span className="text-red-500">*</span>
              </Label>
              <Input
                id="firmwareVersion"
                placeholder="e.g., 1.0.2"
                value={newFirmwareVersion}
                onChange={(e) => setNewFirmwareVersion(e.target.value)}
                required
                className="min-h-[44px]"
              />
              <p className="text-xs text-muted-foreground">
                Enter the new firmware version (e.g., 1.0.2)
              </p>
            </div>

            {/* MOBILE-FRIENDLY: Stacked buttons on mobile */}
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFirmwareOpen(false)}
                disabled={firmwareLoading}
                className="min-h-[44px] w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={firmwareLoading} className="min-h-[44px] w-full sm:w-auto">
                {firmwareLoading ? "Updating..." : "Update Version"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
