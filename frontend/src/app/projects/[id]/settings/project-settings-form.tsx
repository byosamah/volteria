"use client";

/**
 * Project Settings Form (Simplified)
 *
 * Client component for editing basic project settings.
 * Control settings (DG reserve, logging, safe mode) are at site level.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

// Project type (basic fields only)
interface Project {
  id: string;
  name: string;
  location: string | null;
  description: string | null;
  timezone: string | null;
  is_active: boolean;
}

interface ProjectSettingsFormProps {
  project: Project;
}

export function ProjectSettingsForm({ project }: ProjectSettingsFormProps) {
  const router = useRouter();
  const supabase = createClient();

  // Form state - basic fields only
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: project.name,
    location: project.location || "",
    description: project.description || "",
    timezone: project.timezone || "", // Empty = use browser timezone
    is_active: project.is_active,
  });

  // Handle input changes
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
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
        toast.error("Project name is required");
        setLoading(false);
        return;
      }

      // Update project in Supabase - basic fields only
      const { error } = await supabase
        .from("projects")
        .update({
          name: formData.name.trim(),
          location: formData.location.trim() || null,
          description: formData.description.trim() || null,
          timezone: formData.timezone || "UTC",
          is_active: formData.is_active,
        })
        .eq("id", project.id);

      if (error) {
        console.error("Error updating project:", error);
        toast.error(error.message || "Failed to update project");
        setLoading(false);
        return;
      }

      // Success — navigate back to project page for fresh render
      toast.success("Project updated successfully");
      router.push(`/projects/${project.id}`);
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

        <div className="space-y-2">
          <Label htmlFor="timezone">Timezone</Label>
          <select
            id="timezone"
            value={formData.timezone}
            onChange={(e) => setFormData((prev) => ({ ...prev, timezone: e.target.value }))}
            className="w-full h-10 px-3 rounded-md border border-input bg-background min-h-[44px]"
          >
            <option value="">Browser Timezone (auto-detect based on your device)</option>
            <optgroup label="Common Timezones">
              <option value="UTC">UTC (Coordinated Universal Time)</option>
              <option value="Asia/Dubai">Asia/Dubai (Gulf Standard Time, UTC+4)</option>
              <option value="Asia/Riyadh">Asia/Riyadh (Arabia Standard Time, UTC+3)</option>
              <option value="Asia/Kuwait">Asia/Kuwait (Arabia Standard Time, UTC+3)</option>
              <option value="Asia/Qatar">Asia/Qatar (Arabia Standard Time, UTC+3)</option>
              <option value="Asia/Bahrain">Asia/Bahrain (Arabia Standard Time, UTC+3)</option>
              <option value="Africa/Cairo">Africa/Cairo (Eastern European Time, UTC+2)</option>
              <option value="Europe/London">Europe/London (GMT/BST)</option>
              <option value="Europe/Paris">Europe/Paris (CET/CEST)</option>
              <option value="Europe/Berlin">Europe/Berlin (CET/CEST)</option>
              <option value="America/New_York">America/New_York (Eastern Time)</option>
              <option value="America/Chicago">America/Chicago (Central Time)</option>
              <option value="America/Denver">America/Denver (Mountain Time)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (Pacific Time)</option>
              <option value="Asia/Singapore">Asia/Singapore (Singapore Time, UTC+8)</option>
              <option value="Asia/Hong_Kong">Asia/Hong_Kong (Hong Kong Time, UTC+8)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (Japan Standard Time, UTC+9)</option>
              <option value="Australia/Sydney">Australia/Sydney (AEST/AEDT)</option>
            </optgroup>
            <optgroup label="Middle East">
              <option value="Asia/Muscat">Asia/Muscat (Oman, UTC+4)</option>
              <option value="Asia/Baghdad">Asia/Baghdad (Iraq, UTC+3)</option>
              <option value="Asia/Amman">Asia/Amman (Jordan, UTC+3)</option>
              <option value="Asia/Beirut">Asia/Beirut (Lebanon, UTC+2)</option>
              <option value="Asia/Jerusalem">Asia/Jerusalem (Israel, UTC+2)</option>
            </optgroup>
            <optgroup label="Africa">
              <option value="Africa/Johannesburg">Africa/Johannesburg (South Africa, UTC+2)</option>
              <option value="Africa/Lagos">Africa/Lagos (Nigeria, UTC+1)</option>
              <option value="Africa/Nairobi">Africa/Nairobi (Kenya, UTC+3)</option>
            </optgroup>
            <optgroup label="Asia Pacific">
              <option value="Asia/Kolkata">Asia/Kolkata (India, UTC+5:30)</option>
              <option value="Asia/Karachi">Asia/Karachi (Pakistan, UTC+5)</option>
              <option value="Asia/Bangkok">Asia/Bangkok (Thailand, UTC+7)</option>
              <option value="Asia/Jakarta">Asia/Jakarta (Indonesia, UTC+7)</option>
              <option value="Asia/Manila">Asia/Manila (Philippines, UTC+8)</option>
              <option value="Asia/Seoul">Asia/Seoul (South Korea, UTC+9)</option>
              <option value="Asia/Shanghai">Asia/Shanghai (China, UTC+8)</option>
            </optgroup>
          </select>
          <p className="text-xs text-muted-foreground">
            Timezone for charts and data analysis. &quot;Browser Timezone&quot; uses your device&apos;s local timezone automatically.
          </p>
          {!formData.timezone && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 mt-2">
              <p className="text-sm text-amber-800">
                <strong>Recommended:</strong> Set an explicit timezone for accurate hourly and daily energy calculations. Without it, time windows default to UTC which may not match your site&apos;s local time.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Status - Deactivate Project */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Project Status</h3>

        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="is_active" className="text-base">Active</Label>
              <p className="text-sm text-muted-foreground">
                Control whether this project is operational
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
                <strong>Warning:</strong> Deactivating this project will stop all services for all sites within this project including control loops, data logging, and cloud sync. All sites will become non-operational.
              </p>
              <p className="text-sm text-amber-700 mt-2">
                Historical data will be preserved in the database and can be viewed in Historical Data page.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex gap-4">
        <Button type="submit" disabled={loading}>
          {loading ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
