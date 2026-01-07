"use client";

/**
 * New Project Form Component (Simplified)
 *
 * Creates a new project with basic info only.
 * Technical settings (controller, logging, safe mode) are at site level.
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

// Props interface for enterprise handling
interface NewProjectFormProps {
  userRole: string;
  userEnterpriseId: string | null;
  userEnterpriseName: string | null;
  enterprises: Array<{ id: string; name: string }>;
}

export function NewProjectForm({
  userRole,
  userEnterpriseId,
  userEnterpriseName,
  enterprises,
}: NewProjectFormProps) {
  const router = useRouter();
  const supabase = createClient();

  // Determine if user can select enterprise (super_admin or backend_admin only)
  const canSelectEnterprise = userRole === "super_admin" || userRole === "backend_admin";

  // Form state
  const [loading, setLoading] = useState(false);
  // Selected enterprise - non-admins use their enterprise, admins must select
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<string | null>(
    canSelectEnterprise ? null : userEnterpriseId
  );
  const [formData, setFormData] = useState({
    name: "",
    location: "",
    description: "",
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

      // Enterprise is required for all projects
      if (!selectedEnterpriseId) {
        toast.error("Please select an enterprise");
        setLoading(false);
        return;
      }

      // Create project in Supabase - simplified fields only
      const { data, error } = await supabase
        .from("projects")
        .insert({
          enterprise_id: selectedEnterpriseId,
          name: formData.name.trim(),
          location: formData.location.trim() || null,
          description: formData.description.trim() || null,
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
      {/* Enterprise Selection - only editable by super/backend admin */}
      <div className="space-y-2">
        <Label htmlFor="enterprise">
          Enterprise <span className="text-red-500">*</span>
        </Label>
        {canSelectEnterprise ? (
          // Super Admin / Backend Admin can select any enterprise
          <select
            id="enterprise"
            value={selectedEnterpriseId || ""}
            onChange={(e) => setSelectedEnterpriseId(e.target.value || null)}
            className="w-full h-10 px-3 rounded-md border border-input bg-background min-h-[44px]"
            required
          >
            <option value="">Select an enterprise...</option>
            {enterprises.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        ) : (
          // Other users see their enterprise as read-only
          <div className="p-3 bg-muted rounded-md text-sm">
            {userEnterpriseName || "No enterprise assigned"}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {canSelectEnterprise
            ? "Every project must belong to an enterprise"
            : "Projects are created under your enterprise"}
        </p>
      </div>

      <Separator />

      {/* Project Details */}
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
            className="min-h-[44px]"
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
            className="min-h-[44px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            name="description"
            placeholder="Brief description of the project"
            value={formData.description}
            onChange={handleChange}
            className="min-h-[44px]"
          />
        </div>

        <div className="space-y-2">
          <Label>Project ID</Label>
          <p className="text-sm text-muted-foreground p-3 bg-muted rounded-md">
            Auto-generated after creation
          </p>
        </div>
      </div>

      <Separator />

      {/* Form Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
        <Button type="submit" disabled={loading} className="min-h-[44px] w-full sm:w-auto">
          {loading ? "Creating..." : "Create Project"}
        </Button>
        <Button type="button" variant="outline" asChild className="min-h-[44px] w-full sm:w-auto">
          <Link href="/projects">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
