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

// Modbus register type
export interface ModbusRegister {
  address: number;
  name: string;
  description?: string;
  type: "input" | "holding";
  access: "read" | "write" | "readwrite";
  datatype: "uint16" | "int16" | "uint32" | "int32" | "float32";
  scale?: number;
  unit?: string;
  min?: number;
  max?: number;
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
}

export function RegisterForm({
  mode,
  register,
  existingRegisters = [],
  open,
  onOpenChange,
  onSave,
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
    unit: string;
    min: string;
    max: string;
  }>({
    address: "",
    name: "",
    description: "",
    type: "input",
    access: "read",
    datatype: "uint16",
    scale: "1",
    unit: "",
    min: "",
    max: "",
  });

  const [errors, setErrors] = useState<string[]>([]);

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
          unit: register.unit || "",
          min: register.min?.toString() || "",
          max: register.max?.toString() || "",
        });
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
          unit: "",
          min: "",
          max: "",
        });
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
      // Check for valid snake_case name
      if (!/^[a-z][a-z0-9_]*$/.test(formData.name)) {
        newErrors.push("Name must be lowercase with underscores (snake_case)");
      }
      // Check for duplicate name (excluding current register in edit mode)
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
    if (formData.unit.trim()) {
      newRegister.unit = formData.unit.trim();
    }
    if (formData.min.trim()) {
      newRegister.min = parseFloat(formData.min);
    }
    if (formData.max.trim()) {
      newRegister.max = parseFloat(formData.max);
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
                Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g., active_power"
                value={formData.name}
                onChange={handleChange}
                className="min-h-[44px]"
                required
              />
              <p className="text-xs text-muted-foreground">snake_case</p>
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

          {/* Datatype and Scale - side by side */}
          <div className="grid gap-4 sm:grid-cols-2">
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

            <div className="space-y-2">
              <Label htmlFor="scale">Scale Factor</Label>
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
              <p className="text-xs text-muted-foreground">
                Multiplier for raw value
              </p>
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
