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
import { Trash2, Plus, ChevronDown, ChevronUp, X } from "lucide-react";
import type { AlarmThreshold, AlarmSeverity, ThresholdOperator } from "@/lib/types";

// Import new sub-components for enhanced fields
import { GroupCombobox } from "./group-combobox";
import { EnumerationEditor, type EnumerationEntry } from "./enumeration-editor";
import { BitMaskSelector } from "./bit-mask-selector";

// Modbus register type
export interface ModbusRegister {
  address: number;
  name: string;  // Display name (any format, e.g., "Active Power")
  alias?: string;  // Code-friendly name (auto-generated, e.g., "active_power")
  description?: string;
  type: "input" | "holding";
  access: "read" | "write" | "readwrite";
  datatype: "uint16" | "int16" | "uint32" | "int32" | "float32" | "float64" | "utf8";
  scale?: number;  // Multiplication factor
  offset?: number;  // Addition factor (can be negative)
  scale_order?: "multiply_first" | "add_first";  // Which operation happens first
  logging_frequency?: number;  // Logging frequency in seconds
  unit?: string;
  min?: number;
  max?: number;
  register_role?: string;  // Control logic role (e.g., "solar_active_power")
  thresholds?: AlarmThreshold[];  // Alarm thresholds for alarm registers

  // Additional fields for advanced configuration
  group?: string;  // Group name for organizing registers
  values?: Record<string, string>;  // Enumeration: raw value -> display label
  mask?: {  // Bit mask for extracting specific bits
    enabled: boolean;
    hex_value: string;
    bits: boolean[];
  };
  decimals?: number;  // Display precision (0-10)
  size?: number;  // Register count override (for UTF8 multi-register strings)

  // Template linkage tracking
  // "template": Read-only at device level, synced from template
  // "manual": Editable at device level, preserved across template sync
  source?: "template" | "manual";
}

