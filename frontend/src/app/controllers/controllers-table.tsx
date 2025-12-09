"use client";

/**
 * Controllers Table Component
 *
 * Client component that displays:
 * - Table of claimed controllers
 * - Claim new controller dialog
 * - Update firmware dialog
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
}

interface HardwareType {
  id: string;
  hardware_type: string;
  name: string;
  manufacturer: string;
}

interface ControllersTableProps {
  controllers: Controller[];
  hardwareTypes: HardwareType[];
  canEdit: boolean;
  isSuperAdmin: boolean;
  userEnterpriseId: string | null;
}

// Status badge colors
function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    deployed: "default",
    ready: "secondary",
    draft: "outline",
  };

  return (
    <Badge variant={variants[status] || "outline"} className="capitalize">
      {status}
    </Badge>
  );
}

export function ControllersTable({
  controllers,
  hardwareTypes,
  canEdit,
  isSuperAdmin,
  userEnterpriseId,
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
  });

  // Firmware dialog state
  const [firmwareOpen, setFirmwareOpen] = useState(false);
  const [firmwareLoading, setFirmwareLoading] = useState(false);
  const [selectedController, setSelectedController] = useState<Controller | null>(null);
  const [newFirmwareVersion, setNewFirmwareVersion] = useState("");

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

      // If hardware type selected, verify it matches
      if (claimForm.hardwareTypeId && controller.hardware_type_id !== claimForm.hardwareTypeId) {
        toast.error("Controller model doesn't match. Please verify the model selection.");
        setClaimLoading(false);
        return;
      }

      // Get current user for claimed_by
      const { data: { user } } = await supabase.auth.getUser();

      // Claim the controller
      const { error: updateError } = await supabase
        .from("controllers")
        .update({
          enterprise_id: userEnterpriseId,
          claimed_at: new Date().toISOString(),
          claimed_by: user?.id,
          status: "deployed",
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
      setClaimForm({ hardwareTypeId: "", serialNumber: "", passcode: "" });
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
      {/* Actions */}
      {canEdit && (
        <div className="flex justify-end">
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
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Claim a Controller</DialogTitle>
                <DialogDescription>
                  Enter the controller details to claim it for your enterprise.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleClaim} className="space-y-4">
                {/* Model Selection (optional) */}
                <div className="space-y-2">
                  <Label htmlFor="hardwareType">Controller Model (Optional)</Label>
                  <select
                    id="hardwareType"
                    value={claimForm.hardwareTypeId}
                    onChange={(e) =>
                      setClaimForm((prev) => ({ ...prev, hardwareTypeId: e.target.value }))
                    }
                    className="w-full h-10 px-3 rounded-md border border-input bg-background"
                  >
                    <option value="">Any model</option>
                    {hardwareTypes.map((hw) => (
                      <option key={hw.id} value={hw.id}>
                        {hw.manufacturer} {hw.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Select model to verify it matches the controller
                  </p>
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
                  />
                  <p className="text-xs text-muted-foreground">
                    The passcode provided with the controller
                  </p>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setClaimOpen(false)}
                    disabled={claimLoading}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={claimLoading}>
                    {claimLoading ? "Claiming..." : "Claim Controller"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      )}

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
        /* Controllers Table */
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Serial Number</TableHead>
                <TableHead>Model</TableHead>
                {isSuperAdmin && <TableHead>Enterprise</TableHead>}
                <TableHead>Status</TableHead>
                <TableHead>Firmware</TableHead>
                <TableHead>Claimed</TableHead>
                {canEdit && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {controllers.map((controller) => (
                <TableRow key={controller.id}>
                  <TableCell className="font-medium">
                    {controller.serial_number}
                  </TableCell>
                  <TableCell>
                    {controller.approved_hardware ? (
                      <span>
                        {controller.approved_hardware.manufacturer}{" "}
                        {controller.approved_hardware.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Unknown</span>
                    )}
                  </TableCell>
                  {isSuperAdmin && (
                    <TableCell>
                      {controller.enterprises?.name || (
                        <span className="text-muted-foreground">Unclaimed</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    <StatusBadge status={controller.status} />
                  </TableCell>
                  <TableCell>
                    {controller.firmware_version || (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>{formatDate(controller.claimed_at)}</TableCell>
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
      )}

      {/* Firmware Update Dialog */}
      <Dialog open={firmwareOpen} onOpenChange={setFirmwareOpen}>
        <DialogContent>
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
              />
              <p className="text-xs text-muted-foreground">
                Enter the new firmware version (e.g., 1.0.2)
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFirmwareOpen(false)}
                disabled={firmwareLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={firmwareLoading}>
                {firmwareLoading ? "Updating..." : "Update Version"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
