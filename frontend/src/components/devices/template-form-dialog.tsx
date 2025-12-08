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
}

export function TemplateFormDialog({
  mode,
  template,
  open,
  onOpenChange,
  onSaved,
}: TemplateFormDialogProps) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);

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
      } else {
        // Creating: reset to empty form
        setFormData({
          template_id: "",
          name: "",
          device_type: "inverter",
          brand: "",
          model: "",
          rated_power_kw: "",
          template_type: "public",
        });
      }
    }
  }, [open, mode, template]);

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

      // Prepare data for Supabase
      const templateData = {
        template_id: formData.template_id.trim(),
        name: formData.name.trim(),
        device_type: formData.device_type,
        brand: formData.brand.trim(),
        model: formData.model.trim(),
        rated_power_kw: formData.rated_power_kw
          ? parseFloat(formData.rated_power_kw)
          : null,
        template_type: formData.template_type,  // 'public' or 'custom'
      };

      if (mode === "edit" && template) {
        // Update existing template
        const { data, error } = await supabase
          .from("device_templates")
          .update(templateData)
          .eq("id", template.id)
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
      <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-lg">
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
                className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
                required
              >
                <option value="public">Public (visible to all)</option>
                <option value="custom">Custom (enterprise-specific)</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Public templates are available to all users
              </p>
            </div>
          </div>

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
    </Dialog>
  );
}