// Severity options for alarm thresholds
const SEVERITY_OPTIONS: { value: AlarmSeverity; label: string; color: string }[] = [
  { value: "warning", label: "Warning", color: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  { value: "minor", label: "Minor", color: "bg-amber-100 text-amber-800 border-amber-300" },
  { value: "major", label: "Major", color: "bg-orange-100 text-orange-800 border-orange-300" },
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

// Logging frequency options (in seconds) - minimum 1 second to prevent excessive cloud sync
const LOGGING_FREQUENCY_OPTIONS = [
  { value: "1", label: "1 second" },
  { value: "5", label: "5 seconds" },
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

// Register role options - defines how this register is used in control logic and calculated fields
// This list can be extended when new operational modes are added
const REGISTER_ROLE_OPTIONS = [
  { value: "none", label: "None (not used)" },
  // Solar Inverter roles
  { value: "solar_active_power", label: "Solar: Total Active Power" },
  { value: "solar_reactive_power", label: "Solar: Total Reactive Power" },
  { value: "solar_power_limit_read", label: "Solar: Power Limit (Read)" },
  { value: "solar_power_limit_write", label: "Solar: Power Limit Control (Write)" },
  { value: "solar_reactive_limit_read", label: "Solar: Reactive Limit (Read)" },
  { value: "solar_reactive_limit_write", label: "Solar: Reactive Limit Control (Write)" },
  { value: "solar_kwh_counter", label: "Solar: Total kWh Counter" },
  // Load Meter roles
  { value: "load_active_power", label: "Load: Total Active Power" },
  { value: "load_reactive_power", label: "Load: Total Reactive Power" },
  { value: "load_kwh_counter", label: "Load: Total kWh Counter" },
  // Sub Load Meter roles
  { value: "subload_active_power", label: "Sub Load: Total Active Power" },
  { value: "subload_reactive_power", label: "Sub Load: Total Reactive Power" },
  { value: "subload_kwh_counter", label: "Sub Load: Total kWh Counter" },
  // Diesel Generator roles
  { value: "diesel_generator_active_power", label: "Diesel Generator: Total Active Power" },
  { value: "diesel_generator_reactive_power", label: "Diesel Generator: Total Reactive Power" },
  { value: "diesel_generator_kwh_counter", label: "Diesel Generator: Total kWh Counter" },
  // Gas Generator roles
  { value: "gas_generator_active_power", label: "Gas Generator: Total Active Power" },
  { value: "gas_generator_reactive_power", label: "Gas Generator: Total Reactive Power" },
  { value: "gas_generator_kwh_counter", label: "Gas Generator: Total kWh Counter" },
  // Fuel Sensor roles (standalone sensors)
  { value: "fuel_volume", label: "Fuel: Volume" },
  { value: "fuel_level", label: "Fuel: Level" },
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
  // Whether this is a visualization register (hides logging frequency - live only, not stored)
  isVisualizationRegister?: boolean;
  // Existing groups from template (for group dropdown)
  existingGroups?: string[];
}

export function RegisterForm({
  mode,
  register,
  existingRegisters = [],
  open,
  onOpenChange,
  onSave,
  isAlarmRegister = false,
  isVisualizationRegister = false,
  existingGroups = [],
}: RegisterFormProps) {
  // Form state
  const [formData, setFormData] = useState<{
    address: string;
    name: string;
    description: string;
    type: "input" | "holding";
    access: "read" | "write" | "readwrite";
    datatype: "uint16" | "int16" | "uint32" | "int32" | "float32" | "float64" | "utf8";
    scale: string;
    offset: string;
    scale_order: "multiply_first" | "add_first";
    logging_frequency: string;
    unit: string;
    min: string;
    max: string;
    register_role: string;  // Control logic role
    // New fields
    group: string;
    decimals: string;
    size: string;  // Register count override (for UTF8)
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
    // New field defaults
    group: "",
    decimals: "",
    size: "",
  });

  const [errors, setErrors] = useState<string[]>([]);

  // Alarm thresholds state (only used when isAlarmRegister is true)
  const [thresholds, setThresholds] = useState<AlarmThreshold[]>([]);
  const [thresholdsExpanded, setThresholdsExpanded] = useState(false);

  // Enumeration state (value-label mappings)
  const [enumerationValues, setEnumerationValues] = useState<EnumerationEntry[]>([]);
  const [enumerationDialogOpen, setEnumerationDialogOpen] = useState(false);

  // Bit mask state
  const [maskEnabled, setMaskEnabled] = useState(false);
  const [maskHex, setMaskHex] = useState("");
  const [maskBits, setMaskBits] = useState<boolean[]>(new Array(16).fill(false));

  // Helper to determine bit count based on datatype
  const getBitCount = (datatype: string): 16 | 32 => {
    return datatype?.includes("32") ? 32 : 16;
  };

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
          datatype: register.datatype || "uint16",
          scale: register.scale?.toString() || "1",
          offset: register.offset?.toString() || "0",
          scale_order: register.scale_order || "multiply_first",
          logging_frequency: register.logging_frequency?.toString() || "60",
          unit: register.unit || "",
          min: register.min?.toString() || "",
          max: register.max?.toString() || "",
          register_role: register.register_role || "none",
          // Load new fields
          group: register.group || "",
          decimals: register.decimals?.toString() || "",
          size: register.size?.toString() || "",
        });
        // Load existing thresholds if editing an alarm register
        setThresholds(register.thresholds || []);
        setThresholdsExpanded((register.thresholds?.length || 0) > 0);
        // Load enumeration values (convert Record to array)
        if (register.values) {
          setEnumerationValues(
            Object.entries(register.values).map(([key, label]) => ({
              key,
              label: String(label),
            }))
          );
        } else {
          setEnumerationValues([]);
        }
        // Load bit mask state
        if (register.mask) {
          setMaskEnabled(register.mask.enabled);
          setMaskHex(register.mask.hex_value || "");
          setMaskBits(register.mask.bits || new Array(getBitCount(register.datatype || "uint16")).fill(false));
        } else {
          setMaskEnabled(false);
          setMaskHex("");
          setMaskBits(new Array(getBitCount(register.datatype || "uint16")).fill(false));
        }
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
          // New field defaults
          group: "",
          decimals: "",
          size: "",
        });
        // For alarm registers: pre-populate with one empty threshold and auto-expand
        // Alarms REQUIRE at least one threshold, so we start with one to guide the user
        if (isAlarmRegister) {
          setThresholds([{ operator: ">" as ThresholdOperator, value: 0, severity: "warning" as AlarmSeverity, message: "" }]);
          setThresholdsExpanded(true);
        } else {
          // Reset thresholds when adding normal register
          setThresholds([]);
          setThresholdsExpanded(false);
        }
        // Reset enumeration
        setEnumerationValues([]);
        // Reset bit mask
        setMaskEnabled(false);
        setMaskHex("");
        setMaskBits(new Array(16).fill(false));
      }
      setErrors([]);
    }
  }, [open, mode, register, isAlarmRegister]);

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

    // Alarm registers REQUIRE at least one threshold to define when alarms trigger
    if (isAlarmRegister && thresholds.length === 0) {
      newErrors.push("At least one threshold is required for alarm registers");
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
    // Always save logging_frequency (default 60 seconds = 1 minute)
    // This ensures the value is stored in the database and synced to the controller
    // ALWAYS include this field, even with default value, to prevent config sync issues
    newRegister.logging_frequency = formData.logging_frequency
      ? parseFloat(formData.logging_frequency)
      : 60;  // Default: 60 seconds (1 minute)
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

    // Add new fields: group, enumeration, mask, decimals
    if (formData.group.trim()) {
      newRegister.group = formData.group.trim();
    }

    // Add enumeration values (convert array to Record)
    if (enumerationValues.length > 0) {
      const validValues = enumerationValues.filter((v) => v.key && v.label);
      if (validValues.length > 0) {
        newRegister.values = validValues.reduce(
          (acc, { key, label }) => {
            acc[key] = label;
            return acc;
          },
          {} as Record<string, string>
        );
      }
    }

    // Add bit mask if enabled (only for integer types)
    if (maskEnabled && formData.datatype !== "float32") {
      newRegister.mask = {
        enabled: true,
        hex_value: maskHex,
        bits: maskBits,
      };
    }

    // Add decimals if specified
    if (formData.decimals) {
      const dec = parseInt(formData.decimals);
      if (!isNaN(dec) && dec >= 0 && dec <= 10) {
        newRegister.decimals = dec;
      }
    }

    // Add size if specified (for UTF8 multi-register strings)
    if (formData.size) {
      const sz = parseInt(formData.size);
      if (!isNaN(sz) && sz > 0) {
        newRegister.size = sz;
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

          {/* Register Role - what is this register used for in control logic and calculated fields */}
          <div className="space-y-2">
            <Label htmlFor="register_role">
              Register Role
              <span className="text-xs text-muted-foreground ml-2">
                (used in control logic and calculated fields)
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
              <option value="float64">float64 (64-bit double)</option>
              <option value="utf8">utf8 (text string)</option>
            </select>
          </div>

          {/* Size (register count) - shown for UTF8 datatype */}
          {formData.datatype === "utf8" && (
            <div className="space-y-2">
              <Label htmlFor="size">
                Size (registers) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="size"
                name="size"
                type="number"
                min={1}
                max={125}
                placeholder="e.g., 20"
                value={formData.size}
                onChange={handleChange}
                className="min-h-[44px]"
              />
              <p className="text-xs text-muted-foreground">
                Number of 16-bit registers to read (each = 2 bytes of text)
              </p>
            </div>
          )}

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

          {/* ========== NEW FIELDS SECTION ========== */}

          {/* Group - Full width */}
          <div className="space-y-2">
            <Label>Group</Label>
            <GroupCombobox
              value={formData.group}
              onChange={(value) => setFormData((prev) => ({ ...prev, group: value }))}
              groups={existingGroups}
              placeholder="Select or create group..."
            />
            <p className="text-xs text-muted-foreground">
              Organize registers into collapsible groups
            </p>
          </div>

          {/* Enumeration and Decimals - side by side */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Enumeration */}
            <div className="space-y-2">
              <Label>Enumeration</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px] flex-1 justify-start"
                  onClick={() => setEnumerationDialogOpen(true)}
                >
                  {enumerationValues.length > 0
                    ? `${enumerationValues.length} value${enumerationValues.length > 1 ? "s" : ""} defined`
                    : "Edit Values..."}
                </Button>
                {enumerationValues.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setEnumerationValues([])}
                    className="h-10 w-10 text-muted-foreground hover:text-destructive"
                    title="Clear all values"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Map raw values to labels (e.g., 0=Off, 1=On)
              </p>
            </div>

            {/* Decimals */}
            <div className="space-y-2">
              <Label htmlFor="decimals">Display Decimals</Label>
              <Input
                id="decimals"
                name="decimals"
                type="number"
                min={0}
                max={10}
                placeholder="Auto"
                value={formData.decimals}
                onChange={handleChange}
                className="min-h-[44px]"
              />
              <p className="text-xs text-muted-foreground">
                Decimal places for display (0-10)
              </p>
            </div>
          </div>

          {/* Bit Mask - only for integer types (NOT float32) */}
          {formData.datatype !== "float32" && (
            <BitMaskSelector
              enabled={maskEnabled}
              onEnabledChange={setMaskEnabled}
              hexValue={maskHex}
              onHexChange={setMaskHex}
              bits={maskBits}
              onBitsChange={setMaskBits}
              bitCount={getBitCount(formData.datatype)}
            />
          )}

          {/* ========== END NEW FIELDS SECTION ========== */}

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

          {/* Logging Frequency - NOT shown for alarm or visualization registers */}
          {/* Alarm registers are event-based; visualization registers are live-only (not stored) */}
          {!isAlarmRegister && !isVisualizationRegister && (
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
          )}

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
                  Thresholds <span className="text-red-500">*</span>
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
                    <p className="text-xs text-red-500 text-center py-2">
                      At least one threshold is required. Click &quot;Add Threshold&quot; below.
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

                          {/* Message (max 30 characters) */}
                          <div className="flex-1 min-w-[120px] flex items-center gap-1">
                            <Input
                              type="text"
                              value={threshold.message || ""}
                              onChange={(e) =>
                                updateThreshold(index, "message", e.target.value)
                              }
                              className="min-h-[36px] flex-1"
                              placeholder="Alarm message"
                              maxLength={30}
                            />
                            {/* Character counter */}
                            <span className="text-xs text-muted-foreground whitespace-nowrap w-10 text-right">
                              {(threshold.message || "").length}/30
                            </span>
                          </div>

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
                    Thresholds define when alarms trigger. Add multiple conditions for
                    different severity levels (e.g., &gt;70 → Warning, &gt;80 → Critical).
                    Message is limited to 30 characters.
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

      {/* Enumeration Editor Dialog (nested) */}
      <EnumerationEditor
        open={enumerationDialogOpen}
        onOpenChange={setEnumerationDialogOpen}
        values={enumerationValues}
        onChange={setEnumerationValues}
      />
    </Dialog>
  );
}
