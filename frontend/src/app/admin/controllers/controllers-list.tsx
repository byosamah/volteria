"use client";

/**
 * Controllers List Component
 *
 * Client component for displaying and managing controllers.
 * Includes create dialog, status management, and passcode display.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

interface Controller {
  id: string;
  serial_number: string;
  status: string;
  firmware_version: string | null;
  passcode: string | null;
  enterprise_id: string | null;
  created_at: string;
  approved_hardware: {
    name: string;
    hardware_type: string;
  } | null;
  enterprises: {
    name: string;
  } | null;
}

interface HardwareType {
  id: string;
  name: string;
  hardware_type: string;
}

interface ControllersListProps {
  controllers: Controller[];
  hardwareTypes: HardwareType[];
}

// Status badge colors
const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  ready: "bg-yellow-100 text-yellow-800",
  deployed: "bg-green-100 text-green-800",
};

export function ControllersList({ controllers: initialControllers, hardwareTypes }: ControllersListProps) {
  const router = useRouter();
  const supabase = createClient();

  const [controllers, setControllers] = useState(initialControllers);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Create form state
  const [formData, setFormData] = useState({
    serial_number: "",
    hardware_type_id: "",
    firmware_version: "",
    notes: "",
  });

  // Filter controllers
  const filteredControllers = controllers.filter((c) => {
    const matchesSearch =
      searchQuery === "" ||
      c.serial_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.approved_hardware?.name.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === "all" || c.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Handle create controller
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!formData.serial_number.trim()) {
        toast.error("Serial number is required");
        setLoading(false);
        return;
      }

      if (!formData.hardware_type_id) {
        toast.error("Hardware type is required");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("controllers")
        .insert({
          serial_number: formData.serial_number.trim(),
          hardware_type_id: formData.hardware_type_id,
          firmware_version: formData.firmware_version.trim() || null,
          notes: formData.notes.trim() || null,
          status: "draft",
        })
        .select(`
          id,
          serial_number,
          status,
          firmware_version,
          passcode,
          enterprise_id,
          created_at,
          approved_hardware:hardware_type_id (
            name,
            hardware_type
          )
        `)
        .single();

      if (error) {
        console.error("Error creating controller:", error);
        if (error.code === "23505") {
          toast.error("Serial number already exists");
        } else {
          toast.error(error.message || "Failed to create controller");
        }
        setLoading(false);
        return;
      }

      toast.success("Controller registered successfully");
      // Add enterprises: null since new controllers aren't assigned to an enterprise yet
      // Supabase returns relations as arrays, extract first element
      const hwData = Array.isArray(data.approved_hardware)
        ? data.approved_hardware[0]
        : data.approved_hardware;
      const newController: Controller = {
        id: data.id,
        serial_number: data.serial_number,
        status: data.status,
        firmware_version: data.firmware_version,
        passcode: data.passcode,
        enterprise_id: data.enterprise_id,
        created_at: data.created_at,
        approved_hardware: hwData || null,
        enterprises: null,
      };
      setControllers([newController, ...controllers]);
      setCreateOpen(false);
      setFormData({
        serial_number: "",
        hardware_type_id: "",
        firmware_version: "",
        notes: "",
      });
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Handle status change
  const handleStatusChange = async (controllerId: string, newStatus: string) => {
    const { data, error } = await supabase
      .from("controllers")
      .update({ status: newStatus })
      .eq("id", controllerId)
      .select("passcode")
      .single();

    if (error) {
      toast.error("Failed to update status");
      return;
    }

    // Update local state
    setControllers(
      controllers.map((c) =>
        c.id === controllerId
          ? { ...c, status: newStatus, passcode: data.passcode }
          : c
      )
    );

    toast.success(`Controller status updated to ${newStatus}`);
    router.refresh();
  };

  // Copy passcode to clipboard
  const copyPasscode = (passcode: string) => {
    navigator.clipboard.writeText(passcode);
    toast.success("Passcode copied to clipboard");
  };

  return (
    <>
      {/* Search and Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <Input
            placeholder="Search by serial number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 min-h-[44px]"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="min-h-[44px] px-3 rounded-md border border-input bg-background"
        >
          <option value="all">All Status</option>
          <option value="draft">Draft</option>
          <option value="ready">Ready</option>
          <option value="deployed">Deployed</option>
        </select>

        <Button onClick={() => setCreateOpen(true)} className="min-h-[44px]">
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
          Register Controller
        </Button>
      </div>

      {/* Controllers Table */}
      {filteredControllers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6 text-muted-foreground"
              >
                <rect width="20" height="14" x="2" y="3" rx="2" />
                <line x1="8" x2="16" y1="21" y2="21" />
                <line x1="12" x2="12" y1="17" y2="21" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">No controllers found</h3>
            <p className="text-muted-foreground text-center max-w-sm">
              {searchQuery || statusFilter !== "all"
                ? "Try adjusting your filters."
                : "Register your first controller to get started."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Serial Number</TableHead>
                <TableHead>Hardware</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Passcode</TableHead>
                <TableHead>Enterprise</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredControllers.map((controller) => (
                <TableRow key={controller.id}>
                  <TableCell className="font-mono font-medium">
                    {controller.serial_number}
                  </TableCell>
                  <TableCell>
                    {controller.approved_hardware?.name || "Unknown"}
                  </TableCell>
                  <TableCell>
                    <Badge className={statusColors[controller.status]}>
                      {controller.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {controller.passcode ? (
                      <div className="flex items-center gap-2">
                        <code className="bg-muted px-2 py-1 rounded text-sm">
                          {controller.passcode}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyPasscode(controller.passcode!)}
                          className="h-8 w-8 p-0"
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
                            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                          </svg>
                        </Button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {controller.enterprises?.name || (
                      <span className="text-muted-foreground">Not claimed</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {controller.status === "draft" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStatusChange(controller.id, "ready")}
                      >
                        Mark Ready
                      </Button>
                    )}
                    {controller.status === "ready" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStatusChange(controller.id, "draft")}
                      >
                        Back to Draft
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Create Controller Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Register Controller</DialogTitle>
            <DialogDescription>
              Add a new controller hardware unit to the system.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="serial_number">
                Serial Number <span className="text-red-500">*</span>
              </Label>
              <Input
                id="serial_number"
                name="serial_number"
                placeholder="e.g., RPI5-2024-001"
                value={formData.serial_number}
                onChange={handleChange}
                className="min-h-[44px] font-mono"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hardware_type_id">
                Hardware Type <span className="text-red-500">*</span>
              </Label>
              <select
                id="hardware_type_id"
                name="hardware_type_id"
                value={formData.hardware_type_id}
                onChange={handleChange}
                className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
                required
              >
                <option value="">Select hardware type...</option>
                {hardwareTypes.map((hw) => (
                  <option key={hw.id} value={hw.id}>
                    {hw.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="firmware_version">Firmware Version</Label>
              <Input
                id="firmware_version"
                name="firmware_version"
                placeholder="e.g., 1.0.0"
                value={formData.firmware_version}
                onChange={handleChange}
                className="min-h-[44px]"
              />
            </div>

            <DialogFooter className="flex-col gap-2 sm:flex-row pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                className="min-h-[44px] w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading} className="min-h-[44px] w-full sm:w-auto">
                {loading ? "Registering..." : "Register Controller"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
