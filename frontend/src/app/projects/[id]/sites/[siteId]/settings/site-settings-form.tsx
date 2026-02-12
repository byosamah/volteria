"use client";

/**
 * Site Settings Form
 *
 * Client component for editing site settings.
 * Sites are physical locations with controllers.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";

// Info icon component for tooltips
function InfoIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 text-muted-foreground cursor-help"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

// Site type (matches database schema for sites table)
interface Site {
  id: string;
  project_id: string;
  name: string;
  location: string | null;
  description: string | null;
  is_active: boolean;
  controller_serial_number: string | null;
  controller_status: string | null;
  // Control method fields
  control_method: string | null;
  control_method_backup: string | null;
  grid_connection: string | null;
  // Control settings
  dg_reserve_kw: number;
  control_interval_ms: number;
  operation_mode: string | null;
  // Logging settings
  logging_local_interval_ms: number;
  logging_cloud_interval_ms: number;
  logging_local_retention_days: number;
  logging_local_enabled: boolean;
  logging_cloud_enabled: boolean;
  logging_gateway_enabled: boolean;
  // Safe mode settings
  safe_mode_enabled: boolean;
  safe_mode_type: string;
  safe_mode_timeout_s: number;
  safe_mode_rolling_window_min: number;
  safe_mode_threshold_pct: number;
  safe_mode_power_limit_kw: number | null;
}

interface SiteSettingsFormProps {
  site: Site;
  projectId: string;
}

export function SiteSettingsForm({ site, projectId }: SiteSettingsFormProps) {
  const router = useRouter();

  // Form state
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    // Basic info
    name: site.name,
    location: site.location || "",
    description: site.description || "",
    is_active: site.is_active,
    controller_serial_number: site.controller_serial_number || "",
    // Control method
    control_method: site.control_method || "onsite_controller",
    control_method_backup: site.control_method_backup || "none",
    grid_connection: site.grid_connection || "off_grid",
    // Control settings
    dg_reserve_kw: site.dg_reserve_kw || 0,
    control_interval_ms: site.control_interval_ms || 1000,
    operation_mode: site.operation_mode || "zero_dg_reverse",
    // Logging settings
    logging_local_interval_ms: site.logging_local_interval_ms || 1000,
    logging_cloud_interval_ms: site.logging_cloud_interval_ms || 180000,  // 3 min default
    logging_local_retention_days: site.logging_local_retention_days || 30,
    logging_local_enabled: site.logging_local_enabled ?? true,
    logging_cloud_enabled: site.logging_cloud_enabled ?? true,
    logging_gateway_enabled: site.logging_gateway_enabled ?? false,
    // Safe mode settings
    safe_mode_enabled: site.safe_mode_enabled ?? true,
    safe_mode_type: site.safe_mode_type || "time_based",
    safe_mode_timeout_s: site.safe_mode_timeout_s || 30,
    safe_mode_rolling_window_min: site.safe_mode_rolling_window_min || 5,
    safe_mode_threshold_pct: site.safe_mode_threshold_pct || 80,
    safe_mode_power_limit_kw: site.safe_mode_power_limit_kw || 0,
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
        toast.error("Site name is required");
        setLoading(false);
        return;
      }

      // Update site via backend API (bypasses RLS on sites table)
      const response = await fetch(`/api/sites/${site.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          location: formData.location.trim() || null,
          description: formData.description.trim() || null,
          controller_serial_number: formData.controller_serial_number.trim() || null,
          control_method: formData.control_method,
          control_method_backup: formData.control_method_backup,
          grid_connection: formData.grid_connection,
          is_active: formData.is_active,
          control: {
            interval_ms: formData.control_interval_ms,
            dg_reserve_kw: formData.dg_reserve_kw,
            operation_mode: formData.operation_mode,
          },
          logging: {
            local_interval_ms: formData.logging_local_interval_ms,
            cloud_interval_ms: formData.logging_cloud_interval_ms,
            local_retention_days: formData.logging_local_retention_days,
            local_enabled: formData.logging_local_enabled,
            cloud_enabled: formData.logging_cloud_enabled,
            gateway_enabled: formData.logging_gateway_enabled,
          },
          safe_mode: {
            enabled: formData.safe_mode_enabled,
            type: formData.safe_mode_type,
            timeout_s: formData.safe_mode_timeout_s,
            rolling_window_min: formData.safe_mode_rolling_window_min,
            threshold_pct: formData.safe_mode_threshold_pct,
            power_limit_kw: formData.safe_mode_power_limit_kw || null,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        console.error("Error updating site:", errorData);
        toast.error(errorData?.error || errorData?.detail || "Failed to update site");
        setLoading(false);
        return;
      }

      // Success — navigate back to site page for fresh render
      toast.success("Site settings updated successfully");
      router.push(`/projects/${projectId}/sites/${site.id}`);
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <TooltipProvider>
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Information */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Basic Information</h3>

        <div className="space-y-2">
          <Label htmlFor="name">
            Site Name <span className="text-red-500">*</span>
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
            placeholder="e.g., Riyadh Industrial Area"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            placeholder="Optional description of this site"
          />
        </div>
      </div>

      <Separator />

      {/* Controller Registration */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Controller Registration</h3>

        <div className="space-y-2">
          <Label htmlFor="controller_serial_number" className="flex items-center gap-1.5">
            Controller Serial Number
            <Tooltip>
              <TooltipTrigger asChild>
                <span><InfoIcon /></span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>Unique identifier for the controller at this site. Used for secure communication with the cloud platform.</p>
              </TooltipContent>
            </Tooltip>
          </Label>
          <Input
            id="controller_serial_number"
            name="controller_serial_number"
            value={formData.controller_serial_number}
            onChange={handleChange}
            placeholder="e.g., RPI5-001"
          />
        </div>
      </div>

      <Separator />

      {/* Control Method */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Control Method</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="control_method" className="flex items-center gap-1.5">
              Control Method
              <Tooltip>
                <TooltipTrigger asChild>
                  <span><InfoIcon /></span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>How the site is controlled. On-site controller runs locally (works offline). Gateway API sends commands through Netbiter (requires internet).</p>
                </TooltipContent>
              </Tooltip>
            </Label>
            <select
              id="control_method"
              name="control_method"
              value={formData.control_method}
              onChange={handleChange}
              className="w-full h-10 px-3 rounded-md border border-input bg-background"
            >
              <option value="onsite_controller">On-site Controller</option>
              <option value="gateway_api">Gateway API</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="control_method_backup" className="flex items-center gap-1.5">
              Backup Method
              <Tooltip>
                <TooltipTrigger asChild>
                  <span><InfoIcon /></span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Fallback control method if primary method fails. Gateway backup switches to cloud control if on-site controller fails.</p>
                </TooltipContent>
              </Tooltip>
            </Label>
            <select
              id="control_method_backup"
              name="control_method_backup"
              value={formData.control_method_backup}
              onChange={handleChange}
              className="w-full h-10 px-3 rounded-md border border-input bg-background"
            >
              <option value="none">None</option>
              <option value="gateway_backup">Gateway Backup</option>
              <option value="controller_backup">Controller Backup</option>
            </select>
          </div>
        </div>
      </div>

      <Separator />

      {/* Control Settings */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Control Settings</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dg_reserve_kw" className="flex items-center gap-1.5">
              Generator Reserve (kW)
              <Tooltip>
                <TooltipTrigger asChild>
                  <span><InfoIcon /></span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Minimum power reserve to maintain on generators to prevent reverse feeding. Set to 0 for zero-export mode.</p>
                </TooltipContent>
              </Tooltip>
            </Label>
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
            <Label htmlFor="control_interval_ms" className="flex items-center gap-1.5">
              Control Interval (ms)
              <Tooltip>
                <TooltipTrigger asChild>
                  <span><InfoIcon /></span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>How often the control loop runs to read meters and adjust inverter power limits. Lower = faster response, higher CPU usage.</p>
                </TooltipContent>
              </Tooltip>
            </Label>
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

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="grid_connection" className="flex items-center gap-1.5">
              Grid Connection
              <Tooltip>
                <TooltipTrigger asChild>
                  <span><InfoIcon /></span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Type of grid connection. Off-grid: Diesel generators + solar. On-grid: Connected to utility grid.</p>
                </TooltipContent>
              </Tooltip>
            </Label>
            <select
              id="grid_connection"
              name="grid_connection"
              value={formData.grid_connection}
              onChange={handleChange}
              className="w-full h-10 px-3 rounded-md border border-input bg-background"
            >
              <option value="off_grid">Off-grid</option>
              <option value="on_grid">On-grid</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="operation_mode" className="flex items-center gap-1.5">
              Operation Mode
              <Tooltip>
                <TooltipTrigger asChild>
                  <span><InfoIcon /></span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Control algorithm to use. Zero Generator Feed prevents reverse power flow to generators.</p>
                </TooltipContent>
              </Tooltip>
            </Label>
            <select
              id="operation_mode"
              name="operation_mode"
              value={formData.operation_mode}
              onChange={handleChange}
              className="w-full h-10 px-3 rounded-md border border-input bg-background"
            >
              <option value="zero_dg_reverse">Zero Generator Feed</option>
              <option value="peak_shaving">Peak Shaving</option>
              <option value="manual">Manual</option>
            </select>
          </div>
        </div>
      </div>

      <Separator />

      {/* Logging Settings */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Logging Settings</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="logging_local_interval_ms" className="flex items-center gap-1.5">
              Local Log Interval (ms)
              <Tooltip>
                <TooltipTrigger asChild>
                  <span><InfoIcon /></span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>How often data is logged to local storage on the controller. Used for offline buffering and historical analysis.</p>
                </TooltipContent>
              </Tooltip>
            </Label>
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
            <Label htmlFor="logging_cloud_interval_ms" className="flex items-center gap-1.5">
              Cloud Sync Interval (ms)
              <Tooltip>
                <TooltipTrigger asChild>
                  <span><InfoIcon /></span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>How often to batch and push data to cloud. Readings are downsampled per-register based on their logging frequency. Recommended: 180000ms (3 min).</p>
                </TooltipContent>
              </Tooltip>
            </Label>
            <Input
              id="logging_cloud_interval_ms"
              name="logging_cloud_interval_ms"
              type="number"
              min={60000}
              step={60000}
              value={formData.logging_cloud_interval_ms}
              onChange={handleChange}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="logging_local_retention_days" className="flex items-center gap-1.5">
              Local Retention (days)
              <Tooltip>
                <TooltipTrigger asChild>
                  <span><InfoIcon /></span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>How long to keep logs on the local controller. Older logs are automatically deleted to save storage space.</p>
                </TooltipContent>
              </Tooltip>
            </Label>
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

        {/* Logging Toggles */}
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex items-center gap-2 p-3 border rounded-md cursor-pointer hover:bg-muted/50">
            <input
              type="checkbox"
              name="logging_local_enabled"
              checked={formData.logging_local_enabled}
              onChange={handleChange}
              className="h-4 w-4 rounded border-gray-300"
            />
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium">Local Logging</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span><InfoIcon /></span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Enable local SQLite logging on the controller. Stores all readings at the local interval for offline buffering and backup.</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </label>

          <label className="flex items-center gap-2 p-3 border rounded-md cursor-pointer hover:bg-muted/50">
            <input
              type="checkbox"
              name="logging_cloud_enabled"
              checked={formData.logging_cloud_enabled}
              onChange={handleChange}
              className="h-4 w-4 rounded border-gray-300"
            />
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium">Cloud Logging</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span><InfoIcon /></span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Enable cloud sync through the on-site controller. Data is sent to the cloud platform based on per-register logging frequency.</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </label>

          <label className="flex items-center gap-2 p-3 border rounded-md cursor-pointer hover:bg-muted/50">
            <input
              type="checkbox"
              name="logging_gateway_enabled"
              checked={formData.logging_gateway_enabled}
              onChange={handleChange}
              className="h-4 w-4 rounded border-gray-300"
            />
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium">Gateway Logging</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span><InfoIcon /></span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Enable logging through gateway (e.g., Netbiter). Useful as backup or when controller has no direct internet access.</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </label>
        </div>
      </div>

      <Separator />

      {/* Safe Mode Settings */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium flex items-center gap-1.5">
            Safe Mode
            <Tooltip>
              <TooltipTrigger asChild>
                <span><InfoIcon /></span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>Protective mode that limits inverter power when communication with devices is lost. Prevents uncontrolled operation.</p>
              </TooltipContent>
            </Tooltip>
          </h3>
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

            <div className="space-y-2">
              <Label htmlFor="safe_mode_power_limit_kw" className="flex items-center gap-1.5">
                Power Limit When Active (kW)
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span><InfoIcon /></span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>Maximum inverter power when safe mode is active. Set to 0 to fully disable solar output in safe mode.</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Input
                id="safe_mode_power_limit_kw"
                name="safe_mode_power_limit_kw"
                type="number"
                min={0}
                step={1}
                value={formData.safe_mode_power_limit_kw}
                onChange={handleChange}
              />
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Status - Deactivate Site */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Site Status</h3>

        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="is_active" className="text-base">Active</Label>
              <p className="text-sm text-muted-foreground">
                Control whether this site is operational
              </p>
            </div>
            <Switch
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, is_active: checked }))}
            />
          </div>
          {!formData.is_active && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
              <p className="text-sm text-amber-800">
                <strong>Warning:</strong> Deactivating this site will stop all site services including control loops, data logging, and cloud sync. The site will become non-operational.
              </p>
              <p className="text-sm text-amber-700 mt-2">
                Historical data will be preserved in the database and can be viewed in Historical Data page.
              </p>
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Form Actions */}
      <div className="flex gap-4">
        <Button type="submit" disabled={loading}>
          {loading ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
    </TooltipProvider>
  );
}
