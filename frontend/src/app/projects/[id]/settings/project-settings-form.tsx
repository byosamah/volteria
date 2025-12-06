"use client";

/**
 * Project Settings Form
 *
 * Client component for editing project settings.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

// Project type (matches database schema)
interface Project {
  id: string;
  name: string;
  location: string | null;
  description: string | null;
  controller_serial_number: string | null;
  dg_reserve_kw: number;
  control_interval_ms: number;
  logging_local_interval_ms: number;
  logging_cloud_interval_ms: number;
  logging_local_retention_days: number;
  safe_mode_enabled: boolean;
  safe_mode_type: string;
  safe_mode_timeout_s: number;
  safe_mode_rolling_window_min: number;
  safe_mode_threshold_pct: number;
}

interface ProjectSettingsFormProps {
  project: Project;
}

export function ProjectSettingsForm({ project }: ProjectSettingsFormProps) {
  const router = useRouter();
  const supabase = createClient();

  // Form state
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: project.name,
    location: project.location || "",
    description: project.description || "",
    controller_serial_number: project.controller_serial_number || "",
    dg_reserve_kw: project.dg_reserve_kw,
    control_interval_ms: project.control_interval_ms,
    logging_local_interval_ms: project.logging_local_interval_ms,
    logging_cloud_interval_ms: project.logging_cloud_interval_ms,
    logging_local_retention_days: project.logging_local_retention_days,
    safe_mode_enabled: project.safe_mode_enabled,
    safe_mode_type: project.safe_mode_type,
    safe_mode_timeout_s: project.safe_mode_timeout_s,
    safe_mode_rolling_window_min: project.safe_mode_rolling_window_min,
    safe_mode_threshold_pct: project.safe_mode_threshold_pct,
  });

  // Handle input changes
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;

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

      // Update project in Supabase
      const { error } = await supabase
        .from("projects")
        .update({
          name: formData.name.trim(),
          location: formData.location.trim() || null,
          description: formData.description.trim() || null,
          controller_serial_number: formData.controller_serial_number.trim() || null,
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
        })
        .eq("id", project.id);

      if (error) {
        console.error("Error updating project:", error);
        toast.error(error.message || "Failed to update project");
        setLoading(false);
        return;
      }

      // Success!
      toast.success("Project updated successfully");
      router.refresh();
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Information */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Basic Information</h3>

        <div className="space-y-2">
          <Label htmlFor="name">
            Project Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="name"
            name="name"
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
            value={formData.location}
            onChange={handleChange}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            name="description"
            value={formData.description}
            onChange={handleChange}
          />
        </div>
      </div>

      <Separator />

      {/* Controller Registration */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Controller Registration</h3>

        <div className="space-y-2">
          <Label htmlFor="controller_serial_number">Controller Serial Number</Label>
          <Input
            id="controller_serial_number"
            name="controller_serial_number"
            value={formData.controller_serial_number}
            onChange={handleChange}
          />
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
          </div>
        </div>
      </div>

      <Separator />

      {/* Logging Settings */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Logging Settings</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="logging_local_interval_ms">Local Log Interval (ms)</Label>
            <Input
              id="logging_local_interval_ms"
              name="logging_local_interval_ms"
              type="number"
              min={100}
              step={100}
              value={formData.logging_local_interval_ms}
              onChange={handleChange}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="logging_cloud_interval_ms">Cloud Sync Interval (ms)</Label>
            <Input
              id="logging_cloud_interval_ms"
              name="logging_cloud_interval_ms"
              type="number"
              min={1000}
              step={1000}
              value={formData.logging_cloud_interval_ms}
              onChange={handleChange}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="logging_local_retention_days">Local Retention (days)</Label>
            <Input
              id="logging_local_retention_days"
              name="logging_local_retention_days"
              type="number"
              min={1}
              step={1}
              value={formData.logging_local_retention_days}
              onChange={handleChange}
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Safe Mode Settings */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Safe Mode</h3>
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
          {loading ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
