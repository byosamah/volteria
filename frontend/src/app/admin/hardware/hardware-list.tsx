"use client";

/**
 * Hardware List Component
 *
 * Client component for displaying and managing approved hardware types.
 * Includes create/edit dialog with comprehensive specifications in 8 sections:
 * 1. General / Identification
 * 2. Physical / Housing
 * 3. Environmental / Power
 * 4. Processor / Computing
 * 5. Connectivity / Interfaces
 * 6. Expansion / Modules
 * 7. Display / Camera
 * 8. Control / Miscellaneous
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";

// Hardware type interface with all specification fields
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
  // Section 1: General / Identification
  model: string | null;
  brand: string | null;
  base_hardware: string | null;
  country_of_origin: string | null;
  conformity: string | null;
  // Section 2: Physical / Housing
  housing_material: string | null;
  housing_dimensions: string | null;
  weight: string | null;
  ip_rating: string | null;
  // Section 3: Environmental / Power
  operating_temp_range: string | null;
  storage_temp: string | null;
  max_humidity: string | null;
  power_input: string | null;
  power_supply: string | null;
  max_power_consumption: string | null;
  battery: string | null;
  // Section 4: Processor / Computing
  processor: string | null;
  cooling: string | null;
  gpu: string | null;
  memory_ram: string | null;
  storage_spec: string | null;
  // Section 5: Connectivity / Interfaces
  wifi_spec: string | null;
  bluetooth_spec: string | null;
  cellular: string | null;
  antenna: string | null;
  interfaces: string | null;
  usb_ports_spec: string | null;
  ethernet_spec: string | null;
  rs485_spec: string | null;
  can_bus: string | null;
  // Section 6: Expansion / Modules
  pcie: string | null;
  compatible_modules: string | null;
  // Section 7: Display / Camera
  display_output: string | null;
  video_decode: string | null;
  optical_display: string | null;
  camera_interfaces: string | null;
  // Section 8: Control / Miscellaneous
  rtc: string | null;
  power_button: string | null;
  mtbf: string | null;
  emc_spec: string | null;
}

interface HardwareListProps {
  hardwareTypes: HardwareType[];
}

// Initial empty form data
const emptyFormData = {
  hardware_type: "",
  name: "",
  manufacturer: "",
  description: "",
  min_firmware_version: "",
  // Section 1: General
  model: "",
  brand: "",
  base_hardware: "",
  country_of_origin: "",
  conformity: "",
  // Section 2: Physical
  housing_material: "",
  housing_dimensions: "",
  weight: "",
  ip_rating: "",
  // Section 3: Environmental
  operating_temp_range: "",
  storage_temp: "",
  max_humidity: "",
  power_input: "",
  power_supply: "",
  max_power_consumption: "",
  battery: "",
  // Section 4: Processor
  processor: "",
  cooling: "",
  gpu: "",
  memory_ram: "",
  storage_spec: "",
  // Section 5: Connectivity
  wifi_spec: "",
  bluetooth_spec: "",
  cellular: "",
  antenna: "",
  interfaces: "",
  usb_ports_spec: "",
  ethernet_spec: "",
  rs485_spec: "",
  can_bus: "",
  // Section 6: Expansion
  pcie: "",
  compatible_modules: "",
  // Section 7: Display
  display_output: "",
  video_decode: "",
  optical_display: "",
  camera_interfaces: "",
  // Section 8: Control
  rtc: "",
  power_button: "",
  mtbf: "",
  emc_spec: "",
};

// Section header component with collapsible trigger
function SectionHeader({
  title,
  isOpen,
  onToggle
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <CollapsibleTrigger asChild onClick={onToggle}>
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-lg bg-muted/50 px-4 py-3 text-left text-sm font-medium hover:bg-muted transition-colors"
      >
        {title}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </CollapsibleTrigger>
  );
}

// Text input field component for forms
function FormField({
  id,
  label,
  value,
  onChange,
  placeholder,
  required = false,
  disabled = false,
  monospace = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  monospace?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      <Input
        id={id}
        name={id}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className={`min-h-[44px] ${monospace ? "font-mono" : ""}`}
        disabled={disabled}
        required={required}
      />
    </div>
  );
}

export function HardwareList({ hardwareTypes: initialHardwareTypes }: HardwareListProps) {
  const router = useRouter();
  const supabase = createClient();

  const [hardwareTypes, setHardwareTypes] = useState(initialHardwareTypes);
  const [createOpen, setCreateOpen] = useState(false);
  const [editHardware, setEditHardware] = useState<HardwareType | null>(null);
  const [loading, setLoading] = useState(false);

  // Delete state - for super admin hardware deletion
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteHardware, setDeleteHardware] = useState<HardwareType | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

  // Form state
  const [formData, setFormData] = useState(emptyFormData);

  // Section open/close state
  const [openSections, setOpenSections] = useState({
    general: true,
    physical: false,
    environmental: false,
    processor: false,
    connectivity: false,
    expansion: false,
    display: false,
    control: false,
  });

  // Toggle section
  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Reset form
  const resetForm = () => {
    setFormData(emptyFormData);
    setOpenSections({
      general: true,
      physical: false,
      environmental: false,
      processor: false,
      connectivity: false,
      expansion: false,
      display: false,
      control: false,
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
      // Section 1
      model: hardware.model || "",
      brand: hardware.brand || "",
      base_hardware: hardware.base_hardware || "",
      country_of_origin: hardware.country_of_origin || "",
      conformity: hardware.conformity || "",
      // Section 2
      housing_material: hardware.housing_material || "",
      housing_dimensions: hardware.housing_dimensions || "",
      weight: hardware.weight || "",
      ip_rating: hardware.ip_rating || "",
      // Section 3
      operating_temp_range: hardware.operating_temp_range || "",
      storage_temp: hardware.storage_temp || "",
      max_humidity: hardware.max_humidity || "",
      power_input: hardware.power_input || "",
      power_supply: hardware.power_supply || "",
      max_power_consumption: hardware.max_power_consumption || "",
      battery: hardware.battery || "",
      // Section 4
      processor: hardware.processor || "",
      cooling: hardware.cooling || "",
      gpu: hardware.gpu || "",
      memory_ram: hardware.memory_ram || "",
      storage_spec: hardware.storage_spec || "",
      // Section 5
      wifi_spec: hardware.wifi_spec || "",
      bluetooth_spec: hardware.bluetooth_spec || "",
      cellular: hardware.cellular || "",
      antenna: hardware.antenna || "",
      interfaces: hardware.interfaces || "",
      usb_ports_spec: hardware.usb_ports_spec || "",
      ethernet_spec: hardware.ethernet_spec || "",
      rs485_spec: hardware.rs485_spec || "",
      can_bus: hardware.can_bus || "",
      // Section 6
      pcie: hardware.pcie || "",
      compatible_modules: hardware.compatible_modules || "",
      // Section 7
      display_output: hardware.display_output || "",
      video_decode: hardware.video_decode || "",
      optical_display: hardware.optical_display || "",
      camera_interfaces: hardware.camera_interfaces || "",
      // Section 8
      rtc: hardware.rtc || "",
      power_button: hardware.power_button || "",
      mtbf: hardware.mtbf || "",
      emc_spec: hardware.emc_spec || "",
    });
    // Open all sections that have data
    setOpenSections({
      general: true,
      physical: !!(hardware.housing_material || hardware.housing_dimensions || hardware.weight || hardware.ip_rating),
      environmental: !!(hardware.operating_temp_range || hardware.storage_temp || hardware.max_humidity || hardware.power_input || hardware.power_supply || hardware.max_power_consumption || hardware.battery),
      processor: !!(hardware.processor || hardware.cooling || hardware.gpu || hardware.memory_ram || hardware.storage_spec),
      connectivity: !!(hardware.wifi_spec || hardware.bluetooth_spec || hardware.cellular || hardware.antenna || hardware.interfaces || hardware.usb_ports_spec || hardware.ethernet_spec || hardware.rs485_spec || hardware.can_bus),
      expansion: !!(hardware.pcie || hardware.compatible_modules),
      display: !!(hardware.display_output || hardware.video_decode || hardware.optical_display || hardware.camera_interfaces),
      control: !!(hardware.rtc || hardware.power_button || hardware.mtbf || hardware.emc_spec),
    });
  };

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
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
        toast.error("Display name is required");
        setLoading(false);
        return;
      }

      // Build hardware data object with all fields
      const hardwareData = {
        hardware_type: formData.hardware_type.trim(),
        name: formData.name.trim(),
        manufacturer: formData.manufacturer.trim() || null,
        description: formData.description.trim() || null,
        min_firmware_version: formData.min_firmware_version.trim() || null,
        // Section 1
        model: formData.model.trim() || null,
        brand: formData.brand.trim() || null,
        base_hardware: formData.base_hardware.trim() || null,
        country_of_origin: formData.country_of_origin.trim() || null,
        conformity: formData.conformity.trim() || null,
        // Section 2
        housing_material: formData.housing_material.trim() || null,
        housing_dimensions: formData.housing_dimensions.trim() || null,
        weight: formData.weight.trim() || null,
        ip_rating: formData.ip_rating.trim() || null,
        // Section 3
        operating_temp_range: formData.operating_temp_range.trim() || null,
        storage_temp: formData.storage_temp.trim() || null,
        max_humidity: formData.max_humidity.trim() || null,
        power_input: formData.power_input.trim() || null,
        power_supply: formData.power_supply.trim() || null,
        max_power_consumption: formData.max_power_consumption.trim() || null,
        battery: formData.battery.trim() || null,
        // Section 4
        processor: formData.processor.trim() || null,
        cooling: formData.cooling.trim() || null,
        gpu: formData.gpu.trim() || null,
        memory_ram: formData.memory_ram.trim() || null,
        storage_spec: formData.storage_spec.trim() || null,
        // Section 5
        wifi_spec: formData.wifi_spec.trim() || null,
        bluetooth_spec: formData.bluetooth_spec.trim() || null,
        cellular: formData.cellular.trim() || null,
        antenna: formData.antenna.trim() || null,
        interfaces: formData.interfaces.trim() || null,
        usb_ports_spec: formData.usb_ports_spec.trim() || null,
        ethernet_spec: formData.ethernet_spec.trim() || null,
        rs485_spec: formData.rs485_spec.trim() || null,
        can_bus: formData.can_bus.trim() || null,
        // Section 6
        pcie: formData.pcie.trim() || null,
        compatible_modules: formData.compatible_modules.trim() || null,
        // Section 7
        display_output: formData.display_output.trim() || null,
        video_decode: formData.video_decode.trim() || null,
        optical_display: formData.optical_display.trim() || null,
        camera_interfaces: formData.camera_interfaces.trim() || null,
        // Section 8
        rtc: formData.rtc.trim() || null,
        power_button: formData.power_button.trim() || null,
        mtbf: formData.mtbf.trim() || null,
        emc_spec: formData.emc_spec.trim() || null,
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

  // Open delete dialog
  const openDeleteDialog = (hardware: HardwareType) => {
    setDeleteHardware(hardware);
    setDeletePassword("");
    setDeleteConfirmName("");
    setDeleteOpen(true);
  };

  // Handle hardware deletion
  const handleDeleteHardware = async () => {
    if (!deleteHardware || !deletePassword) return;

    // Require typing hardware name to confirm
    if (deleteConfirmName !== deleteHardware.name) {
      toast.error("Hardware name does not match");
      return;
    }

    setDeleteLoading(true);

    try {
      // Get current user email for password verification
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        toast.error("Unable to verify user");
        setDeleteLoading(false);
        return;
      }

      // Verify password first
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: deletePassword,
      });

      if (authError) {
        toast.error("Incorrect password");
        setDeleteLoading(false);
        return;
      }

      // Check if hardware is in use by any controllers
      const { data: controllers } = await supabase
        .from("controllers_master")
        .select("id, serial_number")
        .eq("hardware_type_id", deleteHardware.id)
        .limit(1);

      if (controllers && controllers.length > 0) {
        toast.error("Cannot delete: Hardware is in use by controllers");
        setDeleteLoading(false);
        return;
      }

      // Delete hardware from database
      const { error } = await supabase
        .from("approved_hardware")
        .delete()
        .eq("id", deleteHardware.id);

      if (error) throw error;

      toast.success("Hardware deleted successfully");

      // Optimistic UI update - remove from local state
      setHardwareTypes(prevHardware =>
        prevHardware.filter(h => h.id !== deleteHardware.id)
      );

      // Close dialog and reset state
      setDeleteOpen(false);
      setDeleteHardware(null);
      setDeletePassword("");
      setDeleteConfirmName("");

      router.refresh();
    } catch (err) {
      console.error("Delete error:", err);
      toast.error("Failed to delete hardware");
    } finally {
      setDeleteLoading(false);
    }
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

                {hardware.model && (
                  <p className="text-sm">Model: {hardware.model}</p>
                )}

                {hardware.description && (
                  <p className="text-sm text-muted-foreground">{hardware.description}</p>
                )}

                {/* Key specs badges */}
                <div className="flex flex-wrap gap-2">
                  {hardware.processor && (
                    <Badge variant="outline" className="text-xs">CPU</Badge>
                  )}
                  {hardware.wifi_spec && (
                    <Badge variant="outline" className="text-xs">WiFi</Badge>
                  )}
                  {hardware.ethernet_spec && (
                    <Badge variant="outline" className="text-xs">Ethernet</Badge>
                  )}
                  {hardware.rs485_spec && (
                    <Badge variant="outline" className="text-xs">RS485</Badge>
                  )}
                  {hardware.can_bus && (
                    <Badge variant="outline" className="text-xs">CAN</Badge>
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
                  {/* Delete button - shows red trash icon */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => openDeleteDialog(hardware)}
                    title="Delete hardware"
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
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editHardware ? "Edit Hardware Type" : "Add Hardware Type"}
            </DialogTitle>
            <DialogDescription>
              {editHardware
                ? "Update the hardware type specifications."
                : "Add a new approved hardware type with detailed specifications."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            {/* Hardware Type ID - Always visible */}
            <div className="space-y-1.5">
              <Label htmlFor="hardware_type" className="text-xs">
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

            {/* Section 1: General / Identification */}
            <Collapsible open={openSections.general}>
              <SectionHeader
                title="General / Identification"
                isOpen={openSections.general}
                onToggle={() => toggleSection("general")}
              />
              <CollapsibleContent className="pt-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    id="name"
                    label="Display Name"
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="e.g., Raspberry Pi 5"
                    required
                  />
                  <FormField
                    id="model"
                    label="Model"
                    value={formData.model}
                    onChange={handleChange}
                    placeholder="e.g., Model B"
                  />
                  <FormField
                    id="brand"
                    label="Brand"
                    value={formData.brand}
                    onChange={handleChange}
                    placeholder="e.g., Raspberry Pi"
                  />
                  <FormField
                    id="base_hardware"
                    label="Base Hardware"
                    value={formData.base_hardware}
                    onChange={handleChange}
                    placeholder="e.g., BCM2712"
                  />
                  <FormField
                    id="manufacturer"
                    label="Manufacturer"
                    value={formData.manufacturer}
                    onChange={handleChange}
                    placeholder="e.g., Raspberry Pi Foundation"
                  />
                  <FormField
                    id="country_of_origin"
                    label="Country of Origin"
                    value={formData.country_of_origin}
                    onChange={handleChange}
                    placeholder="e.g., United Kingdom"
                  />
                  <FormField
                    id="description"
                    label="Description"
                    value={formData.description}
                    onChange={handleChange}
                    placeholder="Brief description..."
                  />
                  <FormField
                    id="conformity"
                    label="Conformity"
                    value={formData.conformity}
                    onChange={handleChange}
                    placeholder="e.g., CE, FCC, RoHS"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Section 2: Physical / Housing */}
            <Collapsible open={openSections.physical}>
              <SectionHeader
                title="Physical / Housing"
                isOpen={openSections.physical}
                onToggle={() => toggleSection("physical")}
              />
              <CollapsibleContent className="pt-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    id="housing_material"
                    label="Case (Housing Material)"
                    value={formData.housing_material}
                    onChange={handleChange}
                    placeholder="e.g., Aluminum, Plastic"
                  />
                  <FormField
                    id="housing_dimensions"
                    label="Housing Dimensions"
                    value={formData.housing_dimensions}
                    onChange={handleChange}
                    placeholder="e.g., 85 x 56 x 17 mm"
                  />
                  <FormField
                    id="weight"
                    label="Weight"
                    value={formData.weight}
                    onChange={handleChange}
                    placeholder="e.g., 46g"
                  />
                  <FormField
                    id="ip_rating"
                    label="IP Rating / Protection Class"
                    value={formData.ip_rating}
                    onChange={handleChange}
                    placeholder="e.g., IP65"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Section 3: Environmental / Power */}
            <Collapsible open={openSections.environmental}>
              <SectionHeader
                title="Environmental / Power"
                isOpen={openSections.environmental}
                onToggle={() => toggleSection("environmental")}
              />
              <CollapsibleContent className="pt-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    id="operating_temp_range"
                    label="Operating Temperature Range"
                    value={formData.operating_temp_range}
                    onChange={handleChange}
                    placeholder="e.g., 0°C to 60°C"
                  />
                  <FormField
                    id="storage_temp"
                    label="Storage Temperature"
                    value={formData.storage_temp}
                    onChange={handleChange}
                    placeholder="e.g., -20°C to 70°C"
                  />
                  <FormField
                    id="max_humidity"
                    label="Maximum Relative Humidity"
                    value={formData.max_humidity}
                    onChange={handleChange}
                    placeholder="e.g., 85% non-condensing"
                  />
                  <FormField
                    id="power_input"
                    label="Power Input"
                    value={formData.power_input}
                    onChange={handleChange}
                    placeholder="e.g., 5V/5A USB-C"
                  />
                  <FormField
                    id="power_supply"
                    label="Power Supply"
                    value={formData.power_supply}
                    onChange={handleChange}
                    placeholder="e.g., USB-C PD"
                  />
                  <FormField
                    id="max_power_consumption"
                    label="Maximum Power Consumption"
                    value={formData.max_power_consumption}
                    onChange={handleChange}
                    placeholder="e.g., 25W"
                  />
                  <FormField
                    id="battery"
                    label="Battery"
                    value={formData.battery}
                    onChange={handleChange}
                    placeholder="e.g., External RTC battery"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Section 4: Processor / Computing */}
            <Collapsible open={openSections.processor}>
              <SectionHeader
                title="Processor / Computing"
                isOpen={openSections.processor}
                onToggle={() => toggleSection("processor")}
              />
              <CollapsibleContent className="pt-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    id="processor"
                    label="Processor"
                    value={formData.processor}
                    onChange={handleChange}
                    placeholder="e.g., BCM2712 2.4GHz quad-core"
                  />
                  <FormField
                    id="cooling"
                    label="Cooling"
                    value={formData.cooling}
                    onChange={handleChange}
                    placeholder="e.g., Active fan, Passive heatsink"
                  />
                  <FormField
                    id="gpu"
                    label="GPU"
                    value={formData.gpu}
                    onChange={handleChange}
                    placeholder="e.g., VideoCore VII"
                  />
                  <FormField
                    id="memory_ram"
                    label="Memory/RAM"
                    value={formData.memory_ram}
                    onChange={handleChange}
                    placeholder="e.g., 1/2/4/8GB LPDDR4X"
                  />
                  <FormField
                    id="storage_spec"
                    label="Storage (size/compatibility)"
                    value={formData.storage_spec}
                    onChange={handleChange}
                    placeholder="e.g., microSD, NVMe via HAT"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Section 5: Connectivity / Interfaces */}
            <Collapsible open={openSections.connectivity}>
              <SectionHeader
                title="Connectivity / Interfaces"
                isOpen={openSections.connectivity}
                onToggle={() => toggleSection("connectivity")}
              />
              <CollapsibleContent className="pt-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    id="wifi_spec"
                    label="Wi-Fi"
                    value={formData.wifi_spec}
                    onChange={handleChange}
                    placeholder="e.g., 802.11ac dual-band"
                  />
                  <FormField
                    id="bluetooth_spec"
                    label="Bluetooth"
                    value={formData.bluetooth_spec}
                    onChange={handleChange}
                    placeholder="e.g., Bluetooth 5.0 / BLE"
                  />
                  <FormField
                    id="cellular"
                    label="Cellular Connectivity"
                    value={formData.cellular}
                    onChange={handleChange}
                    placeholder="e.g., 4G LTE via HAT"
                  />
                  <FormField
                    id="antenna"
                    label="Antenna"
                    value={formData.antenna}
                    onChange={handleChange}
                    placeholder="e.g., Onboard, External SMA"
                  />
                  <FormField
                    id="interfaces"
                    label="Interfaces / Connectors"
                    value={formData.interfaces}
                    onChange={handleChange}
                    placeholder="e.g., 40-pin GPIO header"
                  />
                  <FormField
                    id="usb_ports_spec"
                    label="USB Ports"
                    value={formData.usb_ports_spec}
                    onChange={handleChange}
                    placeholder="e.g., 2x USB 3.0, 2x USB 2.0"
                  />
                  <FormField
                    id="ethernet_spec"
                    label="Ethernet"
                    value={formData.ethernet_spec}
                    onChange={handleChange}
                    placeholder="e.g., Gigabit Ethernet, PoE+"
                  />
                  <FormField
                    id="rs485_spec"
                    label="RS485"
                    value={formData.rs485_spec}
                    onChange={handleChange}
                    placeholder="e.g., Via GPIO / HAT"
                  />
                  <FormField
                    id="can_bus"
                    label="CAN"
                    value={formData.can_bus}
                    onChange={handleChange}
                    placeholder="e.g., Via MCP2515 HAT"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Section 6: Expansion / Modules */}
            <Collapsible open={openSections.expansion}>
              <SectionHeader
                title="Expansion / Modules"
                isOpen={openSections.expansion}
                onToggle={() => toggleSection("expansion")}
              />
              <CollapsibleContent className="pt-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    id="pcie"
                    label="PCIe"
                    value={formData.pcie}
                    onChange={handleChange}
                    placeholder="e.g., PCIe 2.0 x1"
                  />
                  <FormField
                    id="compatible_modules"
                    label="Compatible Modules"
                    value={formData.compatible_modules}
                    onChange={handleChange}
                    placeholder="e.g., HATs, NVMe adapters"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Section 7: Display / Camera */}
            <Collapsible open={openSections.display}>
              <SectionHeader
                title="Display / Camera"
                isOpen={openSections.display}
                onToggle={() => toggleSection("display")}
              />
              <CollapsibleContent className="pt-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    id="display_output"
                    label="Display Output"
                    value={formData.display_output}
                    onChange={handleChange}
                    placeholder="e.g., Dual 4Kp60 HDMI"
                  />
                  <FormField
                    id="video_decode"
                    label="Video Decode"
                    value={formData.video_decode}
                    onChange={handleChange}
                    placeholder="e.g., 4Kp60 HEVC"
                  />
                  <FormField
                    id="optical_display"
                    label="Optical Display"
                    value={formData.optical_display}
                    onChange={handleChange}
                    placeholder="e.g., DSI connector"
                  />
                  <FormField
                    id="camera_interfaces"
                    label="Camera Interfaces"
                    value={formData.camera_interfaces}
                    onChange={handleChange}
                    placeholder="e.g., 2x 4-lane MIPI CSI"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Section 8: Control / Miscellaneous */}
            <Collapsible open={openSections.control}>
              <SectionHeader
                title="Control / Miscellaneous"
                isOpen={openSections.control}
                onToggle={() => toggleSection("control")}
              />
              <CollapsibleContent className="pt-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    id="rtc"
                    label="RTC"
                    value={formData.rtc}
                    onChange={handleChange}
                    placeholder="e.g., External battery backed"
                  />
                  <FormField
                    id="power_button"
                    label="Power Button"
                    value={formData.power_button}
                    onChange={handleChange}
                    placeholder="e.g., Yes, onboard"
                  />
                  <FormField
                    id="mtbf"
                    label="MTBF"
                    value={formData.mtbf}
                    onChange={handleChange}
                    placeholder="e.g., 93,800 hours"
                  />
                  <FormField
                    id="emc_spec"
                    label="EMC Interference/Immunity"
                    value={formData.emc_spec}
                    onChange={handleChange}
                    placeholder="e.g., EN 55032, EN 55035"
                  />
                  <FormField
                    id="min_firmware_version"
                    label="Minimum Firmware Version"
                    value={formData.min_firmware_version}
                    onChange={handleChange}
                    placeholder="e.g., 1.0.0"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

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

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              {/* Warning triangle icon */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              Delete Hardware Type
            </DialogTitle>
          </DialogHeader>

          {/* Warning banner */}
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4 space-y-2">
            <p className="font-medium text-red-800 dark:text-red-200">
              This action cannot be undone!
            </p>
            <p className="text-sm text-red-700 dark:text-red-300">
              Deleting this hardware type will:
            </p>
            <ul className="text-sm text-red-700 dark:text-red-300 list-disc list-inside space-y-1">
              <li>Remove it from the approved hardware list</li>
              <li>Prevent new controllers from using this type</li>
              <li>This hardware type will be permanently deleted</li>
            </ul>
          </div>

          {/* Hardware info */}
          {deleteHardware && (
            <div className="bg-muted rounded-lg p-3">
              <p className="font-medium">{deleteHardware.name}</p>
              <p className="text-sm text-muted-foreground font-mono">
                {deleteHardware.hardware_type}
              </p>
              {deleteHardware.manufacturer && (
                <p className="text-sm text-muted-foreground">
                  by {deleteHardware.manufacturer}
                </p>
              )}
            </div>
          )}

          {/* Type hardware name to confirm */}
          <div className="space-y-2">
            <Label htmlFor="delete-confirm-name" className="text-sm">
              Type <span className="font-semibold">&quot;{deleteHardware?.name}&quot;</span> to confirm:
            </Label>
            <Input
              id="delete-confirm-name"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder="Hardware name"
              className="min-h-[44px]"
            />
          </div>

          {/* Password verification */}
          <div className="space-y-2">
            <Label htmlFor="delete-password" className="text-sm">
              Your password:
            </Label>
            <Input
              id="delete-password"
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="Enter your password to confirm"
              className="min-h-[44px]"
            />
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteOpen(false);
                setDeleteHardware(null);
                setDeletePassword("");
                setDeleteConfirmName("");
              }}
              className="min-h-[44px] w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteHardware}
              disabled={
                deleteLoading ||
                !deletePassword ||
                deleteConfirmName !== deleteHardware?.name
              }
              className="min-h-[44px] w-full sm:w-auto"
            >
              {deleteLoading ? "Deleting..." : "Delete Hardware"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
