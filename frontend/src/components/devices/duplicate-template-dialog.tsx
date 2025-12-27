"use client";

/**
 * Duplicate Template Dialog
 *
 * Dialog for duplicating a device template.
 * Creates a new custom template based on an existing template.
 *
 * Features:
 * - Pre-fills template_id with "{original}_copy" suffix
 * - Pre-fills name with "Copy of {original name}"
 * - Forces user to change the name (validation)
 * - Enterprise selector for super_admin/admin
 * - Always creates a "custom" template
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

// Generate a suggested template_id from the original
function generateSuggestedId(originalId: string): string {
  // If it already ends with _copy or _copy_N, increment
  const copyMatch = originalId.match(/^(.+)_copy(_(\d+))?$/);
  if (copyMatch) {
    const base = copyMatch[1];
    const currentNum = copyMatch[3] ? parseInt(copyMatch[3]) : 1;
    return `${base}_copy_${currentNum + 1}`;
  }
  return `${originalId}_copy`;
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
  const [newTemplateId, setNewTemplateId] = useState("");
  const [newName, setNewName] = useState("");
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<string | undefined>(undefined);

  // Validation errors
  const [errors, setErrors] = useState<{
    templateId?: string;
    name?: string;
  }>({});

  // Can this user select an enterprise?
  const canSelectEnterprise = ["super_admin", "backend_admin", "admin"].includes(userRole);

  // Reset form when dialog opens with new template
  useEffect(() => {
    if (open && template) {
      setNewTemplateId(generateSuggestedId(template.template_id));
      setNewName(`Copy of ${template.name}`);
      setSelectedEnterpriseId(undefined);
      setErrors({});
    }
  }, [open, template]);

  // Validate form
  function validateForm(): boolean {
    const newErrors: typeof errors = {};

    // Validate template_id format (lowercase, underscores, no special chars)
    if (!newTemplateId.trim()) {
      newErrors.templateId = "Template ID is required";
    } else if (!/^[a-z][a-z0-9_]*$/.test(newTemplateId)) {
      newErrors.templateId = "Must start with letter, only lowercase letters, numbers, and underscores";
    }

    // Validate name is different from original
    if (!newName.trim()) {
      newErrors.name = "Name is required";
    } else if (newName.trim().toLowerCase() === template.name.toLowerCase()) {
      newErrors.name = "Name must be different from the original";
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

      // Build request body
      const requestBody: {
        new_template_id: string;
        new_name: string;
        enterprise_id?: string;
      } = {
        new_template_id: newTemplateId.trim(),
        new_name: newName.trim(),
      };

      // Only include enterprise_id if admin selected one
      if (canSelectEnterprise && selectedEnterpriseId) {
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
          setErrors({ templateId: "Template ID already exists" });
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
            Create a copy of <strong>{template.name}</strong> as a custom template for your enterprise.
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

          {/* New Template ID */}
          <div className="space-y-2">
            <Label htmlFor="new-template-id">
              New Template ID <span className="text-red-500">*</span>
            </Label>
            <Input
              id="new-template-id"
              value={newTemplateId}
              onChange={(e) => {
                setNewTemplateId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"));
                setErrors((prev) => ({ ...prev, templateId: undefined }));
              }}
              placeholder="e.g., sungrow_150kw_custom"
              className={errors.templateId ? "border-red-500" : ""}
            />
            {errors.templateId && (
              <p className="text-sm text-red-500">{errors.templateId}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Unique identifier. Lowercase letters, numbers, and underscores only.
            </p>
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

          {/* Enterprise Selector (admin only) */}
          {canSelectEnterprise && enterprises.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="enterprise">
                Assign to Enterprise
              </Label>
              <Select
                value={selectedEnterpriseId || ""}
                onValueChange={setSelectedEnterpriseId}
              >
                <SelectTrigger id="enterprise">
                  <SelectValue placeholder="Use my enterprise (default)" />
                </SelectTrigger>
                <SelectContent>
                  {enterprises.map((enterprise) => (
                    <SelectItem key={enterprise.id} value={enterprise.id}>
                      {enterprise.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Optional. Leave empty to use your own enterprise.
              </p>
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
