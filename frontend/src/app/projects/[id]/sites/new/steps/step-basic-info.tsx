"use client";

/**
 * Step 1: Basic Information
 *
 * Collects site name, location, and description.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { StepProps } from "../wizard-types";

export function StepBasicInfo({ formData, updateField }: StepProps) {
  return (
    <div className="space-y-6">
      {/* Site Name */}
      <div className="space-y-2">
        <Label htmlFor="name">
          Site Name <span className="text-red-500">*</span>
        </Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => updateField("name", e.target.value)}
          placeholder="e.g., Main Factory, Warehouse A"
          className="min-h-[44px]"
        />
        <p className="text-xs text-muted-foreground">
          A unique name to identify this site within the project
        </p>
      </div>

      {/* Location */}
      <div className="space-y-2">
        <Label htmlFor="location">Location</Label>
        <Input
          id="location"
          value={formData.location}
          onChange={(e) => updateField("location", e.target.value)}
          placeholder="e.g., Riyadh Industrial Area, Building 5"
          className="min-h-[44px]"
        />
        <p className="text-xs text-muted-foreground">
          Physical location or address of the site (optional)
        </p>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => updateField("description", e.target.value)}
          placeholder="Optional description of the site, its purpose, or special considerations..."
          rows={3}
          className="min-h-[100px]"
        />
        <p className="text-xs text-muted-foreground">
          Additional notes about this site (optional)
        </p>
      </div>
    </div>
  );
}
