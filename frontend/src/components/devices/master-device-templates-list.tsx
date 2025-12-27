"use client";

/**
 * Master Device Templates List Component
 *
 * Displays controller templates (Master Devices) in a filterable grid.
 * Features:
 * - Public (green badge) / Custom (blue badge) template types
 * - Filter by template_type (All/Public/Custom)
 * - Search by name
 * - Role-based Add/Edit/Delete buttons
 * - Stats showing readings and calculated fields count
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import type { ControllerTemplate } from "@/lib/types";
import { MasterDeviceTemplateForm } from "./master-device-template-form";

// =============================================================================
// PREDEFINED DATA - CALCULATED FIELDS & CONTROLLER READINGS
// =============================================================================

// Calculated fields that can be enabled per template (all daily aggregations)
export const CONTROLLER_CALCULATED_FIELDS = [
  { field_id: "daily_total_load_kwh", name: "Daily Total Load Consumption", unit: "kWh", category: "load" },
  { field_id: "daily_total_solar_kwh", name: "Daily Total Solar Production", unit: "kWh", category: "solar" },
  { field_id: "daily_total_dg_kwh", name: "Daily Total Generator Production", unit: "kWh", category: "generator" },
  { field_id: "daily_load_peak_kw", name: "Daily Peak Load", unit: "kW", category: "load" },
  { field_id: "daily_load_avg_kw", name: "Daily Average Load", unit: "kW", category: "load" },
  { field_id: "daily_solar_peak_kw", name: "Daily Solar Peak Production", unit: "kW", category: "solar" },
  { field_id: "daily_solar_avg_kw", name: "Daily Solar Average Production", unit: "kW", category: "solar" },
  { field_id: "daily_dg_peak_kw", name: "Daily Generator Peak", unit: "kW", category: "generator" },
  { field_id: "daily_dg_avg_kw", name: "Daily Generator Average", unit: "kW", category: "generator" },
  { field_id: "daily_dg_min_kw", name: "Daily Generator Minimum", unit: "kW", category: "generator" },
];

// Controller readings (Raspberry Pi health metrics)
export const CONTROLLER_READINGS = [
  { field_id: "cpu_temp_celsius", name: "CPU Temperature", unit: "°C", source: "device_info" as const },
  { field_id: "cpu_usage_pct", name: "CPU Usage", unit: "%", source: "device_info" as const },
  { field_id: "memory_usage_pct", name: "Memory Usage", unit: "%", source: "device_info" as const },
  { field_id: "disk_usage_pct", name: "Disk Usage", unit: "%", source: "device_info" as const },
  { field_id: "uptime_seconds", name: "System Uptime", unit: "seconds", source: "device_info" as const },
  { field_id: "network_rx_bytes", name: "Network Received", unit: "bytes", source: "device_info" as const },
  { field_id: "network_tx_bytes", name: "Network Transmitted", unit: "bytes", source: "device_info" as const },
];

// =============================================================================
// TYPES
// =============================================================================

interface MasterDeviceTemplatesListProps {
  templates: ControllerTemplate[];
  userRole?: string;
  userEnterpriseId?: string | null;
}

// Controller type labels and colors
const controllerTypeLabels: Record<string, string> = {
  raspberry_pi: "Raspberry Pi",
  gateway: "Gateway",
  plc: "PLC",
};

const controllerTypeColors: Record<string, string> = {
  raspberry_pi: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  gateway: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  plc: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Check if user can create templates (any type)
function canCreateTemplate(role?: string): boolean {
  if (!role) return false;
  return ["super_admin", "backend_admin", "enterprise_admin", "configurator"].includes(role);
}

// Check if user can create PUBLIC templates (super_admin/backend_admin only)
function canCreatePublicTemplate(role?: string): boolean {
  if (!role) return false;
  return ["super_admin", "backend_admin"].includes(role);
}

// Check if user can edit a specific template
function canEditTemplate(
  template: ControllerTemplate,
  userRole?: string,
  userEnterpriseId?: string | null
): boolean {
  if (!userRole) return false;

  // Super admin can edit all
  if (userRole === "super_admin") return true;

  // Backend admin can edit all
  if (userRole === "backend_admin") return true;

  // Enterprise admin and configurator can edit their enterprise's custom templates
  if (["enterprise_admin", "configurator"].includes(userRole)) {
    return (
      template.template_type === "custom" &&
      template.enterprise_id === userEnterpriseId
    );
  }

  return false;
}

// Check if user can delete a specific template
function canDeleteTemplate(
  template: ControllerTemplate,
  userRole?: string,
  userEnterpriseId?: string | null,
  userId?: string
): boolean {
  if (!userRole) return false;

  // Super admin can delete all
  if (userRole === "super_admin") return true;

  // Enterprise admin and configurator can delete their own custom templates
  if (["enterprise_admin", "configurator"].includes(userRole)) {
    return (
      template.template_type === "custom" &&
      template.created_by === userId
    );
  }

  return false;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function MasterDeviceTemplatesList({
  templates: initialTemplates,
  userRole,
  userEnterpriseId,
}: MasterDeviceTemplatesListProps) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "public" | "custom">("all");
  const [controllerTypeFilter, setControllerTypeFilter] = useState<string>("all");

  // Dialog state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ControllerTemplate | null>(null);
  const [deleteTemplate, setDeleteTemplate] = useState<ControllerTemplate | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Apply filters
  const filteredTemplates = templates.filter((template) => {
    // Search filter
    const matchesSearch =
      searchQuery === "" ||
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.template_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (template.brand?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
      (template.model?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);

    // Template type filter
    const matchesType =
      typeFilter === "all" || template.template_type === typeFilter;

    // Controller type filter
    const matchesControllerType =
      controllerTypeFilter === "all" || template.controller_type === controllerTypeFilter;

    return matchesSearch && matchesType && matchesControllerType;
  });

  // Get unique controller types for filter dropdown
  const uniqueControllerTypes = [...new Set(templates.map((t) => t.controller_type))];

  // Handle template creation success
  const handleTemplateCreated = (newTemplate: ControllerTemplate) => {
    setTemplates((prev) => [newTemplate, ...prev]);
    setIsFormOpen(false);
    setEditingTemplate(null);
    toast.success("Template created successfully");
    router.refresh();
  };

  // Handle template update success
  const handleTemplateUpdated = (updatedTemplate: ControllerTemplate) => {
    setTemplates((prev) =>
      prev.map((t) => (t.id === updatedTemplate.id ? updatedTemplate : t))
    );
    setIsFormOpen(false);
    setEditingTemplate(null);
    toast.success("Template updated successfully");
    router.refresh();
  };

  // Handle template delete
  const handleDelete = async () => {
    if (!deleteTemplate) return;

    setIsDeleting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("controller_templates")
        .delete()
        .eq("id", deleteTemplate.id);

      if (error) throw error;

      setTemplates((prev) => prev.filter((t) => t.id !== deleteTemplate.id));
      toast.success("Template deleted successfully");
      router.refresh();
    } catch (error) {
      console.error("Error deleting template:", error);
      toast.error("Failed to delete template");
    } finally {
      setIsDeleting(false);
      setDeleteTemplate(null);
    }
  };

  // Open edit dialog
  const handleEdit = (template: ControllerTemplate) => {
    setEditingTemplate(template);
    setIsFormOpen(true);
  };

  // Count stats for a template
  const getTemplateStats = (template: ControllerTemplate) => {
    const readingsCount = template.registers?.length ?? 0;
    const calculatedCount = template.calculated_fields?.length ?? 0;
    return { readingsCount, calculatedCount };
  };

  return (
    <div className="space-y-4">
      {/* Filters Row */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="flex-1">
          <Input
            placeholder="Search by name, brand, model..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-10"
          />
        </div>

        {/* Type Filter */}
        <Select
          value={typeFilter}
          onValueChange={(value) => setTypeFilter(value as "all" | "public" | "custom")}
        >
          <SelectTrigger className="w-full sm:w-[140px] h-10">
            <SelectValue placeholder="Template Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="public">Public</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>

        {/* Controller Type Filter */}
        <Select
          value={controllerTypeFilter}
          onValueChange={setControllerTypeFilter}
        >
          <SelectTrigger className="w-full sm:w-[160px] h-10">
            <SelectValue placeholder="Controller Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Controllers</SelectItem>
            {uniqueControllerTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {controllerTypeLabels[type] || type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Add Button - only for authorized roles */}
        {canCreateTemplate(userRole) && (
          <Button
            onClick={() => {
              setEditingTemplate(null);
              setIsFormOpen(true);
            }}
            className="h-10"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4 mr-2"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Template
          </Button>
        )}
      </div>

      {/* Results Count */}
      <div className="text-sm text-muted-foreground">
        Showing {filteredTemplates.length} of {templates.length} templates
      </div>

      {/* Templates Grid */}
      {filteredTemplates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="text-muted-foreground">
              {templates.length === 0
                ? "No master device templates found"
                : "No templates match your filters"}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((template) => {
            const stats = getTemplateStats(template);
            const canEdit = canEditTemplate(template, userRole, userEnterpriseId);
            const canDelete = canDeleteTemplate(template, userRole, userEnterpriseId);

            return (
              <Card key={template.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {/* Template Name */}
                      <CardTitle className="text-base truncate">
                        {template.name}
                      </CardTitle>
                      {/* Template ID */}
                      <CardDescription className="font-mono text-xs mt-0.5">
                        {template.template_id}
                      </CardDescription>
                    </div>

                    {/* Badges */}
                    <div className="flex flex-col gap-1 items-end shrink-0">
                      {/* Public/Custom Badge */}
                      <Badge
                        variant="secondary"
                        className={
                          template.template_type === "public"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                        }
                      >
                        {template.template_type === "public" ? "Public" : "Custom"}
                      </Badge>

                      {/* Controller Type Badge */}
                      <Badge
                        variant="secondary"
                        className={controllerTypeColors[template.controller_type] || ""}
                      >
                        {controllerTypeLabels[template.controller_type] || template.controller_type}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="pt-0">
                  {/* Brand & Model */}
                  {(template.brand || template.model) && (
                    <p className="text-sm text-muted-foreground mb-3">
                      {[template.brand, template.model].filter(Boolean).join(" ")}
                    </p>
                  )}

                  {/* Stats */}
                  <div className="flex gap-4 text-sm text-muted-foreground mb-4">
                    <span className="flex items-center gap-1">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4"
                      >
                        <path d="M3 3v18h18" />
                        <path d="m19 9-5 5-4-4-3 3" />
                      </svg>
                      {stats.readingsCount} readings
                    </span>
                    <span className="flex items-center gap-1">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4"
                      >
                        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                      {stats.calculatedCount} fields
                    </span>
                  </div>

                  {/* Active Status */}
                  <div className="flex items-center justify-between">
                    <Badge variant={template.is_active ? "default" : "secondary"}>
                      {template.is_active ? "Active" : "Inactive"}
                    </Badge>

                    {/* Action Buttons */}
                    <div className="flex gap-2">
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(template)}
                          className="h-8 px-3"
                        >
                          Edit
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTemplate(template)}
                          className="h-8 px-3 text-destructive hover:text-destructive"
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <MasterDeviceTemplateForm
        open={isFormOpen}
        onOpenChange={(open) => {
          setIsFormOpen(open);
          if (!open) setEditingTemplate(null);
        }}
        template={editingTemplate}
        userRole={userRole}
        userEnterpriseId={userEnterpriseId}
        onSuccess={editingTemplate ? handleTemplateUpdated : handleTemplateCreated}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTemplate} onOpenChange={(open) => !open && setDeleteTemplate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTemplate?.name}&quot;? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
