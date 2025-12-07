"use client";

/**
 * Hardware List Component
 *
 * Client component for displaying and managing approved hardware types.
 * Includes create/edit dialog.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { toast } from "sonner";

interface HardwareType {
  id: string;
  hardware_type: string;
  name: string;
  manufacturer: string | null;
  description: string | null;
  features: Record<string, unknown>;
  min_firmware_version: string | null;
  is_active: boolean;
  created_at: string;
}

interface HardwareListProps {
  hardwareTypes: HardwareType[];
}

export function HardwareList({ hardwareTypes: initialHardwareTypes }: HardwareListProps) {
  const router = useRouter();
  const supabase = createClient();

  const [hardwareTypes, setHardwareTypes] = useState(initialHardwareTypes);
  const [createOpen, setCreateOpen] = useState(false);
  const [editHardware, setEditHardware] = useState<HardwareType | null>(null);
  const [loading, setLoading] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    hardware_type: "",
    name: "",
    manufacturer: "",
    description: "",
    min_firmware_version: "",
    // Features
    wifi: true,
    ethernet: true,
    rs485_support: true,
  });

  // Reset form
  const resetForm = () => {
    setFormData({
      hardware_type: "",
      name: "",
      manufacturer: "",
      description: "",
      min_firmware_version: "",
      wifi: true,
      ethernet: true,
      rs485_support: true,
    });
  };

  // Open edit dialog
  const openEditDialog = (hardware: HardwareType) => {
    setEditHardware(hardware);
    setFormData({
      hardware_type: hardware.hardware_type,
      name: hardware.name,
      manufacturer: hardware.manufacturer || "",
      description: hardware.description || "",
      min_firmware_version: hardware.min_firmware_version || "",
      wifi: (hardware.features?.wifi as boolean) ?? true,
      ethernet: (hardware.features?.ethernet as boolean) ?? true,
      rs485_support: (hardware.features?.rs485_support as boolean) ?? true,
    });
  };

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData((prev) => ({ ...prev, [name]: checked }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  // Handle create/edit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!formData.hardware_type.trim()) {
        toast.error("Hardware type ID is required");
        setLoading(false);
        return;
      }

      if (!formData.name.trim()) {
        toast.error("Name is required");
        setLoading(false);
        return;
      }

      const hardwareData = {
        hardware_type: formData.hardware_type.trim(),
        name: formData.name.trim(),
        manufacturer: formData.manufacturer.trim() || null,
        description: formData.description.trim() || null,
        min_firmware_version: formData.min_firmware_version.trim() || null,
        features: {
          wifi: formData.wifi,
          ethernet: formData.ethernet,
          rs485_support: formData.rs485_support,
        },
        is_active: true,
      };

      if (editHardware) {
        // Update existing
        const { error } = await supabase
          .from("approved_hardware")
          .update(hardwareData)
          .eq("id", editHardware.id);

        if (error) {
          toast.error(error.message || "Failed to update hardware");
          setLoading(false);
          return;
        }

        toast.success("Hardware updated successfully");
        setHardwareTypes(
          hardwareTypes.map((h) =>
            h.id === editHardware.id ? { ...h, ...hardwareData } : h
          )
        );
        setEditHardware(null);
      } else {
        // Create new
        const { data, error } = await supabase
          .from("approved_hardware")
          .insert(hardwareData)
          .select()
          .single();

        if (error) {
          if (error.code === "23505") {
            toast.error("Hardware type ID already exists");
          } else {
            toast.error(error.message || "Failed to create hardware");
          }
          setLoading(false);
          return;
        }

        toast.success("Hardware type added successfully");
        setHardwareTypes([...hardwareTypes, data]);
        setCreateOpen(false);
        resetForm();
      }

      router.refresh();
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Toggle active status
  const toggleActive = async (hardware: HardwareType) => {
    const { error } = await supabase
      .from("approved_hardware")
      .update({ is_active: !hardware.is_active })
      .eq("id", hardware.id);

    if (error) {
      toast.error("Failed to update status");
      return;
    }

    setHardwareTypes(
      hardwareTypes.map((h) =>
        h.id === hardware.id ? { ...h, is_active: !h.is_active } : h
      )
    );

    toast.success(
      hardware.is_active ? "Hardware type deactivated" : "Hardware type activated"
    );
  };

  return (
    <>
      {/* Actions */}
      <div className="flex justify-end">
        <Button
          onClick={() => {
            resetForm();
            setCreateOpen(true);
          }}
          className="min-h-[44px]"
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
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          Add Hardware Type
        </Button>
      </div>

      {/* Hardware Grid */}
      {hardwareTypes.length === 0 ? (
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
            <h3 className="text-lg font-semibold mb-2">No hardware types</h3>
            <p className="text-muted-foreground text-center max-w-sm">
              Add your first approved hardware type to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {hardwareTypes.map((hardware) => (
            <Card key={hardware.id} className={!hardware.is_active ? "opacity-60" : ""}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{hardware.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">
                      {hardware.hardware_type}
                    </CardDescription>
                  </div>
                  <Badge variant={hardware.is_active ? "default" : "secondary"}>
                    {hardware.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {hardware.manufacturer && (
                  <p className="text-sm text-muted-foreground">
                    by {hardware.manufacturer}
                  </p>
                )}

                {hardware.description && (
                  <p className="text-sm">{hardware.description}</p>
                )}

                {/* Features */}
                <div className="flex flex-wrap gap-2">
                  {(hardware.features?.wifi as boolean) && (
                    <Badge variant="outline">WiFi</Badge>
                  )}
                  {(hardware.features?.ethernet as boolean) && (
                    <Badge variant="outline">Ethernet</Badge>
                  )}
                  {(hardware.features?.rs485_support as boolean) && (
                    <Badge variant="outline">RS485</Badge>
                  )}
                </div>

                {hardware.min_firmware_version && (
                  <p className="text-xs text-muted-foreground">
                    Min firmware: v{hardware.min_firmware_version}
                  </p>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditDialog(hardware)}
                    className="flex-1"
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleActive(hardware)}
                  >
                    {hardware.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog
        open={createOpen || !!editHardware}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditHardware(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editHardware ? "Edit Hardware Type" : "Add Hardware Type"}
            </DialogTitle>
            <DialogDescription>
              {editHardware
                ? "Update the hardware type configuration."
                : "Add a new approved hardware type for controllers."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="hardware_type">
                Hardware Type ID <span className="text-red-500">*</span>
              </Label>
              <Input
                id="hardware_type"
                name="hardware_type"
                placeholder="e.g., raspberry_pi_5"
                value={formData.hardware_type}
                onChange={handleChange}
                className="min-h-[44px] font-mono"
                disabled={!!editHardware}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">
                Display Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g., Raspberry Pi 5"
                value={formData.name}
                onChange={handleChange}
                className="min-h-[44px]"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="manufacturer">Manufacturer</Label>
              <Input
                id="manufacturer"
                name="manufacturer"
                placeholder="e.g., Raspberry Pi Foundation"
                value={formData.manufacturer}
                onChange={handleChange}
                className="min-h-[44px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                name="description"
                placeholder="Brief description..."
                value={formData.description}
                onChange={handleChange}
                className="min-h-[44px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="min_firmware_version">Minimum Firmware Version</Label>
              <Input
                id="min_firmware_version"
                name="min_firmware_version"
                placeholder="e.g., 1.0.0"
                value={formData.min_firmware_version}
                onChange={handleChange}
                className="min-h-[44px]"
              />
            </div>

            {/* Features checkboxes */}
            <div className="space-y-2">
              <Label>Features</Label>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="wifi"
                    checked={formData.wifi}
                    onChange={handleChange}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">WiFi</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="ethernet"
                    checked={formData.ethernet}
                    onChange={handleChange}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">Ethernet</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="rs485_support"
                    checked={formData.rs485_support}
                    onChange={handleChange}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">RS485 Support</span>
                </label>
              </div>
            </div>

            <DialogFooter className="flex-col gap-2 sm:flex-row pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreateOpen(false);
                  setEditHardware(null);
                  resetForm();
                }}
                className="min-h-[44px] w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading} className="min-h-[44px] w-full sm:w-auto">
                {loading
                  ? editHardware
                    ? "Saving..."
                    : "Adding..."
                  : editHardware
                    ? "Save Changes"
                    : "Add Hardware Type"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
