"use client";

/**
 * Master Device Template Form Component
 *
 * Dialog form for creating/editing controller templates (Master Devices).
 * Features:
 * - Basic info: template_id, name, description, controller_type, brand, model
 * - Template type: public (super_admin/backend_admin) or custom (auto for others)
 * - Calculated Fields table with storage_mode (Log/Viz Only)
 * - Controller Readings table with storage_mode (Log/Viz Only)
 */

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { ControllerTemplate, SystemRegister } from "@/lib/types";
import { CONTROLLER_CALCULATED_FIELDS, CONTROLLER_READINGS } from "./master-device-templates-list";

// =============================================================================
// TYPES
// =============================================================================

interface MasterDeviceTemplateFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: ControllerTemplate | null;
  userRole?: string;
  userEnterpriseId?: string | null;
  onSuccess: (template: ControllerTemplate) => void;
}

// Hardware option from approved_hardware table
interface HardwareOption {
  id: string;
  name: string;
  brand: string;
  model: string;
  hardware_type: string;
  is_active: boolean;
}

// Enterprise option for custom templates
interface EnterpriseOption {
  id: string;
  name: string;
}

// =============================================================================
// HELPER: Generate unique numeric template ID
// Uses timestamp + random digits for uniqueness
// =============================================================================
function generateNumericTemplateId(): string {
  const timestamp = Date.now().toString().slice(-8); // Last 8 digits of timestamp
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `${timestamp}${random}`;
}

// Storage mode for calculated fields and readings
type StorageMode = "log" | "viz_only";

// Field selection with storage mode
interface FieldSelection {
  field_id: string;
  name: string;
  storage_mode: StorageMode;
  enabled: boolean;
}

