"use client";

/**
 * Template Form Dialog
 *
 * Dialog for creating or editing device templates.
 * Used by admins to manage the device template library.
 *
 * Features:
 * - Create new templates
 * - Edit existing templates
 * - Manage Modbus registers
 * - Form validation
 * - Supabase integration
 */

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { RegisterForm, type ModbusRegister } from "./register-form";

import type { CalculatedFieldSelection, DeviceType } from "@/lib/types";

// Device template type (local interface with flexible fields for DB operations)
interface DeviceTemplate {
  id: string;
  template_id: string;
  name: string;
  device_type: string;
  brand: string;
  model: string;
  rated_power_kw: number | null;
  template_type?: string | null;  // 'public' or 'custom'
  enterprise_id?: string | null;  // Enterprise ID for custom templates
  is_active?: boolean;  // Whether template is active and can be used for new devices
  // Registers for logging AND control (stored in database)
  logging_registers?: ModbusRegister[] | null;
  // Registers for visualization only (NOT stored)
  visualization_registers?: ModbusRegister[] | null;
  // Alarm registers with thresholds
  alarm_registers?: ModbusRegister[] | null;
  // Calculated field selections
  calculated_fields?: CalculatedFieldSelection[] | null;
  // Legacy field for backward compatibility
  registers?: ModbusRegister[] | null;
}

// Available hardware types with labels (for device templates)
const DEVICE_TYPE_OPTIONS: { value: DeviceType; label: string }[] = [
  { value: "gas_generator_controller", label: "Gas Generator Controller" },
  { value: "diesel_generator_controller", label: "Diesel Generator Controller" },
  { value: "energy_meter", label: "Energy Meter" },
  { value: "capacitor_bank", label: "Capacitor Bank" },
  { value: "inverter", label: "Solar Inverter" },
  { value: "solar_radiation_sensor", label: "Solar Radiation Sensor" },
  { value: "wind_sensor", label: "Wind Sensor" },
  { value: "wind_turbine", label: "Wind Turbine" },
  { value: "bess", label: "Battery Energy Storage System" },
  { value: "fuel_level_sensor", label: "Fuel Level Sensor" },
  { value: "fuel_flow_meter", label: "Fuel Flow Meter" },
  { value: "temperature_humidity_sensor", label: "Temperature & Humidity Sensor" },
  { value: "other_hardware", label: "Other Hardware" },
];

// Predefined calculated fields per hardware type
const CALCULATED_FIELDS_BY_TYPE: Partial<Record<DeviceType, { field_id: string; name: string; unit: string }[]>> = {
  // Energy meters
  energy_meter: [
    { field_id: "daily_kwh_consumption", name: "Daily kWh Consumption", unit: "kWh" },
    { field_id: "daily_peak_load", name: "Daily Peak Load", unit: "kW" },
    { field_id: "daily_avg_load", name: "Daily Average Load", unit: "kW" },
    { field_id: "daily_phase_imbalance", name: "Daily Phase Imbalance", unit: "%" },
  ],
  // Solar inverters
  inverter: [
    { field_id: "daily_kwh_production", name: "Daily kWh Production", unit: "kWh" },
    { field_id: "daily_peak_kw", name: "Daily Peak kW", unit: "kW" },
    { field_id: "daily_avg_kw", name: "Daily Average kW", unit: "kW" },
  ],
  // Generator controllers
  gas_generator_controller: [
    { field_id: "daily_kwh_production", name: "Daily kWh Production", unit: "kWh" },
    { field_id: "daily_peak_kw", name: "Daily Peak kW", unit: "kW" },
    { field_id: "daily_avg_kw", name: "Daily Average kW", unit: "kW" },
  ],
  diesel_generator_controller: [
    { field_id: "daily_kwh_production", name: "Daily kWh Production", unit: "kWh" },
    { field_id: "daily_peak_kw", name: "Daily Peak kW", unit: "kW" },
    { field_id: "daily_avg_kw", name: "Daily Average kW", unit: "kW" },
  ],
  // Wind turbine
  wind_turbine: [
    { field_id: "daily_kwh_production", name: "Daily kWh Production", unit: "kWh" },
    { field_id: "daily_peak_kw", name: "Daily Peak kW", unit: "kW" },
    { field_id: "daily_avg_kw", name: "Daily Average kW", unit: "kW" },
  ],
  // Battery storage
  bess: [
    { field_id: "daily_kwh_charged", name: "Daily kWh Charged", unit: "kWh" },
    { field_id: "daily_kwh_discharged", name: "Daily kWh Discharged", unit: "kWh" },
    { field_id: "daily_avg_soc", name: "Daily Average SOC", unit: "%" },
  ],
  // Fuel sensors
  fuel_level_sensor: [
    { field_id: "daily_fuel_level_difference_l", name: "Daily Fuel Level Difference (L)", unit: "L" },
    { field_id: "daily_fuel_level_difference_gal", name: "Daily Fuel Level Difference (Imperial gallons)", unit: "gal" },
    { field_id: "daily_fuel_level_difference_pct", name: "Daily Fuel Level Difference (%)", unit: "%" },
  ],
  fuel_flow_meter: [
    { field_id: "daily_fuel_consumption_l", name: "Daily Fuel Consumption (L)", unit: "L" },
    { field_id: "daily_fuel_consumption_gal", name: "Daily Fuel Consumption (gal)", unit: "gal" },
  ],
  // Environmental sensors
  temperature_humidity_sensor: [
    { field_id: "daily_peak_temp", name: "Daily Peak Temperature", unit: "°C" },
    { field_id: "daily_avg_temp", name: "Daily Average Temperature", unit: "°C" },
    { field_id: "daily_peak_humidity", name: "Daily Peak Humidity", unit: "%" },
    { field_id: "daily_avg_humidity", name: "Daily Average Humidity", unit: "%" },
  ],
  solar_radiation_sensor: [
    { field_id: "daily_peak_irradiance", name: "Daily Peak Irradiance", unit: "W/m²" },
    { field_id: "daily_avg_irradiance", name: "Daily Average Irradiance", unit: "W/m²" },
  ],
  wind_sensor: [
    { field_id: "daily_peak_wind_speed", name: "Daily Peak Wind Speed", unit: "m/s" },
    { field_id: "daily_avg_wind_speed", name: "Daily Average Wind Speed", unit: "m/s" },
  ],
  // Legacy types (backward compatibility)
  load_meter: [
    { field_id: "daily_kwh_consumption", name: "Daily kWh Consumption", unit: "kWh" },
    { field_id: "daily_peak_load", name: "Daily Peak Load", unit: "kW" },
    { field_id: "daily_avg_load", name: "Daily Average Load", unit: "kW" },
  ],
  dg: [
    { field_id: "daily_kwh_production", name: "Daily kWh Production", unit: "kWh" },
    { field_id: "daily_peak_kw", name: "Daily Peak kW", unit: "kW" },
    { field_id: "daily_avg_kw", name: "Daily Average kW", unit: "kW" },
  ],
};

