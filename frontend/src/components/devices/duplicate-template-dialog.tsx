"use client";

/**
 * Duplicate Template Dialog
 *
 * Dialog for duplicating a device template.
 * Creates a new template (public or custom) based on an existing template.
 *
 * Features:
 * - Auto-generates unique template_id
 * - Pre-fills name with "Copy of {original name}"
 * - Forces user to change the name (validation)
 * - Super admin/backend admin can choose Public or Custom
 * - Enterprise selector for custom templates
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Copy } from "lucide-react";

// Device template type (simplified for this dialog)
interface DeviceTemplate {
  id: string;
  template_id: string;
  name: string;
  device_type: string;
  brand: string;
  model: string;
}

interface DuplicateTemplateDialogProps {
  template: DeviceTemplate;
  enterprises?: Array<{ id: string; name: string }>;
  userRole?: string;
  userEnterpriseId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// Generate a unique template_id with random suffix (same pattern as creating new templates)
function generateUniqueId(brand: string, model: string): string {
  const base = `${brand}_${model}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return `${base}_${randomSuffix}`;
}

export function DuplicateTemplateDialog({
  template,
  enterprises = [],
  userRole = "viewer",
  userEnterpriseId,
  open,
  onOpenChange,
  onSuccess,
}: DuplicateTemplateDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [newName, setNewName] = useState("");
  const [templateType, setTemplateType] = useState<"public" | "custom">("custom");
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<string | undefined>(undefined);

  // Validation errors
  const [errors, setErrors] = useState<{
    name?: string;
    enterprise?: string;
  }>({});

  // Can this user create public templates? (super_admin/backend_admin only)
  const canCreatePublic = ["super_admin", "backend_admin"].includes(userRole);

  // Can this user select an enterprise? (admins)
  const canSelectEnterprise = ["super_admin", "backend_admin", "admin"].includes(userRole);

  // Reset form when dialog opens with new template
  useEffect(() => {
    if (open && template) {
      setNewName(`Copy of ${template.name}`);
      setTemplateType("custom");
      setSelectedEnterpriseId(undefined);
      setErrors({});
    }
  }, [open, template]);

  // Validate form
  function validateForm(): boolean {
    const newErrors: typeof errors = {};

    // Validate name is different from original
    if (!newName.trim()) {
      newErrors.name = "Name is required";
    } else if (newName.trim().toLowerCase() === template.name.toLowerCase()) {
      newErrors.name = "Name must be different from the original";
    }

    // Validate enterprise is selected for custom templates (if user can select enterprise)
    if (templateType === "custom" && canSelectEnterprise && !selectedEnterpriseId && !userEnterpriseId) {
      newErrors.enterprise = "Enterprise is required for custom templates";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  // Handle form submission
  async function handleSubmit() {
    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const supabase = createClient();

      // Get the current user's token for API auth
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Not authenticated");
        return;
      }

      // Auto-generate unique template ID
      const generatedTemplateId = generateUniqueId(template.brand, template.model);

      // Build request body
      const requestBody: {
        new_template_id: string;
        new_name: string;
        template_type?: string;
        enterprise_id?: string;
      } = {
        new_template_id: generatedTemplateId,
        new_name: newName.trim(),
      };

      // Include template_type if user can create public templates
      if (canCreatePublic) {
        requestBody.template_type = templateType;
      }

      // Include enterprise_id for custom templates
      if (templateType === "custom" && canSelectEnterprise && selectedEnterpriseId) {
        requestBody.enterprise_id = selectedEnterpriseId;
      }

      // Call the duplicate API endpoint
      const response = await fetch(
        `/api/devices/templates/${template.template_id}/duplicate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();

        // Handle specific error codes
        if (response.status === 409) {
          // Template ID collision - retry with new ID
          toast.error("ID collision, please try again");
          return;
        } else if (response.status === 400) {
          // Name validation error from server
          if (errorData.detail?.includes("name")) {
            setErrors({ name: errorData.detail });
          } else {
            toast.error(errorData.detail || "Invalid request");
          }
          return;
        }

        throw new Error(errorData.detail || "Failed to duplicate template");
      }

      toast.success(`Template "${newName}" created successfully`);
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error("Failed to duplicate template:", error);
      toast.error(error instanceof Error ? error.message : "Failed to duplicate template");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Duplicate Template
          </DialogTitle>
          <DialogDescription>
            Create a copy of <strong>{template.name}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Source template info */}
          <div className="rounded-lg bg-muted p-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground">Original:</span>{" "}
                <span className="font-medium">{template.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Type:</span>{" "}
                <span className="font-medium capitalize">{template.device_type.replace(/_/g, " ")}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Brand:</span>{" "}
                <span className="font-medium">{template.brand}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Model:</span>{" "}
                <span className="font-medium">{template.model}</span>
              </div>
            </div>
          </div>

          {/* New Name */}
          <div className="space-y-2">
            <Label htmlFor="new-name">
              New Template Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="new-name"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setErrors((prev) => ({ ...prev, name: undefined }));
              }}
              placeholder="e.g., My Custom Sungrow 150kW"
              className={errors.name ? "border-red-500" : ""}
            />
            {errors.name && (
              <p className="text-sm text-red-500">{errors.name}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Display name for the new template. Must be different from the original.
            </p>
          </div>

          {/* Template Type Selector (super_admin/backend_admin only) */}
          {canCreatePublic && (
            <div className="space-y-2">
              <Label htmlFor="template-type">
                Template Type <span className="text-red-500">*</span>
              </Label>
              <Select
                value={templateType}
                onValueChange={(value) => {
                  setTemplateType(value as "public" | "custom");
                  // Clear enterprise error if switching to public
                  if (value === "public") {
                    setErrors((prev) => ({ ...prev, enterprise: undefined }));
                  }
                }}
              >
                <SelectTrigger id="template-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      Public - Available to all users
                    </span>
                  </SelectItem>
                  <SelectItem value="custom">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-blue-500" />
                      Custom - Enterprise-specific
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Enterprise Selector (shown for custom templates when user can select) */}
          {templateType === "custom" && canSelectEnterprise && enterprises.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="enterprise">
                Assign to Enterprise <span className="text-red-500">*</span>
              </Label>
              <Select
                value={selectedEnterpriseId || ""}
                onValueChange={(value) => {
                  setSelectedEnterpriseId(value);
                  setErrors((prev) => ({ ...prev, enterprise: undefined }));
                }}
              >
                <SelectTrigger id="enterprise" className={errors.enterprise ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select an enterprise" />
                </SelectTrigger>
                <SelectContent>
                  {enterprises.map((enterprise) => (
                    <SelectItem key={enterprise.id} value={enterprise.id}>
                      {enterprise.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.enterprise && (
                <p className="text-sm text-red-500">{errors.enterprise}</p>
              )}
            </div>
          )}

          {/* Info about what will be copied */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            <strong>What will be copied:</strong>
            <ul className="mt-1 list-inside list-disc">
              <li>All Modbus registers (logging, visualization, alarm)</li>
              <li>Calculated field selections</li>
              <li>Device specifications</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Duplicating..." : "Duplicate Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
