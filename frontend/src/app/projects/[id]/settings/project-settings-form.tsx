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
import { toast } from "sonner";

// Project type (basic fields only)
interface Project {
  id: string;
  name: string;
  location: string | null;
  description: string | null;
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

      {/* Form Actions */}
      <div className="flex gap-4">
        <Button type="submit" disabled={loading}>
          {loading ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