/**
 * Generate a unique template ID from brand and model
 * Format: {brand}_{model}_{random4} (e.g., sungrow_sg150ktl_m_a7x2)
 */
function generateTemplateId(brand: string, model: string): string {
  const sanitize = (str: string) =>
    str.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const random = Math.random().toString(36).substring(2, 6);
  return `${sanitize(brand)}_${sanitize(model)}_${random}`;
}

interface TemplateFormDialogProps {
  // Mode: "create" for new template, "edit" for existing
  mode: "create" | "edit";
  // Template to edit (required for edit mode)
  template?: DeviceTemplate;
  // Whether dialog is open
  open: boolean;
  // Callback when dialog is closed
  onOpenChange: (open: boolean) => void;
  // Callback when template is saved successfully
  onSaved?: (template: DeviceTemplate) => void;
  // Current user's role (for permission checks)
  userRole?: string;
  // Current user's enterprise ID (for custom templates)
  userEnterpriseId?: string | null;
  // Available enterprises (for super admin to select when creating custom templates)
  enterprises?: Array<{ id: string; name: string }>;
}

// Format logging frequency (in seconds) into readable labels
// Minimum is 1 second to prevent excessive cloud sync
function formatLoggingFrequency(seconds?: number): string {
  if (!seconds || seconds < 1) return "1s";  // Default/minimum: 1 second
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export function TemplateFormDialog({
  mode,
  template,
  open,
  onOpenChange,
  onSaved,
  userRole,
  userEnterpriseId,
  enterprises,
}: TemplateFormDialogProps) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);

  // Enterprise admins and configurators can only create custom templates for their enterprise
  const isEnterpriseOrConfigurator = userRole === "enterprise_admin" || userRole === "configurator";

  // Super admins and admins can create any template type
  const isSuperAdmin = userRole === "super_admin" || userRole === "backend_admin" || userRole === "admin";

  // State for selected enterprise (for super admin creating custom templates)
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<string>("");

  // Form state (template_id is auto-generated from brand + model)
  const [formData, setFormData] = useState({
    name: "",
    device_type: "inverter",
    brand: "",
    model: "",
    rated_power_kw: "",
    template_type: "public",  // 'public' or 'custom'
    is_active: true,  // Active by default
  });

  // Logging registers state (stored in database AND used by control logic)
  const [loggingRegisters, setLoggingRegisters] = useState<ModbusRegister[]>([]);
  const [loggingRegisterFormOpen, setLoggingRegisterFormOpen] = useState(false);
  const [loggingRegisterFormMode, setLoggingRegisterFormMode] = useState<"add" | "edit">("add");
  const [editingLoggingRegister, setEditingLoggingRegister] = useState<ModbusRegister | undefined>();
  const [editingLoggingRegisterIndex, setEditingLoggingRegisterIndex] = useState<number>(-1);

  // Visualization registers state (live display only - NOT stored in database)
  const [visualizationRegisters, setVisualizationRegisters] = useState<ModbusRegister[]>([]);
  const [vizRegisterFormOpen, setVizRegisterFormOpen] = useState(false);
  const [vizRegisterFormMode, setVizRegisterFormMode] = useState<"add" | "edit">("add");
  const [editingVizRegister, setEditingVizRegister] = useState<ModbusRegister | undefined>();
  const [editingVizRegisterIndex, setEditingVizRegisterIndex] = useState<number>(-1);

  // Alarm registers state (same structure as Modbus registers)
  const [alarmRegisters, setAlarmRegisters] = useState<ModbusRegister[]>([]);
  const [alarmRegisterFormOpen, setAlarmRegisterFormOpen] = useState(false);
  const [alarmRegisterFormMode, setAlarmRegisterFormMode] = useState<"add" | "edit">("add");
  const [editingAlarmRegister, setEditingAlarmRegister] = useState<ModbusRegister | undefined>();
  const [editingAlarmRegisterIndex, setEditingAlarmRegisterIndex] = useState<number>(-1);

  // Calculated fields state (device-type specific derived values)
  const [calculatedFields, setCalculatedFields] = useState<CalculatedFieldSelection[]>([]);

  // Current active tab in the register sections
  const [activeTab, setActiveTab] = useState("logging");

  // Template usage tracking (for warning when editing templates with connected devices)
  const [templateUsage, setTemplateUsage] = useState<{
    device_count: number;
    site_count: number;
    site_names: string[];
  } | null>(null);

  // Extract unique groups from all registers (Logging, Visualization, and Alarm)
  // This is passed to RegisterForm so users can select from existing groups
  const existingGroups = useMemo(() => {
    const groups = new Set<string>();
    // Collect groups from Logging registers
    loggingRegisters.forEach((r) => {
      if (r.group) groups.add(r.group);
    });
    // Collect groups from Visualization registers
    visualizationRegisters.forEach((r) => {
      if (r.group) groups.add(r.group);
    });
    // Collect groups from Alarm registers
    alarmRegisters.forEach((r) => {
      if (r.group) groups.add(r.group);
    });
    // Return sorted array of unique group names
    return Array.from(groups).sort();
  }, [loggingRegisters, visualizationRegisters, alarmRegisters]);

  // Reset form when dialog opens with template data
  useEffect(() => {
    if (open) {
      if (mode === "edit" && template) {
        // Editing: populate form with existing data
        setFormData({
          name: template.name,
          device_type: template.device_type,
          brand: template.brand,
          model: template.model,
          rated_power_kw: template.rated_power_kw?.toString() || "",
          template_type: template.template_type || "public",
          is_active: template.is_active !== false,  // Default to true if undefined
        });
        // Set enterprise ID for custom templates
        setSelectedEnterpriseId(template.enterprise_id || "");
        // Load logging registers from template
        // Check both new column name and legacy column name for backward compatibility
        setLoggingRegisters(template.logging_registers || template.registers || []);
        // Load visualization registers from template
        setVisualizationRegisters(template.visualization_registers || []);
        // Load alarm registers from template
        setAlarmRegisters(template.alarm_registers || []);
        // Load calculated fields from template
        setCalculatedFields(template.calculated_fields || []);
      } else {
        // Creating: reset to empty form
        // Enterprise admins can only create custom templates
        setFormData({
          name: "",
          device_type: "inverter",
          brand: "",
          model: "",
          rated_power_kw: "",
          template_type: isEnterpriseOrConfigurator ? "custom" : "public",
          is_active: true,  // New templates are active by default
        });
        // Reset enterprise selection for new templates
        setSelectedEnterpriseId("");
        setLoggingRegisters([]);
        setVisualizationRegisters([]);
        setAlarmRegisters([]);
        setCalculatedFields([]);
      }
      // Reset to first tab when opening
      setActiveTab("logging");

      // Fetch template usage when editing
      if (mode === "edit" && template?.template_id) {
        fetch(`/api/devices/templates/${template.template_id}/usage`)
          .then((res) => res.ok ? res.json() : null)
          .then((data) => {
            if (data) {
              setTemplateUsage({
                device_count: data.device_count || 0,
                site_count: data.site_count || 0,
                site_names: data.site_names || [],
              });
            }
          })
          .catch(() => setTemplateUsage(null));
      } else {
        setTemplateUsage(null);
      }
    }
  }, [open, mode, template, isEnterpriseOrConfigurator]);

  // Logging register management functions
  const handleAddLoggingRegister = () => {
    setLoggingRegisterFormMode("add");
    setEditingLoggingRegister(undefined);
    setEditingLoggingRegisterIndex(-1);
    setLoggingRegisterFormOpen(true);
  };

  const handleEditLoggingRegister = (register: ModbusRegister, index: number) => {
    setLoggingRegisterFormMode("edit");
    setEditingLoggingRegister(register);
    setEditingLoggingRegisterIndex(index);
    setLoggingRegisterFormOpen(true);
  };

  const handleDeleteLoggingRegister = (index: number) => {
    setLoggingRegisters((prev) => prev.filter((_, i) => i !== index));
    toast.success("Logging register removed");
  };

  const handleSaveLoggingRegister = (register: ModbusRegister) => {
    if (loggingRegisterFormMode === "edit" && editingLoggingRegisterIndex >= 0) {
      // Update existing register
      setLoggingRegisters((prev) =>
        prev.map((r, i) => (i === editingLoggingRegisterIndex ? register : r))
      );
      toast.success("Logging register updated");
    } else {
      // Add new register
      setLoggingRegisters((prev) => [...prev, register].sort((a, b) => a.address - b.address));
      toast.success("Logging register added");
    }
  };

  // Visualization register management functions
  const handleAddVizRegister = () => {
    setVizRegisterFormMode("add");
    setEditingVizRegister(undefined);
    setEditingVizRegisterIndex(-1);
    setVizRegisterFormOpen(true);
  };

  const handleEditVizRegister = (register: ModbusRegister, index: number) => {
    setVizRegisterFormMode("edit");
    setEditingVizRegister(register);
    setEditingVizRegisterIndex(index);
    setVizRegisterFormOpen(true);
  };

  const handleDeleteVizRegister = (index: number) => {
    setVisualizationRegisters((prev) => prev.filter((_, i) => i !== index));
    toast.success("Visualization register removed");
  };

  const handleSaveVizRegister = (register: ModbusRegister) => {
    if (vizRegisterFormMode === "edit" && editingVizRegisterIndex >= 0) {
      // Update existing register
      setVisualizationRegisters((prev) =>
        prev.map((r, i) => (i === editingVizRegisterIndex ? register : r))
      );
      toast.success("Visualization register updated");
    } else {
      // Add new register
      setVisualizationRegisters((prev) => [...prev, register].sort((a, b) => a.address - b.address));
      toast.success("Visualization register added");
    }
  };

  // Alarm register management functions
  const handleAddAlarmRegister = () => {
    setAlarmRegisterFormMode("add");
    setEditingAlarmRegister(undefined);
    setEditingAlarmRegisterIndex(-1);
    setAlarmRegisterFormOpen(true);
  };

  const handleEditAlarmRegister = (register: ModbusRegister, index: number) => {
    setAlarmRegisterFormMode("edit");
    setEditingAlarmRegister(register);
    setEditingAlarmRegisterIndex(index);
    setAlarmRegisterFormOpen(true);
  };

  const handleDeleteAlarmRegister = (index: number) => {
    setAlarmRegisters((prev) => prev.filter((_, i) => i !== index));
    toast.success("Alarm register removed");
  };

  const handleSaveAlarmRegister = (register: ModbusRegister) => {
    if (alarmRegisterFormMode === "edit" && editingAlarmRegisterIndex >= 0) {
      // Update existing alarm register
      setAlarmRegisters((prev) =>
        prev.map((r, i) => (i === editingAlarmRegisterIndex ? register : r))
      );
      toast.success("Alarm register updated");
    } else {
      // Add new alarm register
      setAlarmRegisters((prev) => [...prev, register].sort((a, b) => a.address - b.address));
      toast.success("Alarm register added");
    }
  };

  // Calculated fields management functions
  // Toggle a calculated field on/off
  const handleToggleCalculatedField = (fieldId: string, fieldName: string) => {
    setCalculatedFields((prev) => {
      const exists = prev.find((f) => f.field_id === fieldId);
      if (exists) {
        // Remove the field if it exists
        return prev.filter((f) => f.field_id !== fieldId);
      } else {
        // Add the field with default storage mode "log"
        return [...prev, { field_id: fieldId, name: fieldName, storage_mode: "log" as const }];
      }
    });
  };

  // Update storage mode for a calculated field
  const handleUpdateCalculatedFieldMode = (fieldId: string, mode: "log" | "viz_only") => {
    setCalculatedFields((prev) =>
      prev.map((f) =>
        f.field_id === fieldId ? { ...f, storage_mode: mode } : f
      )
    );
  };

  // Get available calculated fields for the current device type
  const availableCalculatedFields = useMemo(() => {
    return CALCULATED_FIELDS_BY_TYPE[formData.device_type as DeviceType] || [];
  }, [formData.device_type]);

  // Handle input changes
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate required fields
      if (!formData.name.trim()) {
        toast.error("Template name is required");
        setLoading(false);
        return;
      }
      if (!formData.brand.trim()) {
        toast.error("Brand is required");
        setLoading(false);
        return;
      }
      if (!formData.model.trim()) {
        toast.error("Model is required");
        setLoading(false);
        return;
      }

      // Validate enterprise selection for super admin creating custom templates
      if (formData.template_type === "custom" && isSuperAdmin && !selectedEnterpriseId) {
        toast.error("Please select an enterprise for custom templates");
        setLoading(false);
        return;
      }

      // Map hardware_type to operation (required by database)
      const getOperationFromDeviceType = (deviceType: string): string => {
        switch (deviceType) {
          // Solar/renewable generation
          case "inverter":
          case "wind_turbine":
            return "solar";
          // Generator controllers
          case "gas_generator_controller":
          case "diesel_generator_controller":
          case "dg":
            return "dg";
          // Metering
          case "energy_meter":
          case "load_meter":
          case "capacitor_bank":
            return "meter";
          // Storage
          case "bess":
            return "storage";
          // Sensors
          case "fuel_level_sensor":
          case "fuel_flow_meter":
          case "temperature_humidity_sensor":
          case "solar_radiation_sensor":
          case "wind_sensor":
          case "sensor":
            return "sensor";
          // Other
          case "other_hardware":
          default:
            return "other";
        }
      };

      // Determine enterprise_id based on user role and template type
      // - Super admins creating custom templates: use selectedEnterpriseId
      // - Enterprise admins creating custom templates: use their userEnterpriseId
      // - Public templates: null
      const getEnterpriseId = (): string | null => {
        if (formData.template_type !== "custom") return null;
        if (isSuperAdmin) return selectedEnterpriseId || null;
        return userEnterpriseId || null;
      };

      // Prepare data for Supabase
      // For custom templates, set enterprise_id based on user role
      // Auto-generate template_id for new templates, keep existing for edits
      const templateId = mode === "edit" && template
        ? template.template_id
        : generateTemplateId(formData.brand, formData.model);

      const templateData = {
        template_id: templateId,
        name: formData.name.trim(),
        device_type: formData.device_type,
        operation: getOperationFromDeviceType(formData.device_type),  // Required: solar/dg/meter
        brand: formData.brand.trim(),
        model: formData.model.trim(),
        rated_power_kw: formData.rated_power_kw
          ? parseFloat(formData.rated_power_kw)
          : null,
        template_type: formData.template_type,  // 'public' or 'custom'
        enterprise_id: getEnterpriseId(),
        is_active: formData.is_active,  // Active status for new device selection
        // NEW COLUMN NAMES: logging_registers, visualization_registers, calculated_fields
        logging_registers: loggingRegisters.length > 0 ? loggingRegisters : null,
        visualization_registers: visualizationRegisters.length > 0 ? visualizationRegisters : null,
        alarm_registers: alarmRegisters.length > 0 ? alarmRegisters : null,
        calculated_fields: calculatedFields.length > 0 ? calculatedFields : null,
      };

      if (mode === "edit" && template) {
        // Update existing template via Supabase client
        // RLS policies handle authorization automatically
        const { data, error } = await supabase
          .from("device_templates")
          .update(templateData)
          .eq("template_id", template.template_id)
          .select()
          .single();

        if (error) {
          console.error("Error updating template:", error);
          toast.error(error.message || "Failed to update template");
          setLoading(false);
          return;
        }

        toast.success("Template updated successfully");
        onSaved?.(data);
      } else {
        // Create new template
        const { data, error } = await supabase
          .from("device_templates")
          .insert(templateData)
          .select()
          .single();

        if (error) {
          console.error("Error creating template:", error);
          toast.error(error.message || "Failed to create template");
          setLoading(false);
          return;
        }

        toast.success("Template created successfully");
        onSaved?.(data);
      }

      // Close dialog on success
      onOpenChange(false);
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Edit Template" : "Add Device Template"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Update the device template settings."
              : "Create a new device template for the library."}
          </DialogDescription>
          {/* Warning banner when template has connected devices */}
          {mode === "edit" && templateUsage && templateUsage.device_count > 0 && (
            <div className="mt-3 p-3 bg-amber-50 rounded-md border border-amber-200">
              <p className="text-sm font-medium text-amber-800">
                Warning: This template is linked to {templateUsage.device_count} device{templateUsage.device_count !== 1 ? "s" : ""} in {templateUsage.site_count} site{templateUsage.site_count !== 1 ? "s" : ""}.
              </p>
              <p className="text-xs text-amber-700 mt-1">
                Changes will auto-sync to connected devices on next sync.
                {templateUsage.site_names.length > 0 && (
                  <span className="block mt-1">Sites: {templateUsage.site_names.slice(0, 3).join(", ")}{templateUsage.site_names.length > 3 ? ` +${templateUsage.site_names.length - 3} more` : ""}</span>
                )}
              </p>
            </div>
          )}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {/* Template Name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              placeholder="e.g., Sungrow SG150KTL-M"
              value={formData.name}
              onChange={handleChange}
              className="min-h-[44px]"
              required
            />
          </div>

          {/* Hardware Type and Template Type - side by side */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="device_type">
                Hardware Type <span className="text-red-500">*</span>
              </Label>
              <select
                id="device_type"
                name="device_type"
                value={formData.device_type}
                onChange={handleChange}
                className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
                required
              >
                {DEVICE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Template Type - Public or Custom */}
            <div className="space-y-2">
              <Label htmlFor="template_type">
                Template Type <span className="text-red-500">*</span>
              </Label>
              <select
                id="template_type"
                name="template_type"
                value={formData.template_type}
                onChange={handleChange}
                className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background disabled:opacity-60 disabled:cursor-not-allowed"
                required
                disabled={isEnterpriseOrConfigurator}  // Enterprise admins can only create custom
              >
                {isEnterpriseOrConfigurator ? (
                  // Enterprise admins can only create custom templates
                  <option value="custom">Custom (enterprise-specific)</option>
                ) : (
                  // Super admins and admins see both options
                  <>
                    <option value="public">Public (visible to all)</option>
                    <option value="custom">Custom (enterprise-specific)</option>
                  </>
                )}
              </select>
              <p className="text-xs text-muted-foreground">
                {isEnterpriseOrConfigurator
                  ? "Your templates will only be visible to your enterprise"
                  : "Public templates are available to all users"}
              </p>
            </div>
          </div>

          {/* Enterprise Selector - shown when super admin creates custom template */}
          {isSuperAdmin && formData.template_type === "custom" && (
            <div className="space-y-2">
              <Label htmlFor="enterprise_id">
                Enterprise <span className="text-red-500">*</span>
              </Label>
              <select
                id="enterprise_id"
                value={selectedEnterpriseId}
                onChange={(e) => setSelectedEnterpriseId(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
                required
              >
                <option value="">Select an enterprise...</option>
                {enterprises?.map((enterprise) => (
                  <option key={enterprise.id} value={enterprise.id}>
                    {enterprise.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                This template will only be visible to users in the selected enterprise
              </p>
            </div>
          )}

          {/* Brand and Model - side by side on larger screens */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="brand">
                Brand <span className="text-red-500">*</span>
              </Label>
              <Input
                id="brand"
                name="brand"
                placeholder="e.g., Sungrow"
                value={formData.brand}
                onChange={handleChange}
                className="min-h-[44px]"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="model">
                Model <span className="text-red-500">*</span>
              </Label>
              <Input
                id="model"
                name="model"
                placeholder="e.g., SG150KTL-M"
                value={formData.model}
                onChange={handleChange}
                className="min-h-[44px]"
                required
              />
            </div>
          </div>

          {/* Rated Power (optional, mainly for inverters) */}
          <div className="space-y-2">
            <Label htmlFor="rated_power_kw">Rated Power (kW)</Label>
            <Input
              id="rated_power_kw"
              name="rated_power_kw"
              type="number"
              min={0}
              step={0.1}
              placeholder="e.g., 150"
              value={formData.rated_power_kw}
              onChange={handleChange}
              className="min-h-[44px] max-w-[200px]"
            />
            <p className="text-xs text-muted-foreground">
              Optional - used for solar inverters
            </p>
          </div>

          {/* Active Status Toggle - only shown in edit mode */}
          {mode === "edit" && (
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="is_active" className="text-base font-medium">
                  Active Status
                </Label>
                <p className="text-sm text-muted-foreground">
                  {formData.is_active
                    ? "Template is active and can be used for new devices"
                    : "Template is inactive and won't appear when adding new devices"}
                </p>
              </div>
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({ ...prev, is_active: checked }))
                }
              />
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              TABBED REGISTER SECTIONS
              4 Tabs: Logging, Visualization, Alarms, Calculated Fields
              ═══════════════════════════════════════════════════════════════════ */}
          <div className="pt-4 border-t">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-4 mb-4">
                <TabsTrigger value="logging" className="text-xs sm:text-sm">
                  Logging ({loggingRegisters.length})
                </TabsTrigger>
                <TabsTrigger value="visualization" className="text-xs sm:text-sm">
                  Visual ({visualizationRegisters.length})
                </TabsTrigger>
                <TabsTrigger value="alarms" className="text-xs sm:text-sm">
                  Alarms ({alarmRegisters.length})
                </TabsTrigger>
                <TabsTrigger value="calculated" className="text-xs sm:text-sm">
                  Calc ({calculatedFields.length})
                </TabsTrigger>
              </TabsList>

              {/* ═══════════════════════════════════════════════════════════════════
                  TAB 1: LOGGING REGISTERS
                  Stored in database AND used by control logic
                  ═══════════════════════════════════════════════════════════════════ */}
              <TabsContent value="logging" className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-semibold">Logging Registers</Label>
                    <p className="text-xs text-muted-foreground">
                      Stored in database, used by control logic, and available for <strong>live value reading</strong>.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddLoggingRegister}
                    className="min-h-[36px]"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-1">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Add
                  </Button>
                </div>

                {loggingRegisters.length > 0 ? (
                  <div className="border rounded-md overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Addr</th>
                            <th className="px-3 py-2 text-left font-medium">Name</th>
                            <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">Type</th>
                            <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">Datatype</th>
                            <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">Log Freq</th>
                            <th className="px-3 py-2 text-right font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {loggingRegisters.map((reg, index) => (
                            <tr key={index} className="hover:bg-muted/30">
                              <td className="px-3 py-2 font-mono text-xs">{reg.address}</td>
                              <td className="px-3 py-2 font-mono text-xs">{reg.name}</td>
                              <td className="px-3 py-2 hidden sm:table-cell">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                  reg.type === "holding" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                                }`}>
                                  {reg.type}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground hidden sm:table-cell">{reg.datatype}</td>
                              <td className="px-3 py-2 text-xs text-muted-foreground hidden lg:table-cell">
                                {formatLoggingFrequency(reg.logging_frequency)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleEditLoggingRegister(reg, index)}
                                    className="p-1.5 rounded hover:bg-muted transition-colors"
                                    title="Edit register"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted-foreground">
                                      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                                      <path d="m15 5 4 4"/>
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteLoggingRegister(index)}
                                    className="p-1.5 rounded hover:bg-red-100 transition-colors"
                                    title="Delete register"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-red-500">
                                      <path d="M3 6h18"/>
                                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                                    </svg>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="border rounded-md p-6 text-center text-muted-foreground">
                    <p className="text-sm">No logging registers configured yet.</p>
                    <p className="text-xs mt-1">Add registers for logging, control logic, and live value reading.</p>
                  </div>
                )}
              </TabsContent>

              {/* ═══════════════════════════════════════════════════════════════════
                  TAB 2: VISUALIZATION REGISTERS
                  Read for live display only - NOT stored in database
                  ═══════════════════════════════════════════════════════════════════ */}
              <TabsContent value="visualization" className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-semibold">Visualization Registers</Label>
                    <p className="text-xs text-muted-foreground">
                      Additional registers for <strong>live value reading only</strong> - not logged to database.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddVizRegister}
                    className="min-h-[36px]"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-1">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Add
                  </Button>
                </div>

                {visualizationRegisters.length > 0 ? (
                  <div className="border rounded-md overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Addr</th>
                            <th className="px-3 py-2 text-left font-medium">Name</th>
                            <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">Type</th>
                            <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">Datatype</th>
                            <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Scale</th>
                            <th className="px-3 py-2 text-right font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {visualizationRegisters.map((reg, index) => (
                            <tr key={index} className="hover:bg-muted/30">
                              <td className="px-3 py-2 font-mono text-xs">{reg.address}</td>
                              <td className="px-3 py-2 font-mono text-xs">{reg.name}</td>
                              <td className="px-3 py-2 hidden sm:table-cell">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                  reg.type === "holding" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                                }`}>
                                  {reg.type}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground hidden sm:table-cell">{reg.datatype}</td>
                              <td className="px-3 py-2 text-xs text-muted-foreground hidden md:table-cell">
                                {reg.scale || 1}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleEditVizRegister(reg, index)}
                                    className="p-1.5 rounded hover:bg-muted transition-colors"
                                    title="Edit register"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted-foreground">
                                      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                                      <path d="m15 5 4 4"/>
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteVizRegister(index)}
                                    className="p-1.5 rounded hover:bg-red-100 transition-colors"
                                    title="Delete register"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-red-500">
                                      <path d="M3 6h18"/>
                                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                                    </svg>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="border rounded-md p-6 text-center text-muted-foreground">
                    <p className="text-sm">No visualization registers configured yet.</p>
                    <p className="text-xs mt-1">Add additional registers for live value reading that don&apos;t need to be logged.</p>
                  </div>
                )}
              </TabsContent>

              {/* ═══════════════════════════════════════════════════════════════════
                  TAB 3: ALARM REGISTERS
                  Event-based alarms with threshold conditions
                  ═══════════════════════════════════════════════════════════════════ */}
              <TabsContent value="alarms" className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-semibold">Alarm Registers</Label>
                    <p className="text-xs text-muted-foreground">
                      Event-based alarms with threshold conditions.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddAlarmRegister}
                    className="min-h-[36px]"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-1">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Add
                  </Button>
                </div>

                {alarmRegisters.length > 0 ? (
                  <div className="border rounded-md overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Addr</th>
                            <th className="px-3 py-2 text-left font-medium">Name</th>
                            <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">Type</th>
                            <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">Datatype</th>
                            <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Thresholds</th>
                            <th className="px-3 py-2 text-right font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {alarmRegisters.map((reg, index) => (
                            <tr key={index} className="hover:bg-muted/30">
                              <td className="px-3 py-2 font-mono text-xs">{reg.address}</td>
                              <td className="px-3 py-2 font-mono text-xs">{reg.name}</td>
                              <td className="px-3 py-2 hidden sm:table-cell">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                  reg.type === "holding" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                                }`}>
                                  {reg.type}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground hidden sm:table-cell">{reg.datatype}</td>
                              <td className="px-3 py-2 hidden md:table-cell">
                                {reg.thresholds && reg.thresholds.length > 0 ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                    {reg.thresholds.length} configured
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">None</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleEditAlarmRegister(reg, index)}
                                    className="p-1.5 rounded hover:bg-muted transition-colors"
                                    title="Edit alarm register"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted-foreground">
                                      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                                      <path d="m15 5 4 4"/>
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteAlarmRegister(index)}
                                    className="p-1.5 rounded hover:bg-red-100 transition-colors"
                                    title="Delete alarm register"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-red-500">
                                      <path d="M3 6h18"/>
                                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                                    </svg>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="border rounded-md p-6 text-center text-muted-foreground">
                    <p className="text-sm">No alarm registers configured yet.</p>
                    <p className="text-xs mt-1">Add registers with threshold conditions to trigger alarms.</p>
                  </div>
                )}
              </TabsContent>

              {/* ═══════════════════════════════════════════════════════════════════
                  TAB 4: CALCULATED FIELDS
                  Device-type specific derived values
                  ═══════════════════════════════════════════════════════════════════ */}
              <TabsContent value="calculated" className="space-y-3">
                <div>
                  <Label className="text-base font-semibold">Calculated Fields</Label>
                  <p className="text-xs text-muted-foreground">
                    Device-type specific derived values. Select which fields to enable for this template.
                  </p>
                </div>

                {availableCalculatedFields.length > 0 ? (
                  <div className="border rounded-md divide-y">
                    {availableCalculatedFields.map((field) => {
                      const isSelected = calculatedFields.some((f) => f.field_id === field.field_id);
                      const selectedField = calculatedFields.find((f) => f.field_id === field.field_id);
                      return (
                        <div key={field.field_id} className="flex items-center justify-between p-3 hover:bg-muted/30">
                          <div className="flex items-center gap-3">
                            <Checkbox
                              id={field.field_id}
                              checked={isSelected}
                              onCheckedChange={() => handleToggleCalculatedField(field.field_id, field.name)}
                            />
                            <label htmlFor={field.field_id} className="text-sm cursor-pointer">
                              <span className="font-medium">{field.name}</span>
                              <span className="text-xs text-muted-foreground ml-2">({field.unit})</span>
                            </label>
                          </div>
                          {isSelected && (
                            <Select
                              value={selectedField?.storage_mode || "log"}
                              onValueChange={(value) => handleUpdateCalculatedFieldMode(field.field_id, value as "log" | "viz_only")}
                            >
                              <SelectTrigger className="w-[110px] h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="log">Log to DB</SelectItem>
                                <SelectItem value="viz_only">Viz Only</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="border rounded-md p-6 text-center text-muted-foreground">
                    <p className="text-sm">No calculated fields available for this device type.</p>
                    <p className="text-xs mt-1">
                      Calculated fields are predefined for specific device types like Load Meter, Inverter, and DG.
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="min-h-[44px] w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="min-h-[44px] w-full sm:w-auto"
            >
              {loading
                ? mode === "edit"
                  ? "Saving..."
                  : "Creating..."
                : mode === "edit"
                  ? "Save Changes"
                  : "Create Template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      {/* ═══════════════════════════════════════════════════════════════════
          LOGGING REGISTER FORM DIALOG (nested)
          For registers stored in database AND used by control logic
          ═══════════════════════════════════════════════════════════════════ */}
      <RegisterForm
        mode={loggingRegisterFormMode}
        register={editingLoggingRegister}
        existingRegisters={loggingRegisters}
        open={loggingRegisterFormOpen}
        onOpenChange={setLoggingRegisterFormOpen}
        onSave={handleSaveLoggingRegister}
        existingGroups={existingGroups}
      />

      {/* ═══════════════════════════════════════════════════════════════════
          VISUALIZATION REGISTER FORM DIALOG (nested)
          For registers read live but NOT stored in database
          The isVisualizationRegister prop hides the "Logging Frequency" field
          ═══════════════════════════════════════════════════════════════════ */}
      <RegisterForm
        mode={vizRegisterFormMode}
        register={editingVizRegister}
        existingRegisters={visualizationRegisters}
        open={vizRegisterFormOpen}
        onOpenChange={setVizRegisterFormOpen}
        onSave={handleSaveVizRegister}
        isVisualizationRegister={true}
        existingGroups={existingGroups}
      />

      {/* ═══════════════════════════════════════════════════════════════════
          ALARM REGISTER FORM DIALOG (nested)
          For alarm registers with threshold conditions
          The isAlarmRegister prop shows threshold configuration
          ═══════════════════════════════════════════════════════════════════ */}
      <RegisterForm
        mode={alarmRegisterFormMode}
        register={editingAlarmRegister}
        existingRegisters={alarmRegisters}
        open={alarmRegisterFormOpen}
        onOpenChange={setAlarmRegisterFormOpen}
        onSave={handleSaveAlarmRegister}
        isAlarmRegister={true}
        existingGroups={existingGroups}
      />
    </Dialog>
  );
}
