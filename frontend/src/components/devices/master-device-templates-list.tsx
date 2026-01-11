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

import { useState, useMemo } from "react";
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
// Names include "Power" for kW fields and "Energy" for kWh fields
export const CONTROLLER_CALCULATED_FIELDS = [
  { field_id: "daily_total_load_kwh", name: "Daily Total Load Energy (kWh)", unit: "kWh", category: "load" },
  { field_id: "daily_total_solar_kwh", name: "Daily Total Solar Energy (kWh)", unit: "kWh", category: "solar" },
  { field_id: "daily_total_dg_kwh", name: "Daily Total Generator Energy (kWh)", unit: "kWh", category: "generator" },
  { field_id: "daily_load_peak_kw", name: "Daily Peak Load Power (kW)", unit: "kW", category: "load" },
  { field_id: "daily_load_avg_kw", name: "Daily Average Load Power (kW)", unit: "kW", category: "load" },
  { field_id: "daily_solar_peak_kw", name: "Daily Peak Solar Power (kW)", unit: "kW", category: "solar" },
  { field_id: "daily_solar_avg_kw", name: "Daily Average Solar Power (kW)", unit: "kW", category: "solar" },
  { field_id: "daily_dg_peak_kw", name: "Daily Peak Total Generator Power (kW)", unit: "kW", category: "generator" },
  { field_id: "daily_dg_avg_kw", name: "Daily Average Total Generator Power (kW)", unit: "kW", category: "generator" },
  { field_id: "daily_dg_min_kw", name: "Daily Minimum Total Generator Power (kW)", unit: "kW", category: "generator" },
];

// Controller readings (system health metrics)
// Default frequencies: most fields at 10 min (600s), uptime at 1 min (60s)
export const CONTROLLER_READINGS = [
  { field_id: "cpu_temp_celsius", name: "CPU Temperature", unit: "°C", source: "device_info" as const, default_frequency: 600 },
  { field_id: "cpu_usage_pct", name: "CPU Usage", unit: "%", source: "device_info" as const, default_frequency: 600 },
  { field_id: "memory_usage_pct", name: "Memory Usage", unit: "%", source: "device_info" as const, default_frequency: 600 },
  { field_id: "disk_usage_pct", name: "Disk Usage", unit: "%", source: "device_info" as const, default_frequency: 600 },
  { field_id: "uptime_seconds", name: "System Uptime", unit: "seconds", source: "device_info" as const, default_frequency: 60 },
  { field_id: "network_rx_bytes", name: "Network Received", unit: "bytes", source: "device_info" as const, default_frequency: 600 },
  { field_id: "network_tx_bytes", name: "Network Transmitted", unit: "bytes", source: "device_info" as const, default_frequency: 600 },
];

// Site-level alarms based on calculated fields
// These detect site-wide issues like power outages
export interface SiteLevelAlarm {
  alarm_id: string;
  name: string;
  description: string;
  source_field: string;          // Calculated field to monitor
  condition: {
    operator: "==" | "<=" | ">=" | "<" | ">" | "!=";
    value: number;
  };
  severity: "info" | "warning" | "critical";
  enabled: boolean;
  cooldown_seconds: number;
}

export const SITE_LEVEL_ALARMS: SiteLevelAlarm[] = [
  {
    alarm_id: "power_outage_load",
    name: "Suspected Power Outage (Load)",
    description: "Triggers when total site load equals 0 kW",
    source_field: "total_load_kw",
    condition: { operator: "==", value: 0 },
    severity: "critical",
    enabled: true,
    cooldown_seconds: 300,
  },
  {
    alarm_id: "power_outage_solar",
    name: "Loss of Solar Production",
    description: "Triggers when total solar generation is 0 kW, indicating loss of solar production",
    source_field: "total_solar_kw",
    condition: { operator: "==", value: 0 },
    severity: "critical",
    enabled: false,
    cooldown_seconds: 300,
  },
  {
    alarm_id: "power_outage_generation",
    name: "Suspected Power Outage (Generation)",
    description: "Triggers when total generation (DG + Gas + Battery + Solar) equals 0 kW",
    source_field: "total_generation_kw",
    condition: { operator: "==", value: 0 },
    severity: "critical",
    enabled: false,
    cooldown_seconds: 300,
  },
  {
    alarm_id: "high_reverse_power",
    name: "High Reverse Power to DG",
    description: "Triggers when DG power goes negative (reverse feeding)",
    source_field: "dg_power_kw",
    condition: { operator: "<", value: -5 },
    severity: "critical",
    enabled: true,
    cooldown_seconds: 60,
  },
  {
    alarm_id: "solar_exceeds_load",
    name: "Solar Exceeds Load",
    description: "Triggers when solar output exceeds total load (potential reverse flow)",
    source_field: "solar_minus_load_kw",
    condition: { operator: ">", value: 0 },
    severity: "critical",
    enabled: false,
    cooldown_seconds: 120,
  },
  {
    alarm_id: "control_loop_error",
    name: "Control Loop Error",
    description: "Triggers when controller cannot execute control loop (device not reporting, communication error)",
    source_field: "control_loop_error",
    condition: { operator: "==", value: 1 },
    severity: "critical",
    enabled: true,
    cooldown_seconds: 60,
  },
];

