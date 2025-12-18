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

import { useState, useEffect } from "react";
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
import { toast } from "sonner";
import { RegisterForm, type ModbusRegister } from "./register-form";

// Device template type
interface DeviceTemplate {
  id: string;
  template_id: string;
  name: string;
  device_type: string;
  brand: string;
  model: string;
  rated_power_kw: number | null;
  template_type?: string | null;  // 'public' or 'custom'
  registers?: ModbusRegister[] | null;  // Modbus registers array
  alarm_registers?: ModbusRegister[] | null;  // Alarm registers array
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
function formatLoggingFrequency(seconds?: number): string {
  if (!seconds) return "1 min";  // Default: 60 seconds
  if (seconds < 1) return `${seconds * 1000}ms`;
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

  // Enterprise admins can only create custom templates
  const isEnterpriseAdmin = userRole === "enterprise_admin";

  // Super admins can create custom templates for any enterprise
  const isSuperAdmin = userRole === "super_admin" || userRole === "backend_admin";

  // State for selected enterprise (for super admin creating custom templates)
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<string>("");

  // Form state
  const [formData, setFormData] = useState({
    template_id: "",
    name: "",
    device_type: "inverter",
    brand: "",
    model: "",
    rated_power_kw: "",
    template_type: "public",  // 'public' or 'custom'
  });

  // Registers state (Modbus registers)
  const [registers, setRegisters] = useState<ModbusRegister[]>([]);
  const [registerFormOpen, setRegisterFormOpen] = useState(false);
  const [registerFormMode, setRegisterFormMode] = useState<"add" | "edit">("add");
  const [editingRegister, setEditingRegister] = useState<ModbusRegister | undefined>();
  const [editingRegisterIndex, setEditingRegisterIndex] = useState<number>(-1);

  // Alarm registers state (same structure as Modbus registers)
  const [alarmRegisters, setAlarmRegisters] = useState<ModbusRegister[]>([]);
  const [alarmRegisterFormOpen, setAlarmRegisterFormOpen] = useState(false);
  const [alarmRegisterFormMode, setAlarmRegisterFormMode] = useState<"add" | "edit">("add");
  const [editingAlarmRegister, setEditingAlarmRegister] = useState<ModbusRegister | undefined>();
  const [editingAlarmRegisterIndex, setEditingAlarmRegisterIndex] = useState<number>(-1);

  // Reset form when dialog opens with template data
  useEffect(() => {
    if (open) {
      if (mode === "edit" && template) {
        // Editing: populate form with existing data
        setFormData({
          template_id: template.template_id,
          name: template.name,
          device_type: template.device_type,
          brand: template.brand,
          model: template.model,
          rated_power_kw: template.rated_power_kw?.toString() || "",
          template_type: template.template_type || "public",
        });
        // Load registers from template
        setRegisters(template.registers || []);
        // Load alarm registers from template
        setAlarmRegisters(template.alarm_registers || []);
      } else {
        // Creating: reset to empty form
        // Enterprise admins can only create custom templates
        setFormData({
          template_id: "",
          name: "",
          device_type: "inverter",
          brand: "",
          model: "",
          rated_power_kw: "",
          template_type: isEnterpriseAdmin ? "custom" : "public",
        });
        setRegisters([]);
        setAlarmRegisters([]);
      }
    }
  }, [open, mode, template, isEnterpriseAdmin]);

  // Register management functions
  const handleAddRegister = () => {
    setRegisterFormMode("add");
    setEditingRegister(undefined);
    setEditingRegisterIndex(-1);
    setRegisterFormOpen(true);
  };

  const handleEditRegister = (register: ModbusRegister, index: number) => {
    setRegisterFormMode("edit");
    setEditingRegister(register);
    setEditingRegisterIndex(index);
    setRegisterFormOpen(true);
  };

  const handleDeleteRegister = (index: number) => {
    setRegisters((prev) => prev.filter((_, i) => i !== index));
    toast.success("Register removed");
  };

  const handleSaveRegister = (register: ModbusRegister) => {
    if (registerFormMode === "edit" && editingRegisterIndex >= 0) {
      // Update existing register
      setRegisters((prev) =>
        prev.map((r, i) => (i === editingRegisterIndex ? register : r))
      );
      toast.success("Register updated");
    } else {
      // Add new register
      setRegisters((prev) => [...prev, register].sort((a, b) => a.address - b.address));
      toast.success("Register added");
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
      if (!formData.template_id.trim()) {
        toast.error("Template ID is required");
        setLoading(false);
        return;
      }
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

      // Map device_type to operation (required by database)
      // inverter -> solar, dg -> dg, load_meter -> meter, sensor -> sensor
      const getOperationFromDeviceType = (deviceType: string): string => {
        switch (deviceType) {
          case "inverter": return "solar";
          case "dg": return "dg";
          case "load_meter": return "meter";
          case "sensor": return "sensor";
          default: return "meter";
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
      const templateData = {
        template_id: formData.template_id.trim(),
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
        registers: registers.length > 0 ? registers : null,  // Include Modbus registers
        alarm_registers: alarmRegisters.length > 0 ? alarmRegisters : null,  // Include Alarm registers
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
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {/* Template ID */}
          <div className="space-y-2">
            <Label htmlFor="template_id">
              Template ID <span className="text-red-500">*</span>
            </Label>
            <Input
              id="template_id"
              name="template_id"
              placeholder="e.g., sungrow_sg150ktl_m"
              value={formData.template_id}
              onChange={handleChange}
              className="min-h-[44px]"
              required
            />
            <p className="text-xs text-muted-foreground">
              Unique identifier (lowercase, underscores)
            </p>
          </div>

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

          {/* Device Type and Template Type - side by side */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="device_type">
                Device Type <span className="text-red-500">*</span>
              </Label>
              <select
                id="device_type"
                name="device_type"
                value={formData.device_type}
                onChange={handleChange}
                className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
                required
              >
                <option value="inverter">Solar Inverter</option>
                <option value="load_meter">Energy Meter</option>
                <option value="dg">Generator Controller</option>
                <option value="sensor">Sensor (Temperature, Fuel Level, etc.)</option>
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
                disabled={isEnterpriseAdmin}  // Enterprise admins can only create custom
              >
                {isEnterpriseAdmin ? (
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
                {isEnterpriseAdmin
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

          {/* Modbus Registers Section */}
          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base font-semibold">Modbus Registers</Label>
                <p className="text-xs text-muted-foreground">
                  Configure Modbus register addresses for this device
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddRegister}
                className="min-h-[36px]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-1">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Register
              </Button>
            </div>

            {/* Registers Table */}
            {registers.length > 0 ? (
              <div className="border rounded-md overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Address</th>
                        <th className="px-3 py-2 text-left font-medium">Name</th>
                        <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">Type</th>
                        <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">Datatype</th>
                        <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Access</th>
                        <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">Logging</th>
                        <th className="px-3 py-2 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {registers.map((reg, index) => (
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
                          <td className="px-3 py-2 text-xs text-muted-foreground hidden md:table-cell">{reg.access}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground hidden lg:table-cell">
                            {formatLoggingFrequency(reg.logging_frequency)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => handleEditRegister(reg, index)}
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
                                onClick={() => handleDeleteRegister(index)}
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
                <p className="text-sm">No registers configured yet.</p>
                <p className="text-xs mt-1">Click &quot;Add Register&quot; to define Modbus registers for this device.</p>
              </div>
            )}
          </div>

          {/* Alarm Registers Section */}
          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base font-semibold">Alarm Registers</Label>
                <p className="text-xs text-muted-foreground">
                  Configure Modbus register addresses for device alarms
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
                Add Alarm Register
              </Button>
            </div>

            {/* Alarm Registers Table */}
            {alarmRegisters.length > 0 ? (
              <div className="border rounded-md overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Address</th>
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
                <p className="text-xs mt-1">Click &quot;Add Alarm Register&quot; to define alarm registers for this device.</p>
              </div>
            )}
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

      {/* Register Form Dialog (nested) - for Modbus registers */}
      <RegisterForm
        mode={registerFormMode}
        register={editingRegister}
        existingRegisters={registers}
        open={registerFormOpen}
        onOpenChange={setRegisterFormOpen}
        onSave={handleSaveRegister}
      />

      {/* Alarm Register Form Dialog (nested) - for Alarm registers */}
      <RegisterForm
        mode={alarmRegisterFormMode}
        register={editingAlarmRegister}
        existingRegisters={alarmRegisters}
        open={alarmRegisterFormOpen}
        onOpenChange={setAlarmRegisterFormOpen}
        onSave={handleSaveAlarmRegister}
        isAlarmRegister={true}
      />
    </Dialog>
  );
}