// Form data interface
// Note: template_id is auto-generated for new templates
// Note: brand and model are read-only (auto-populated from hardware)
interface FormData {
  name: string;
  description: string;
  hardware_id: string; // ID from approved_hardware table
  template_type: "public" | "custom";
  enterprise_id: string; // For custom templates
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Check if user can create PUBLIC templates
function canCreatePublicTemplate(role?: string): boolean {
  if (!role) return false;
  return ["super_admin", "backend_admin"].includes(role);
}

// Check if user can change enterprise selection
// Only super_admin and backend_admin can change it; others see it auto-selected
function canChangeEnterprise(role?: string): boolean {
  if (!role) return false;
  return ["super_admin", "backend_admin"].includes(role);
}

// =============================================================================
// COMPONENT
// =============================================================================

export function MasterDeviceTemplateForm({
  open,
  onOpenChange,
  template,
  userRole,
  userEnterpriseId,
  onSuccess,
}: MasterDeviceTemplateFormProps) {
  const isEditing = !!template;

  // Form state
  // Note: template_id is auto-generated, brand/model are read-only from hardware
  const [formData, setFormData] = useState<FormData>({
    name: "",
    description: "",
    hardware_id: "",
    template_type: canCreatePublicTemplate(userRole) ? "public" : "custom",
    enterprise_id: userEnterpriseId || "",
  });

  // Hardware options from approved_hardware table
  const [hardwareOptions, setHardwareOptions] = useState<HardwareOption[]>([]);
  const [isLoadingHardware, setIsLoadingHardware] = useState(false);

  // Enterprise options for custom templates
  const [enterpriseOptions, setEnterpriseOptions] = useState<EnterpriseOption[]>([]);
  const [isLoadingEnterprises, setIsLoadingEnterprises] = useState(false);

  // Get selected hardware details (for displaying brand/model)
  const selectedHardware = hardwareOptions.find((h) => h.id === formData.hardware_id);

  // Calculated fields selection
  const [calculatedFields, setCalculatedFields] = useState<FieldSelection[]>(
    CONTROLLER_CALCULATED_FIELDS.map((field) => ({
      field_id: field.field_id,
      name: field.name,
      storage_mode: "log" as StorageMode,
      enabled: false,
    }))
  );

  // Controller readings selection
  const [controllerReadings, setControllerReadings] = useState<FieldSelection[]>(
    CONTROLLER_READINGS.map((field) => ({
      field_id: field.field_id,
      name: field.name,
      storage_mode: "log" as StorageMode,
      enabled: false,
    }))
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch hardware options when dialog opens
  useEffect(() => {
    if (!open) return;

    const fetchHardwareOptions = async () => {
      setIsLoadingHardware(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("approved_hardware")
          .select("id, name, brand, model, hardware_type, is_active")
          .order("name");

        if (error) throw error;
        setHardwareOptions(data || []);
      } catch (error) {
        console.error("Error fetching hardware options:", error);
        toast.error("Failed to load hardware options");
      } finally {
        setIsLoadingHardware(false);
      }
    };

    fetchHardwareOptions();
  }, [open]);

  // Fetch enterprise options when dialog opens (for custom templates)
  useEffect(() => {
    if (!open) return;

    const fetchEnterpriseOptions = async () => {
      setIsLoadingEnterprises(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("enterprises")
          .select("id, name")
          .order("name");

        if (error) throw error;
        setEnterpriseOptions(data || []);
      } catch (error) {
        console.error("Error fetching enterprise options:", error);
        toast.error("Failed to load enterprise options");
      } finally {
        setIsLoadingEnterprises(false);
      }
    };

    fetchEnterpriseOptions();
  }, [open]);

  // Reset form when dialog opens or template changes
  useEffect(() => {
    if (open) {
      if (template) {
        // Edit mode - populate with existing data
        // Note: template_id is kept from original template (not editable)
        // Note: brand/model are read from hardware selection, not stored in form
        setFormData({
          name: template.name,
          description: template.description || "",
          hardware_id: template.hardware_type_id || "",
          template_type: template.template_type,
          enterprise_id: template.enterprise_id || "",
        });

        // Parse calculated fields from template
        // The template stores calculated_fields as an array of field configurations
        // Format: [{ field_id: string, name: string, storage_mode: "log" | "viz_only" }]
        const templateCalcFields = template.calculated_fields || [];
        setCalculatedFields(
          CONTROLLER_CALCULATED_FIELDS.map((field) => {
            // Find if this field exists in template's calculated_fields
            const existing = Array.isArray(templateCalcFields)
              ? templateCalcFields.find((f: unknown) => {
                  if (typeof f === "string") return f === field.field_id;
                  if (typeof f === "object" && f !== null) {
                    return (f as { field_id?: string }).field_id === field.field_id;
                  }
                  return false;
                })
              : null;

            if (existing && typeof existing === "object") {
              return {
                field_id: field.field_id,
                name: field.name,
                storage_mode: (existing as { storage_mode?: StorageMode }).storage_mode || "log",
                enabled: true,
              };
            } else if (typeof existing === "string") {
              return {
                field_id: field.field_id,
                name: field.name,
                storage_mode: "log" as StorageMode,
                enabled: true,
              };
            }
            return {
              field_id: field.field_id,
              name: field.name,
              storage_mode: "log" as StorageMode,
              enabled: false,
            };
          })
        );

        // Parse controller readings from template registers
        const templateRegisters = template.registers || [];
        setControllerReadings(
          CONTROLLER_READINGS.map((field) => {
            const existing = templateRegisters.find((r) => r.field === field.field_id);
            if (existing) {
              // Determine storage_mode from register data
              // If register has logging_frequency or similar, it's "log"
              return {
                field_id: field.field_id,
                name: field.name,
                storage_mode: "log" as StorageMode, // Default to log for existing
                enabled: true,
              };
            }
            return {
              field_id: field.field_id,
              name: field.name,
              storage_mode: "log" as StorageMode,
              enabled: false,
            };
          })
        );
      } else {
        // Create mode - reset to defaults
        // Note: template_id will be auto-generated on submit
        // Note: brand/model will be auto-populated from hardware selection
        setFormData({
          name: "",
          description: "",
          hardware_id: "",
          template_type: canCreatePublicTemplate(userRole) ? "public" : "custom",
          enterprise_id: userEnterpriseId || "",
        });
        setCalculatedFields(
          CONTROLLER_CALCULATED_FIELDS.map((field) => ({
            field_id: field.field_id,
            name: field.name,
            storage_mode: "log" as StorageMode,
            enabled: false,
          }))
        );
        setControllerReadings(
          CONTROLLER_READINGS.map((field) => ({
            field_id: field.field_id,
            name: field.name,
            storage_mode: "log" as StorageMode,
            enabled: false,
          }))
        );
      }
    }
  }, [open, template, userRole, userEnterpriseId]);

  // Handle form submission
  const handleSubmit = async () => {
    // Validation
    if (!formData.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!formData.hardware_id) {
      toast.error("Please select a hardware type");
      return;
    }
    // For custom templates, enterprise is required
    if (formData.template_type === "custom" && !formData.enterprise_id) {
      toast.error("Please select an enterprise for custom templates");
      return;
    }

    // Get selected hardware details for brand/model
    const hardware = hardwareOptions.find((h) => h.id === formData.hardware_id);
    if (!hardware) {
      toast.error("Invalid hardware selection");
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createClient();

      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Build calculated_fields array with storage_mode
      const selectedCalculatedFields = calculatedFields
        .filter((f) => f.enabled)
        .map((f) => ({
          field_id: f.field_id,
          name: f.name,
          storage_mode: f.storage_mode,
        }));

      // Build registers array from selected readings
      const selectedRegisters: SystemRegister[] = controllerReadings
        .filter((f) => f.enabled)
        .map((f) => {
          const original = CONTROLLER_READINGS.find((r) => r.field_id === f.field_id);
          return {
            name: f.name,
            source: original?.source || "device_info",
            field: f.field_id,
            unit: original?.unit || "",
            description: f.name,
            // Note: storage_mode would be added to register schema if needed
          };
        });

      // Generate template_id for new templates, keep existing for edits
      const templateId = isEditing && template
        ? template.template_id
        : generateNumericTemplateId();

      // Derive controller_type from hardware_type
      // Map hardware types to controller types
      const controllerType = hardware.hardware_type === "plc"
        ? "plc"
        : hardware.hardware_type === "gateway"
        ? "gateway"
        : "raspberry_pi"; // Default for controller variants

      // Prepare template data
      const templateData = {
        template_id: templateId,
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        controller_type: controllerType,
        hardware_type_id: formData.hardware_id, // Link to approved_hardware table
        brand: hardware.brand, // Auto-populated from hardware
        model: hardware.model, // Auto-populated from hardware
        template_type: formData.template_type,
        // For custom templates, set enterprise_id from form
        enterprise_id:
          formData.template_type === "custom" ? formData.enterprise_id : null,
        // Set created_by for new templates
        created_by: isEditing ? template?.created_by : user?.id,
        registers: selectedRegisters,
        calculated_fields: selectedCalculatedFields,
        alarm_definitions: template?.alarm_definitions || [],
        is_active: true,
      };

      if (isEditing && template) {
        // Update existing template
        const { data, error } = await supabase
          .from("controller_templates")
          .update({
            ...templateData,
            updated_at: new Date().toISOString(),
          })
          .eq("id", template.id)
          .select()
          .single();

        if (error) throw error;
        onSuccess(data as ControllerTemplate);
      } else {
        // Create new template
        const { data, error } = await supabase
          .from("controller_templates")
          .insert(templateData)
          .select()
          .single();

        if (error) throw error;
        onSuccess(data as ControllerTemplate);
      }
    } catch (error) {
      console.error("Error saving template:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to save template";
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle a calculated field
  const toggleCalculatedField = (field_id: string) => {
    setCalculatedFields((prev) =>
      prev.map((f) =>
        f.field_id === field_id ? { ...f, enabled: !f.enabled } : f
      )
    );
  };

  // Update storage mode for a calculated field
  const updateCalculatedFieldMode = (field_id: string, mode: StorageMode) => {
    setCalculatedFields((prev) =>
      prev.map((f) =>
        f.field_id === field_id ? { ...f, storage_mode: mode } : f
      )
    );
  };

  // Toggle a controller reading
  const toggleControllerReading = (field_id: string) => {
    setControllerReadings((prev) =>
      prev.map((f) =>
        f.field_id === field_id ? { ...f, enabled: !f.enabled } : f
      )
    );
  };

  // Update storage mode for a controller reading
  const updateControllerReadingMode = (field_id: string, mode: StorageMode) => {
    setControllerReadings((prev) =>
      prev.map((f) =>
        f.field_id === field_id ? { ...f, storage_mode: mode } : f
      )
    );
  };

  // Get counts
  const enabledCalculatedCount = calculatedFields.filter((f) => f.enabled).length;
  const enabledReadingsCount = controllerReadings.filter((f) => f.enabled).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Master Device Template" : "Create Master Device Template"}
          </DialogTitle>
          <DialogDescription>
            Configure a controller template with calculated fields and health metrics.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Basic Info Section */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
              Basic Information
            </h3>

            {/* Row 1: Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="e.g., Controller X"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            {/* Row 2: Template Type + Enterprise (for custom) */}
            <div className="grid grid-cols-2 gap-4">
              {/* Template Type - only for super_admin/backend_admin */}
              <div className="space-y-2">
                <Label htmlFor="template_type">Template Type *</Label>
                {canCreatePublicTemplate(userRole) ? (
                  <Select
                    value={formData.template_type}
                    onValueChange={(value: "public" | "custom") =>
                      setFormData({ ...formData, template_type: value })
                    }
                  >
                    <SelectTrigger id="template_type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-500" />
                          Public
                        </span>
                      </SelectItem>
                      <SelectItem value="custom">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-blue-500" />
                          Custom
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex items-center gap-2 h-10 px-3 rounded-md border bg-muted/50">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-sm">Custom</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      (Your Enterprise)
                    </span>
                  </div>
                )}
              </div>

              {/* Enterprise - shown when template_type is "custom" */}
              {formData.template_type === "custom" && (
                <div className="space-y-2">
                  <Label htmlFor="enterprise_id">Enterprise *</Label>
                  {canChangeEnterprise(userRole) ? (
                    // Super admin / backend admin can select any enterprise
                    <Select
                      value={formData.enterprise_id}
                      onValueChange={(value) =>
                        setFormData({ ...formData, enterprise_id: value })
                      }
                      disabled={isLoadingEnterprises}
                    >
                      <SelectTrigger id="enterprise_id">
                        <SelectValue placeholder={isLoadingEnterprises ? "Loading..." : "Select enterprise"} />
                      </SelectTrigger>
                      <SelectContent>
                        {enterpriseOptions.map((enterprise) => (
                          <SelectItem key={enterprise.id} value={enterprise.id}>
                            {enterprise.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    // Enterprise users see their enterprise (read-only)
                    <div className="flex items-center gap-2 h-10 px-3 rounded-md border bg-muted/50">
                      <span className="text-sm">
                        {enterpriseOptions.find((e) => e.id === formData.enterprise_id)?.name || "Your Enterprise"}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Row 3: Hardware ID */}
            <div className="space-y-2">
              <Label htmlFor="hardware_id">Hardware *</Label>
              <Select
                value={formData.hardware_id}
                onValueChange={(value) =>
                  setFormData({ ...formData, hardware_id: value })
                }
                disabled={isLoadingHardware}
              >
                <SelectTrigger id="hardware_id">
                  <SelectValue placeholder={isLoadingHardware ? "Loading..." : "Select hardware"} />
                </SelectTrigger>
                <SelectContent>
                  {hardwareOptions.map((hardware) => (
                    <SelectItem key={hardware.id} value={hardware.id}>
                      <span className="flex items-center gap-2">
                        {hardware.name}
                        {!hardware.is_active && (
                          <span className="text-xs text-muted-foreground">(inactive)</span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Select the hardware type for this controller template
              </p>
            </div>

            {/* Row 4: Brand & Model (read-only, auto-populated from hardware) */}
            <div className="grid grid-cols-2 gap-4">
              {/* Brand - Read-only */}
              <div className="space-y-2">
                <Label htmlFor="brand">Brand</Label>
                <Input
                  id="brand"
                  value={selectedHardware?.brand || ""}
                  disabled
                  className="bg-muted/50"
                  placeholder={formData.hardware_id ? "" : "Select hardware first"}
                />
              </div>

              {/* Model - Read-only */}
              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  value={selectedHardware?.model || ""}
                  disabled
                  className="bg-muted/50"
                  placeholder={formData.hardware_id ? "" : "Select hardware first"}
                />
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Calculated Fields Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                Calculated Fields
              </h3>
              <span className="text-xs text-muted-foreground">
                {enabledCalculatedCount} selected
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Site-level aggregations computed by the controller daily.
            </p>

            <div className="border rounded-lg divide-y">
              {calculatedFields.map((field) => {
                const original = CONTROLLER_CALCULATED_FIELDS.find(
                  (f) => f.field_id === field.field_id
                );
                return (
                  <div
                    key={field.field_id}
                    className="flex items-center gap-4 p-3 hover:bg-muted/30"
                  >
                    {/* Checkbox */}
                    <Checkbox
                      id={`calc-${field.field_id}`}
                      checked={field.enabled}
                      onCheckedChange={() => toggleCalculatedField(field.field_id)}
                    />

                    {/* Name and Unit */}
                    <label
                      htmlFor={`calc-${field.field_id}`}
                      className="flex-1 text-sm cursor-pointer"
                    >
                      {field.name}
                      {original && (
                        <span className="text-muted-foreground ml-2">
                          ({original.unit})
                        </span>
                      )}
                    </label>

                    {/* Storage Mode Selector */}
                    <Select
                      value={field.storage_mode}
                      onValueChange={(value: StorageMode) =>
                        updateCalculatedFieldMode(field.field_id, value)
                      }
                      disabled={!field.enabled}
                    >
                      <SelectTrigger className="w-[120px] h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="log">Log</SelectItem>
                        <SelectItem value="viz_only">Viz Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Controller Readings Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                Controller Readings
              </h3>
              <span className="text-xs text-muted-foreground">
                {enabledReadingsCount} selected
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Controller health metrics (read from system).
            </p>

            <div className="border rounded-lg divide-y">
              {controllerReadings.map((field) => {
                const original = CONTROLLER_READINGS.find(
                  (f) => f.field_id === field.field_id
                );
                return (
                  <div
                    key={field.field_id}
                    className="flex items-center gap-4 p-3 hover:bg-muted/30"
                  >
                    {/* Checkbox */}
                    <Checkbox
                      id={`reading-${field.field_id}`}
                      checked={field.enabled}
                      onCheckedChange={() => toggleControllerReading(field.field_id)}
                    />

                    {/* Name and Unit */}
                    <label
                      htmlFor={`reading-${field.field_id}`}
                      className="flex-1 text-sm cursor-pointer"
                    >
                      {field.name}
                      {original && (
                        <span className="text-muted-foreground ml-2">
                          ({original.unit})
                        </span>
                      )}
                    </label>

                    {/* Storage Mode Selector */}
                    <Select
                      value={field.storage_mode}
                      onValueChange={(value: StorageMode) =>
                        updateControllerReadingMode(field.field_id, value)
                      }
                      disabled={!field.enabled}
                    >
                      <SelectTrigger className="w-[120px] h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="log">Log</SelectItem>
                        <SelectItem value="viz_only">Viz Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting
              ? "Saving..."
              : isEditing
              ? "Save Changes"
              : "Create Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