// =============================================================================
// TYPES
// =============================================================================

interface MasterDeviceTemplatesListProps {
  templates: ControllerTemplate[];
  userRole?: string;
  userEnterpriseId?: string | null;
  enterprises?: Array<{ id: string; name: string }>; // For displaying enterprise names on custom templates
}

// Template usage info - which sites/projects are using this template
interface TemplateUsageInfo {
  site_id: string;
  site_name: string;
  project_id: string;
  project_name: string;
}

// Controller type labels and colors
const controllerTypeLabels: Record<string, string> = {
  raspberry_pi: "Controller",
  gateway: "Gateway",
  plc: "PLC",
};

const controllerTypeColors: Record<string, string> = {
  raspberry_pi: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
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
  enterprises,
}: MasterDeviceTemplatesListProps) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);

  // Create enterprise lookup map for displaying names on custom templates
  const enterpriseNameMap = useMemo(() => {
    const map = new Map<string, string>();
    enterprises?.forEach(e => map.set(e.id, e.name));
    return map;
  }, [enterprises]);

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "public" | "custom">("all");
  const [controllerTypeFilter, setControllerTypeFilter] = useState<string>("all");

  // Dialog state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ControllerTemplate | null>(null);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [deleteTemplate, setDeleteTemplate] = useState<ControllerTemplate | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Usage warning state
  const [templateUsage, setTemplateUsage] = useState<TemplateUsageInfo[]>([]);
  const [showEditWarning, setShowEditWarning] = useState(false);
  const [pendingEditTemplate, setPendingEditTemplate] = useState<ControllerTemplate | null>(null);
  const [showDeleteBlocked, setShowDeleteBlocked] = useState(false);
  const [pendingDeleteTemplate, setPendingDeleteTemplate] = useState<ControllerTemplate | null>(null);
  const [isCheckingUsage, setIsCheckingUsage] = useState(false);

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

  // Check if template is in use by any site
  const checkTemplateUsage = async (templateId: string): Promise<TemplateUsageInfo[]> => {
    const supabase = createClient();

    // Query site_master_devices joined with sites and projects
    const { data, error } = await supabase
      .from("site_master_devices")
      .select(`
        site_id,
        sites!inner (
          id,
          name,
          project_id,
          projects!inner (
            id,
            name
          )
        )
      `)
      .eq("controller_template_id", templateId);

    if (error) {
      console.error("Error checking template usage:", error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Transform the data into TemplateUsageInfo format
    return data.map((item) => {
      const site = item.sites as unknown as { id: string; name: string; project_id: string; projects: { id: string; name: string } };
      return {
        site_id: site.id,
        site_name: site.name,
        project_id: site.projects.id,
        project_name: site.projects.name,
      };
    });
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

  // Open edit dialog - check usage first and show warning if in use
  const handleEdit = async (template: ControllerTemplate) => {
    setIsCheckingUsage(true);
    try {
      const usage = await checkTemplateUsage(template.id);

      if (usage.length > 0) {
        // Template is in use - show warning dialog
        setTemplateUsage(usage);
        setPendingEditTemplate(template);
        setShowEditWarning(true);
      } else {
        // Template not in use - open edit directly
        setEditingTemplate(template);
        setIsDuplicating(false);
        setIsFormOpen(true);
      }
    } catch (error) {
      console.error("Error checking template usage:", error);
      // If check fails, still allow editing
      setEditingTemplate(template);
      setIsDuplicating(false);
      setIsFormOpen(true);
    } finally {
      setIsCheckingUsage(false);
    }
  };

  // Confirm edit after accepting warning
  const handleConfirmEdit = () => {
    if (pendingEditTemplate) {
      setEditingTemplate(pendingEditTemplate);
      setIsDuplicating(false);
      setIsFormOpen(true);
    }
    setShowEditWarning(false);
    setPendingEditTemplate(null);
    setTemplateUsage([]);
  };

  // Check usage before delete - block if in use
  const handleDeleteClick = async (template: ControllerTemplate) => {
    setIsCheckingUsage(true);
    try {
      const usage = await checkTemplateUsage(template.id);

      if (usage.length > 0) {
        // Template is in use - block deletion and show info
        setTemplateUsage(usage);
        setPendingDeleteTemplate(template);
        setShowDeleteBlocked(true);
      } else {
        // Template not in use - show normal delete confirmation
        setDeleteTemplate(template);
      }
    } catch (error) {
      console.error("Error checking template usage:", error);
      // If check fails, still show delete confirmation
      setDeleteTemplate(template);
    } finally {
      setIsCheckingUsage(false);
    }
  };

  // Open duplicate dialog (creates a copy of the template)
  const handleDuplicate = (template: ControllerTemplate) => {
    setEditingTemplate(template);
    setIsDuplicating(true);
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

                      {/* Enterprise name for custom templates */}
                      {template.template_type === "custom" && template.enterprise_id && (
                        <span className="text-xs text-muted-foreground">
                          {enterpriseNameMap.get(template.enterprise_id) || "Unknown"}
                        </span>
                      )}
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
                        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                      </svg>
                      {stats.readingsCount} Device Health
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
                        <path d="M3 3v18h18" />
                        <path d="m19 9-5 5-4-4-3 3" />
                      </svg>
                      {stats.calculatedCount} Calculated Fields
                    </span>
                  </div>

                  {/* Active Status */}
                  <div className="flex items-center justify-between">
                    <Badge variant={template.is_active ? "default" : "secondary"}>
                      {template.is_active ? "Active" : "Inactive"}
                    </Badge>

                    {/* Action Buttons */}
                    <div className="flex gap-2">
                      {/* Duplicate button - available to all users who can create templates */}
                      {canCreateTemplate(userRole) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDuplicate(template)}
                          className="h-8 px-3"
                          title="Create a copy of this template"
                        >
                          Duplicate
                        </Button>
                      )}
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
                          onClick={() => handleDeleteClick(template)}
                          disabled={isCheckingUsage}
                          className="h-8 px-3 text-destructive hover:text-destructive"
                        >
                          {isCheckingUsage ? "Checking..." : "Delete"}
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

      {/* Create/Edit/Duplicate Dialog */}
      <MasterDeviceTemplateForm
        open={isFormOpen}
        onOpenChange={(open) => {
          setIsFormOpen(open);
          if (!open) {
            setEditingTemplate(null);
            setIsDuplicating(false);
          }
        }}
        template={editingTemplate}
        userRole={userRole}
        userEnterpriseId={userEnterpriseId}
        isDuplicating={isDuplicating}
        onSuccess={editingTemplate && !isDuplicating ? handleTemplateUpdated : handleTemplateCreated}
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

      {/* Edit Warning Dialog - shown when template is in use */}
      <AlertDialog open={showEditWarning} onOpenChange={(open) => {
        if (!open) {
          setShowEditWarning(false);
          setPendingEditTemplate(null);
          setTemplateUsage([]);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5 text-yellow-500"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Template In Use
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  &quot;{pendingEditTemplate?.name}&quot; is currently in use by the following sites.
                  Changes will affect all sites using this template.
                </p>
                <div className="rounded-md border p-3 bg-muted/50 max-h-40 overflow-y-auto">
                  <ul className="space-y-1">
                    {templateUsage.map((usage, index) => (
                      <li key={index} className="text-sm">
                        <span className="font-medium">{usage.project_name}</span>
                        <span className="text-muted-foreground"> → </span>
                        <span>{usage.site_name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-sm text-muted-foreground">
                  Do you want to proceed with editing this template?
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmEdit}>
              Edit Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Blocked Dialog - shown when trying to delete template in use */}
      <AlertDialog open={showDeleteBlocked} onOpenChange={(open) => {
        if (!open) {
          setShowDeleteBlocked(false);
          setPendingDeleteTemplate(null);
          setTemplateUsage([]);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
              Cannot Delete Template
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  &quot;{pendingDeleteTemplate?.name}&quot; cannot be deleted because it is currently in use.
                </p>
                <div className="rounded-md border p-3 bg-muted/50 max-h-40 overflow-y-auto">
                  <p className="text-sm font-medium mb-2">Used by:</p>
                  <ul className="space-y-1">
                    {templateUsage.map((usage, index) => (
                      <li key={index} className="text-sm">
                        <span className="font-medium">{usage.project_name}</span>
                        <span className="text-muted-foreground"> → </span>
                        <span>{usage.site_name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-sm text-muted-foreground">
                  To delete this template, first remove it from the sites listed above.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>Understood</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
