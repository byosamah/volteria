"use client";

/**
 * Register Form Component
 *
 * Form for adding/editing a single Modbus register.
 * Used within the template form dialog for managing registers.
 */

import { useState, useEffect } from "react";
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
import { Trash2, Plus, ChevronDown, ChevronUp } from "lucide-react";
import type { AlarmThreshold, AlarmSeverity, ThresholdOperator } from "@/lib/types";

// Modbus register type
export interface ModbusRegister {
  address: number;
  name: string;  // Display name (any format, e.g., "Active Power")
  alias?: string;  // Code-friendly name (auto-generated, e.g., "active_power")
  description?: string;
  type: "input" | "holding";
  access: "read" | "write" | "readwrite";
  datatype: "uint16" | "int16" | "uint32" | "int32" | "float32";
  scale?: number;  // Multiplication factor
  offset?: number;  // Addition factor (can be negative)
  scale_order?: "multiply_first" | "add_first";  // Which operation happens first
  logging_frequency?: number;  // Logging frequency in seconds
  unit?: string;
  min?: number;
  max?: number;
  register_role?: string;  // Control logic role (e.g., "solar_active_power")
  thresholds?: AlarmThreshold[];  // Alarm thresholds for alarm registers
}

// Severity options for alarm thresholds
const SEVERITY_OPTIONS: { value: AlarmSeverity; label: string; color: string }[] = [
  { value: "warning", label: "Warning", color: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  { value: "minor", label: "Minor", color: "bg-orange-100 text-orange-800 border-orange-300" },
  { value: "major", label: "Major", color: "bg-orange-200 text-orange-900 border-orange-400" },
  { value: "critical", label: "Critical", color: "bg-red-100 text-red-800 border-red-300" },
];

// Operator options for thresholds
const OPERATOR_OPTIONS: { value: ThresholdOperator; label: string }[] = [
  { value: ">", label: ">" },
  { value: ">=", label: ">=" },
  { value: "<", label: "<" },
  { value: "<=", label: "<=" },
  { value: "==", label: "==" },
  { value: "!=", label: "!=" },
];

// Logging frequency options (in seconds)
const LOGGING_FREQUENCY_OPTIONS = [
  { value: "0.5", label: "0.5 seconds" },
  { value: "1", label: "1 second" },
  { value: "10", label: "10 seconds" },
  { value: "30", label: "30 seconds" },
  { value: "60", label: "1 minute" },
  { value: "300", label: "5 minutes" },
  { value: "600", label: "10 minutes" },
  { value: "900", label: "15 minutes" },
  { value: "1800", label: "30 minutes" },
  { value: "3600", label: "1 hour" },
  { value: "86400", label: "24 hours" },
];

// Register role options - defines how this register is used in control logic
// This list can be extended when new operational modes are added
const REGISTER_ROLE_OPTIONS = [
  { value: "none", label: "None (not used in control)" },
  { value: "generator_active_power", label: "Generator Active Power" },
  { value: "generator_reactive_power", label: "Generator Reactive Power" },
  { value: "solar_active_power", label: "Solar Active Power" },
  { value: "solar_reactive_power", label: "Solar Reactive Power" },
  { value: "solar_power_limit_read", label: "Solar Power Limit (Read)" },
  { value: "solar_power_limit_write", label: "Solar Power Limit Control (Write)" },
  { value: "solar_reactive_limit_read", label: "Solar Reactive Limit (Read)" },
  { value: "solar_reactive_limit_write", label: "Solar Reactive Limit Control (Write)" },
  { value: "load_active_power", label: "Load Active Power" },
  { value: "load_reactive_power", label: "Load Reactive Power" },
];

/**
 * Generate a code-friendly alias from a display name.
 * Converts "Active Power" to "active_power", "Voltage Phase-A" to "voltage_phase_a", etc.
 */
function generateAlias(name: string): string {
  // Start with lowercase
  let alias = name.toLowerCase();

  // Replace common special characters with meaningful text
  alias = alias.replace(/%/g, 'pct');
  alias = alias.replace(/[/\-]/g, '_');

  // Replace any remaining non-alphanumeric characters with underscore
  alias = alias.replace(/[^a-z0-9_]/g, '_');

  // Collapse multiple underscores into one
  alias = alias.replace(/_+/g, '_');

  // Remove leading/trailing underscores
  alias = alias.replace(/^_|_$/g, '');

  // Ensure starts with letter (prefix with 'reg_' if starts with number)
  if (alias && /^\d/.test(alias)) {
    alias = 'reg_' + alias;
  }

  return alias || 'register';
}

interface RegisterFormProps {
  // Mode: "add" for new register, "edit" for existing
  mode: "add" | "edit";
  // Register to edit (required for edit mode)
  register?: ModbusRegister;
  // Existing registers (for validation)
  existingRegisters?: ModbusRegister[];
  // Whether dialog is open
  open: boolean;
  // Callback when dialog is closed
  onOpenChange: (open: boolean) => void;
  // Callback when register is saved
  onSave: (register: ModbusRegister) => void;
  // Whether this is an alarm register (shows threshold configuration)
  isAlarmRegister?: boolean;
}

export function RegisterForm({
  mode,
  register,
  existingRegisters = [],
  open,
  onOpenChange,
  onSave,
  isAlarmRegister = false,
}: RegisterFormProps) {
  // Form state
  const [formData, setFormData] = useState<{
    address: string;
    name: string;
    description: string;
    type: "input" | "holding";
    access: "read" | "write" | "readwrite";
    datatype: "uint16" | "int16" | "uint32" | "int32" | "float32";
    scale: string;
    offset: string;
    scale_order: "multiply_first" | "add_first";
    logging_frequency: string;
    unit: string;
    min: string;
    max: string;
    register_role: string;  // Control logic role
  }>({
    address: "",
    name: "",
    description: "",
    type: "input",
    access: "read",
    datatype: "uint16",
    scale: "1",
    offset: "0",
    scale_order: "multiply_first",
    logging_frequency: "60",
    unit: "",
    min: "",
    max: "",
    register_role: "none",  // Default: not used in control
  });

  const [errors, setErrors] = useState<string[]>([]);

  // Alarm thresholds state (only used when isAlarmRegister is true)
  const [thresholds, setThresholds] = useState<AlarmThreshold[]>([]);
  const [thresholdsExpanded, setThresholdsExpanded] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (mode === "edit" && register) {
        // Editing: populate form with existing data
        setFormData({
          address: register.address.toString(),
          name: register.name,
          description: register.description || "",
          type: register.type,
          access: register.access,
          datatype: register.datatype,
          scale: register.scale?.toString() || "1",
          offset: register.offset?.toString() || "0",
          scale_order: register.scale_order || "multiply_first",
          logging_frequency: register.logging_frequency?.toString() || "60",
          unit: register.unit || "",
          min: register.min?.toString() || "",
          max: register.max?.toString() || "",
          register_role: register.register_role || "none",
        });
        // Load existing thresholds if editing an alarm register
        setThresholds(register.thresholds || []);
        setThresholdsExpanded((register.thresholds?.length || 0) > 0);
      } else {
        // Adding: reset to empty form
        setFormData({
          address: "",
          name: "",
          description: "",
          type: "input",
          access: "read",
          datatype: "uint16",
          scale: "1",
          offset: "0",
          scale_order: "multiply_first",
          logging_frequency: "60",
          unit: "",
          min: "",
          max: "",
          register_role: "none",
        });
        // Reset thresholds when adding new register
        setThresholds([]);
        setThresholdsExpanded(false);
      }
      setErrors([]);
    }
  }, [open, mode, register]);

  // Handle input changes
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear errors when user makes changes
    if (errors.length > 0) setErrors([]);
  };

  // Validate form
  const validateForm = (): boolean => {
    const newErrors: string[] = [];

    // Check required fields
    if (!formData.address.trim()) {
      newErrors.push("Address is required");
    } else {
      const addressNum = parseInt(formData.address);
      if (isNaN(addressNum) || addressNum < 0 || addressNum > 65535) {
        newErrors.push("Address must be between 0 and 65535");
      }
      // Check for duplicate address (excluding current register in edit mode)
      const isDuplicate = existingRegisters.some(
        (r) =>
          r.address === addressNum &&
          (mode === "add" || r.address !== register?.address)
      );
      if (isDuplicate) {
        newErrors.push("A register with this address already exists");
      }
    }

    if (!formData.name.trim()) {
      newErrors.push("Name is required");
    } else {
      // Check for duplicate name (excluding current register in edit mode)
      // Note: We no longer enforce snake_case - users can enter any display name
      // The backend will auto-generate a code-friendly alias
      const isDuplicateName = existingRegisters.some(
        (r) =>
          r.name === formData.name &&
          (mode === "add" || r.name !== register?.name)
      );
      if (isDuplicateName) {
        newErrors.push("A register with this name already exists");
      }
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  // Threshold management functions
  const addThreshold = () => {
    setThresholds((prev) => [
      ...prev,
      { operator: ">" as ThresholdOperator, value: 0, severity: "warning" as AlarmSeverity, message: "" },
    ]);
    setThresholdsExpanded(true);
  };

  const removeThreshold = (index: number) => {
    setThresholds((prev) => prev.filter((_, i) => i !== index));
  };

  const updateThreshold = (index: number, field: keyof AlarmThreshold, value: string | number) => {
    setThresholds((prev) =>
      prev.map((t, i) => {
        if (i !== index) return t;
        if (field === "value") {
          return { ...t, [field]: typeof value === "string" ? parseFloat(value) || 0 : value };
        }
        return { ...t, [field]: value };
      })
    );
  };

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    // Build register object
    const newRegister: ModbusRegister = {
      address: parseInt(formData.address),
      name: formData.name.trim(),
      type: formData.type,
      access: formData.access,
      datatype: formData.datatype,
    };

    // Add optional fields if provided
    if (formData.description.trim()) {
      newRegister.description = formData.description.trim();
    }
    if (formData.scale && formData.scale !== "1") {
      newRegister.scale = parseFloat(formData.scale);
    }
    if (formData.offset && formData.offset !== "0") {
      newRegister.offset = parseFloat(formData.offset);
    }
    if (formData.scale_order !== "multiply_first") {
      newRegister.scale_order = formData.scale_order;
    }
    if (formData.logging_frequency && formData.logging_frequency !== "60") {
      newRegister.logging_frequency = parseFloat(formData.logging_frequency);
    }
    if (formData.unit.trim()) {
      newRegister.unit = formData.unit.trim();
    }
    if (formData.min.trim()) {
      newRegister.min = parseFloat(formData.min);
    }
    if (formData.max.trim()) {
      newRegister.max = parseFloat(formData.max);
    }
    // Add register role if not "none" (the default)
    if (formData.register_role && formData.register_role !== "none") {
      newRegister.register_role = formData.register_role;
    }

    // Add alarm thresholds if this is an alarm register and thresholds are defined
    if (isAlarmRegister && thresholds.length > 0) {
      // Filter out thresholds with no message (clean up empty ones)
      const validThresholds = thresholds.filter((t) => t.value !== undefined);
      if (validThresholds.length > 0) {
        newRegister.thresholds = validThresholds;
      }
    }

    onSave(newRegister);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Edit Register" : "Add Modbus Register"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Update the register configuration."
              : "Add a new Modbus register to this template."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {/* Error messages */}
          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
              <ul className="list-disc list-inside space-y-1">
                {errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Address and Name - side by side */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="address">
                Address <span className="text-red-500">*</span>
              </Label>
              <Input
                id="address"
                name="address"
                type="number"
                min={0}
                max={65535}
                placeholder="e.g., 5006"
                value={formData.address}
                onChange={handleChange}
                className="min-h-[44px]"
                required
              />
              <p className="text-xs text-muted-foreground">0-65535</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">
                Display Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g., Active Power"
                value={formData.name}
                onChange={handleChange}
                className="min-h-[44px]"
                required
              />
              {/* Show auto-generated alias preview */}
              {formData.name.trim() && (
                <p className="text-xs text-muted-foreground">
                  Code alias: <code className="bg-muted px-1 rounded">{generateAlias(formData.name)}</code>
                </p>
              )}
              {!formData.name.trim() && (
                <p className="text-xs text-muted-foreground">Any format (alias auto-generated)</p>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              name="description"
              placeholder="e.g., Active Power Output"
              value={formData.description}
              onChange={handleChange}
              className="min-h-[44px]"
            />
          </div>

          {/* Type and Access - side by side */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="type">
                Register Type <span className="text-red-500">*</span>
              </Label>
              <select
                id="type"
                name="type"
                value={formData.type}
                onChange={handleChange}
                className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
                required
              >
                <option value="input">Input (read-only)</option>
                <option value="holding">Holding (read/write)</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="access">
                Access <span className="text-red-500">*</span>
              </Label>
              <select
                id="access"
                name="access"
                value={formData.access}
                onChange={handleChange}
                className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
                required
              >
                <option value="read">Read only</option>
                <option value="write">Write only</option>
                <option value="readwrite">Read/Write</option>
              </select>
            </div>
          </div>

          {/* Register Role - what is this register used for in control logic */}
          <div className="space-y-2">
            <Label htmlFor="register_role">
              Register Role
              <span className="text-xs text-muted-foreground ml-2">
                (how is this register used in control logic?)
              </span>
            </Label>
            <select
              id="register_role"
              name="register_role"
              value={formData.register_role}
              onChange={handleChange}
              className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
            >
              {REGISTER_ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Datatype */}
          <div className="space-y-2">
            <Label htmlFor="datatype">
              Data Type <span className="text-red-500">*</span>
            </Label>
            <select
              id="datatype"
              name="datatype"
              value={formData.datatype}
              onChange={handleChange}
              className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
              required
            >
              <option value="uint16">uint16 (unsigned 16-bit)</option>
              <option value="int16">int16 (signed 16-bit)</option>
              <option value="uint32">uint32 (unsigned 32-bit)</option>
              <option value="int32">int32 (signed 32-bit)</option>
              <option value="float32">float32 (32-bit float)</option>
            </select>
          </div>

          {/* Scale, Offset, and Order - in a row */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="scale">Scale (×)</Label>
              <Input
                id="scale"
                name="scale"
                type="number"
                step="any"
                placeholder="1"
                value={formData.scale}
                onChange={handleChange}
                className="min-h-[44px]"
              />
              <p className="text-xs text-muted-foreground">Multiplier</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="offset">Offset (+)</Label>
              <Input
                id="offset"
                name="offset"
                type="number"
                step="any"
                placeholder="0"
                value={formData.offset}
                onChange={handleChange}
                className="min-h-[44px]"
              />
              <p className="text-xs text-muted-foreground">Addition (can be negative)</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="scale_order">Operation Order</Label>
              <select
                id="scale_order"
                name="scale_order"
                value={formData.scale_order}
                onChange={handleChange}
                className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
              >
                <option value="multiply_first">(raw × scale) + offset</option>
                <option value="add_first">(raw + offset) × scale</option>
              </select>
            </div>
          </div>

          {/* Unit, Min, Max - in a row */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="unit">Unit</Label>
              <Input
                id="unit"
                name="unit"
                placeholder="e.g., kW, V, %"
                value={formData.unit}
                onChange={handleChange}
                className="min-h-[44px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="min">Min Value</Label>
              <Input
                id="min"
                name="min"
                type="number"
                step="any"
                placeholder="Optional"
                value={formData.min}
                onChange={handleChange}
                className="min-h-[44px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="max">Max Value</Label>
              <Input
                id="max"
                name="max"
                type="number"
                step="any"
                placeholder="Optional"
                value={formData.max}
                onChange={handleChange}
                className="min-h-[44px]"
              />
            </div>
          </div>

          {/* Logging Frequency */}
          <div className="space-y-2">
            <Label htmlFor="logging_frequency">Logging Frequency</Label>
            <select
              id="logging_frequency"
              name="logging_frequency"
              value={formData.logging_frequency}
              onChange={handleChange}
              className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
            >
              {LOGGING_FREQUENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">How often to log this register</p>
          </div>

          {/* Alarm Thresholds Section (only for alarm registers) */}
          {isAlarmRegister && (
            <div className="space-y-3 pt-2">
              {/* Collapsible header */}
              <button
                type="button"
                onClick={() => setThresholdsExpanded(!thresholdsExpanded)}
                className="flex items-center justify-between w-full text-left"
              >
                <span className="font-medium text-sm">
                  Thresholds (optional)
                  {thresholds.length > 0 && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({thresholds.length} configured)
                    </span>
                  )}
                </span>
                {thresholdsExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {/* Threshold list */}
              {thresholdsExpanded && (
                <div className="space-y-3 border rounded-md p-3 bg-muted/20">
                  {thresholds.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      No thresholds configured. Add one to trigger alarms at specific values.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {thresholds.map((threshold, index) => (
                        <div
                          key={index}
                          className="flex flex-wrap items-center gap-2 p-2 border rounded-md bg-background"
                        >
                          {/* Operator */}
                          <select
                            value={threshold.operator}
                            onChange={(e) =>
                              updateThreshold(index, "operator", e.target.value)
                            }
                            className="min-h-[36px] px-2 rounded-md border border-input bg-background w-16"
                          >
                            {OPERATOR_OPTIONS.map((op) => (
                              <option key={op.value} value={op.value}>
                                {op.label}
                              </option>
                            ))}
                          </select>

                          {/* Value */}
                          <Input
                            type="number"
                            step="any"
                            value={threshold.value}
                            onChange={(e) =>
                              updateThreshold(index, "value", e.target.value)
                            }
                            className="min-h-[36px] w-20"
                            placeholder="Value"
                          />

                          <span className="text-muted-foreground">→</span>

                          {/* Severity */}
                          <select
                            value={threshold.severity}
                            onChange={(e) =>
                              updateThreshold(index, "severity", e.target.value)
                            }
                            className={`min-h-[36px] px-2 rounded-md border w-24 ${
                              SEVERITY_OPTIONS.find((s) => s.value === threshold.severity)
                                ?.color || ""
                            }`}
                          >
                            {SEVERITY_OPTIONS.map((sev) => (
                              <option key={sev.value} value={sev.value}>
                                {sev.label}
                              </option>
                            ))}
                          </select>

                          {/* Message */}
                          <Input
                            type="text"
                            value={threshold.message || ""}
                            onChange={(e) =>
                              updateThreshold(index, "message", e.target.value)
                            }
                            className="min-h-[36px] flex-1 min-w-[120px]"
                            placeholder="Alarm message (optional)"
                          />

                          {/* Delete button */}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeThreshold(index)}
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add threshold button */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addThreshold}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Threshold
                  </Button>

                  {/* Help text */}
                  <p className="text-xs text-muted-foreground">
                    Thresholds are evaluated in order. Add multiple conditions to trigger
                    different severity levels (e.g., &gt;70 → Warning, &gt;80 → Critical).
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="min-h-[44px] w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button type="submit" className="min-h-[44px] w-full sm:w-auto">
              {mode === "edit" ? "Save Changes" : "Add Register"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
