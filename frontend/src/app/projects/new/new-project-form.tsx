"use client";

/**
 * New Project Form Component
 *
 * Client component that handles form submission.
 * Creates a new project in Supabase.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import Link from "next/link";

export function NewProjectForm() {
  const router = useRouter();
  const supabase = createClient();

  // Form state
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    // Basic info
    name: "",
    location: "",
    description: "",

    // Controller info
    controller_serial_number: "",

    // Control settings (defaults from plan)
    dg_reserve_kw: 50,
    control_interval_ms: 1000,

    // Logging settings
    logging_local_interval_ms: 1000,
    logging_cloud_interval_ms: 5000,
    logging_local_retention_days: 7,

    // Safe mode settings
    safe_mode_enabled: true,
    safe_mode_type: "rolling_average",
    safe_mode_timeout_s: 30,
    safe_mode_rolling_window_min: 3,
    safe_mode_threshold_pct: 80,
  });

  // Handle input changes
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;

    // Handle different input types
    if (type === "checkbox") {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData((prev) => ({ ...prev, [name]: checked }));
    } else if (type === "number") {
      setFormData((prev) => ({ ...prev, [name]: parseFloat(value) || 0 }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate required fields
      if (!formData.name.trim()) {
        toast.error("Project name is required");
        setLoading(false);
        return;
      }

      // Create project in Supabase
      const { data, error } = await supabase
        .from("projects")
        .insert({
          name: formData.name.trim(),
          location: formData.location.trim() || null,
          description: formData.description.trim() || null,
          controller_serial_number: formData.controller_serial_number.trim() || null,
          controller_status: "offline", // New projects start offline
          dg_reserve_kw: formData.dg_reserve_kw,
          control_interval_ms: formData.control_interval_ms,
          logging_local_interval_ms: formData.logging_local_interval_ms,
          logging_cloud_interval_ms: formData.logging_cloud_interval_ms,
          logging_local_retention_days: formData.logging_local_retention_days,
          safe_mode_enabled: formData.safe_mode_enabled,
          safe_mode_type: formData.safe_mode_type,
          safe_mode_timeout_s: formData.safe_mode_timeout_s,
          safe_mode_rolling_window_min: formData.safe_mode_rolling_window_min,
          safe_mode_threshold_pct: formData.safe_mode_threshold_pct,
          operation_mode: "zero_dg_reverse", // Default mode
          is_active: true,
        })
        .select()
        .single();

      if (error) {
        console.error("Error creating project:", error);
        toast.error(error.message || "Failed to create project");
        setLoading(false);
        return;
      }

      // Success!
      toast.success("Project created successfully");
      router.push(`/projects/${data.id}`);
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Information */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">
            Project Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="name"
            name="name"
            placeholder="e.g., Stone Crushing Site 1"
            value={formData.name}
            onChange={handleChange}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <Input
            id="location"
            name="location"
            placeholder="e.g., Dubai, UAE"
            value={formData.location}
            onChange={handleChange}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            name="description"
            placeholder="Brief description of the site"
            value={formData.description}
            onChange={handleChange}
          />
        </div>
      </div>

      <Separator />

      {/* Controller Registration */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Controller Registration</h3>
        <p className="text-sm text-muted-foreground">
          Optional: Register the hardware controller for this site
        </p>

        <div className="space-y-2">
          <Label htmlFor="controller_serial_number">Controller Serial Number</Label>
          <Input
            id="controller_serial_number"
            name="controller_serial_number"
            placeholder="e.g., RPI5-2024-001"
            value={formData.controller_serial_number}
            onChange={handleChange}
          />
          <p className="text-xs text-muted-foreground">
            Enter the serial number of your Raspberry Pi 5 controller
          </p>
        </div>
      </div>

      <Separator />

      {/* Control Settings */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Control Settings</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dg_reserve_kw">DG Reserve (kW)</Label>
            <Input
              id="dg_reserve_kw"
              name="dg_reserve_kw"
              type="number"
              min={0}
              step={1}
              value={formData.dg_reserve_kw}
              onChange={handleChange}
            />
            <p className="text-xs text-muted-foreground">
              Minimum power reserve on diesel generators
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="control_interval_ms">Control Interval (ms)</Label>
            <Input
              id="control_interval_ms"
              name="control_interval_ms"
              type="number"
              min={100}
              step={100}
              value={formData.control_interval_ms}
              onChange={handleChange}
            />
            <p className="text-xs text-muted-foreground">
              How often the control loop runs
            </p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Safe Mode Settings */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium">Safe Mode</h3>
            <p className="text-sm text-muted-foreground">
              Protection when communication is lost
            </p>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="safe_mode_enabled"
              checked={formData.safe_mode_enabled}
              onChange={handleChange}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm">Enabled</span>
          </label>
        </div>

        {formData.safe_mode_enabled && (
          <div className="space-y-4 pl-4 border-l-2 border-muted">
            <div className="space-y-2">
              <Label htmlFor="safe_mode_type">Mode Type</Label>
              <select
                id="safe_mode_type"
                name="safe_mode_type"
                value={formData.safe_mode_type}
                onChange={handleChange}
                className="w-full h-10 px-3 rounded-md border border-input bg-background"
              >
                <option value="time_based">Time Based</option>
                <option value="rolling_average">Rolling Average</option>
              </select>
            </div>

            {formData.safe_mode_type === "time_based" ? (
              <div className="space-y-2">
                <Label htmlFor="safe_mode_timeout_s">Timeout (seconds)</Label>
                <Input
                  id="safe_mode_timeout_s"
                  name="safe_mode_timeout_s"
                  type="number"
                  min={5}
                  step={1}
                  value={formData.safe_mode_timeout_s}
                  onChange={handleChange}
                />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="safe_mode_rolling_window_min">
                    Rolling Window (minutes)
                  </Label>
                  <Input
                    id="safe_mode_rolling_window_min"
                    name="safe_mode_rolling_window_min"
                    type="number"
                    min={1}
                    step={1}
                    value={formData.safe_mode_rolling_window_min}
                    onChange={handleChange}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="safe_mode_threshold_pct">Threshold (%)</Label>
                  <Input
                    id="safe_mode_threshold_pct"
                    name="safe_mode_threshold_pct"
                    type="number"
                    min={50}
                    max={100}
                    step={1}
                    value={formData.safe_mode_threshold_pct}
                    onChange={handleChange}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Separator />

      {/* Form Actions */}
      <div className="flex gap-4">
        <Button type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create Project"}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/projects">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
