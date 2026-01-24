"use client";

/**
 * Device Templates List Component
 *
 * Interactive list of device templates with:
 * - Search by name, brand, model
 * - Filter by device type
 * - Filter by brand
 * - Edit/Delete actions (admin only)
 */

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { TemplateFormDialog } from "./template-form-dialog";
import { DuplicateTemplateDialog } from "./duplicate-template-dialog";
import { DEVICE_TYPE_OPTIONS, LEGACY_TYPE_MAP } from "@/lib/device-constants";

// Device template type
interface DeviceTemplate {
  id: string;
  template_id: string;
  name: string;
  device_type: string;
  brand: string;
  model: string;
  rated_power_kw: number | null;
  template_type?: string | null; // 'public' or 'custom'
  enterprise_id?: string | null; // Which enterprise owns custom templates
  is_active?: boolean; // Whether template is active
}

// Template usage info - which sites/projects are using this template
interface TemplateUsageInfo {
  device_id: string;
  device_name: string;
  site_id: string;
  site_name: string;
  project_id: string;
  project_name: string;
}

interface DeviceTemplatesListProps {
  templates: DeviceTemplate[];
  userRole?: string;
  userEnterpriseId?: string | null; // Current user's enterprise
  enterprises?: Array<{ id: string; name: string }>; // For super admin to select enterprise for custom templates
}

// Device type badge colors
const deviceTypeColors: Record<string, string> = {
  inverter: "bg-amber-100 text-amber-800",
  wind_turbine: "bg-sky-100 text-sky-800",
  bess: "bg-violet-100 text-violet-800",
  gas_generator_controller: "bg-slate-100 text-slate-800",
  diesel_generator_controller: "bg-slate-100 text-slate-800",
  energy_meter: "bg-blue-100 text-blue-800",
  capacitor_bank: "bg-indigo-100 text-indigo-800",
  fuel_level_sensor: "bg-orange-100 text-orange-800",
  fuel_flow_meter: "bg-orange-100 text-orange-800",
  temperature_humidity_sensor: "bg-teal-100 text-teal-800",
  solar_radiation_sensor: "bg-yellow-100 text-yellow-800",
  wind_sensor: "bg-cyan-100 text-cyan-800",
  other_hardware: "bg-gray-100 text-gray-800",
  // Legacy
  load_meter: "bg-blue-100 text-blue-800",
  dg: "bg-slate-100 text-slate-800",
  sensor: "bg-purple-100 text-purple-800",
};

// Device type labels (for badge display)
const deviceTypeLabels: Record<string, string> = Object.fromEntries([
  ...DEVICE_TYPE_OPTIONS.map(o => [o.value, o.label]),
  // Legacy
  ["load_meter", "Energy Meter"],
  ["dg", "Generator Controller"],
  ["sensor", "Sensor (Generic)"],
]);

// Device type icons (as components)
const deviceTypeIcons: Record<string, React.ReactNode> = {
  inverter: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-amber-600">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  ),
  wind_turbine: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-sky-600">
      <path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2" />
      <path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
      <path d="M12.6 19.4A2 2 0 1 0 14 16H2" />
    </svg>
  ),
  bess: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-violet-600">
      <rect x="2" y="7" width="16" height="10" rx="2" />
      <path d="M22 11v2" />
      <path d="M6 11v2" />
      <path d="M10 11v2" />
      <path d="M14 11v2" />
    </svg>
  ),
  gas_generator_controller: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-slate-600">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 17v-2" />
      <path d="M12 17v-4" />
      <path d="M15 17v-6" />
    </svg>
  ),
  diesel_generator_controller: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-slate-600">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 17v-2" />
      <path d="M12 17v-4" />
      <path d="M15 17v-6" />
    </svg>
  ),
  energy_meter: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-blue-600">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  capacitor_bank: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-indigo-600">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  ),
  fuel_level_sensor: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-orange-600">
      <path d="M3 22h12" />
      <path d="M4 9h10" />
      <path d="M4 15h10" />
      <path d="M6 2v2" />
      <path d="M12 2v2" />
      <rect x="2" y="4" width="14" height="18" rx="2" />
      <path d="M20 2v10c0 1.1-.9 2-2 2" />
      <path d="M20 6h-2" />
    </svg>
  ),
  fuel_flow_meter: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-orange-600">
      <path d="M3 22h12" />
      <path d="M4 9h10" />
      <path d="M4 15h10" />
      <path d="M6 2v2" />
      <path d="M12 2v2" />
      <rect x="2" y="4" width="14" height="18" rx="2" />
      <path d="M20 2v10c0 1.1-.9 2-2 2" />
      <path d="M20 6h-2" />
    </svg>
  ),
  temperature_humidity_sensor: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-teal-600">
      <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />
      <path d="M12 9h-1" />
      <path d="M12 6h-1" />
    </svg>
  ),
  solar_radiation_sensor: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-yellow-600">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v1" />
      <path d="M12 20v1" />
      <path d="M3 12h1" />
      <path d="M20 12h1" />
      <path d="M5.6 5.6l.7.7" />
      <path d="M17.7 17.7l.7.7" />
      <path d="M5.6 18.4l.7-.7" />
      <path d="M17.7 6.3l.7-.7" />
    </svg>
  ),
  wind_sensor: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-cyan-600">
      <path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2" />
      <path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
      <path d="M12.6 19.4A2 2 0 1 0 14 16H2" />
    </svg>
  ),
  other_hardware: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-gray-600">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  ),
  // Legacy
  load_meter: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-blue-600">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  dg: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-slate-600">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 17v-2" />
      <path d="M12 17v-4" />
      <path d="M15 17v-6" />
    </svg>
  ),
  sensor: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-purple-600">
      <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />
    </svg>
  ),
};

// Section background colors
const sectionBgColors: Record<string, string> = {
  inverter: "bg-amber-100",
  wind_turbine: "bg-sky-100",
  bess: "bg-violet-100",
  gas_generator_controller: "bg-slate-100",
  diesel_generator_controller: "bg-slate-100",
  energy_meter: "bg-blue-100",
  capacitor_bank: "bg-indigo-100",
  fuel_level_sensor: "bg-orange-100",
  fuel_flow_meter: "bg-orange-100",
  temperature_humidity_sensor: "bg-teal-100",
  solar_radiation_sensor: "bg-yellow-100",
  wind_sensor: "bg-cyan-100",
  other_hardware: "bg-gray-100",
  // Legacy
  load_meter: "bg-blue-100",
  dg: "bg-slate-100",
  sensor: "bg-purple-100",
};

// Section titles (plural form for group headings)
const sectionTitles: Record<string, string> = {
  inverter: "Solar Inverters",
  wind_turbine: "Wind Turbines",
  bess: "Battery Energy Storage",
  gas_generator_controller: "Gas Generator Controllers",
  diesel_generator_controller: "Diesel Generator Controllers",
  energy_meter: "Energy Meters",
  capacitor_bank: "Capacitor Banks",
  fuel_level_sensor: "Fuel Level Sensors",
  fuel_flow_meter: "Fuel Flow Meters",
  temperature_humidity_sensor: "Temperature & Humidity Sensors",
  solar_radiation_sensor: "Solar Radiation Sensors",
  wind_sensor: "Wind Sensors",
  other_hardware: "Other Hardware",
  // Legacy
  load_meter: "Energy Meters (Legacy)",
  dg: "Generator Controllers (Legacy)",
  sensor: "Sensors (Legacy)",
};

export function DeviceTemplatesList({ templates, userRole, userEnterpriseId, enterprises }: DeviceTemplatesListProps) {
  const router = useRouter();

  // State for search and filters
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [templateTypeFilter, setTemplateTypeFilter] = useState<string>("all");

  // State for template dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [editingTemplate, setEditingTemplate] = useState<DeviceTemplate | undefined>();

  // State for duplicate dialog
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicatingTemplate, setDuplicatingTemplate] = useState<DeviceTemplate | undefined>();

  // State for delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState<DeviceTemplate | undefined>();
  const [isDeleting, setIsDeleting] = useState(false);

  // State for usage check / delete blocked dialog
  const [templateUsage, setTemplateUsage] = useState<TemplateUsageInfo[]>([]);
  const [showDeleteBlocked, setShowDeleteBlocked] = useState(false);
  const [isCheckingUsage, setIsCheckingUsage] = useState(false);

  // Create enterprise lookup map for displaying names on custom templates
  const enterpriseNameMap = useMemo(() => {
    const map = new Map<string, string>();
    enterprises?.forEach(e => map.set(e.id, e.name));
    return map;
  }, [enterprises]);

  // Permission: Can CREATE templates (add button visibility)
  // - super_admin/admin can create any template (public or custom)
  // - enterprise_admin/configurator can create custom templates for their enterprise
  const canCreate = userRole === "super_admin" ||
                    userRole === "admin" ||
                    userRole === "enterprise_admin" ||
                    userRole === "configurator";

  // Permission: Can EDIT a specific template
  // - super_admin/admin can edit all templates
  // - enterprise_admin/configurator can only edit their enterprise's custom templates
  const canEditTemplate = (template: DeviceTemplate): boolean => {
    // Super admin and admin can edit all templates
    if (userRole === "super_admin" || userRole === "admin") return true;

    // Enterprise admin or configurator can only edit their enterprise's custom templates
    if ((userRole === "enterprise_admin" || userRole === "configurator") &&
        template.template_type === "custom" &&
        template.enterprise_id === userEnterpriseId) {
      return true;
    }

    return false;
  };

  // Open dialog in create mode
  const handleAddTemplate = () => {
    setDialogMode("create");
    setEditingTemplate(undefined);
    setDialogOpen(true);
  };

  // Open dialog in edit mode
  const handleEditTemplate = (template: DeviceTemplate) => {
    setDialogMode("edit");
    setEditingTemplate(template);
    setDialogOpen(true);
  };

  // Handle successful save - refresh the page to get updated data
  const handleTemplateSaved = () => {
    // Refresh the page to get updated templates from server
    router.refresh();
  };

  // Open duplicate dialog
  const handleDuplicateTemplate = (template: DeviceTemplate) => {
    setDuplicatingTemplate(template);
    setDuplicateDialogOpen(true);
  };

  // Handle successful duplicate - refresh the page to get updated data
  const handleDuplicateSuccess = () => {
    router.refresh();
  };

  // Check if template is in use by any ACTIVE device in ACTIVE sites
  const checkTemplateUsage = async (templateId: string): Promise<TemplateUsageInfo[]> => {
    const supabase = createClient();

    // Query site_devices joined with sites and projects
    // Filter: only enabled devices in active sites
    const { data, error } = await supabase
      .from("site_devices")
      .select(`
        id,
        name,
        site_id,
        sites!inner (
          id,
          name,
          project_id,
          is_active,
          projects!inner (
            id,
            name
          )
        )
      `)
      .eq("template_id", templateId)
      .eq("enabled", true)
      .eq("sites.is_active", true);

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
        device_id: item.id,
        device_name: item.name,
        site_id: site.id,
        site_name: site.name,
        project_id: site.projects.id,
        project_name: site.projects.name,
      };
    });
  };

  // Open delete confirmation dialog - check usage first
  const handleDeleteTemplate = async (template: DeviceTemplate) => {
    setIsCheckingUsage(true);
    try {
      // Use template.id (UUID) not template.template_id (slug like "goodwe_100kw")
      const usage = await checkTemplateUsage(template.id);

      if (usage.length > 0) {
        // Template is in use - block deletion and show info
        setTemplateUsage(usage);
        setDeletingTemplate(template);
        setShowDeleteBlocked(true);
      } else {
        // Template not in use - show normal delete confirmation
        setDeletingTemplate(template);
        setDeleteDialogOpen(true);
      }
    } catch (error) {
      console.error("Error checking template usage:", error);
      // If check fails, still show delete confirmation
      setDeletingTemplate(template);
      setDeleteDialogOpen(true);
    } finally {
      setIsCheckingUsage(false);
    }
  };

  // Handle template delete
  const handleConfirmDelete = async () => {
    if (!deletingTemplate) return;

    setIsDeleting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("device_templates")
        .delete()
        .eq("id", deletingTemplate.id);

      if (error) throw error;

      toast.success("Template deleted successfully");
      router.refresh();
    } catch (error) {
      console.error("Error deleting template:", error);
      toast.error("Failed to delete template");
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setDeletingTemplate(undefined);
    }
  };

  // Get unique brands from templates
  const uniqueBrands = useMemo(() => {
    const brands = [...new Set(templates.map((t) => t.brand))];
    return brands.sort();
  }, [templates]);

  // Filter templates based on search and filters
  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      // Search filter (name, brand, model, template_id)
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch =
        searchQuery === "" ||
        template.name.toLowerCase().includes(searchLower) ||
        template.brand.toLowerCase().includes(searchLower) ||
        template.model.toLowerCase().includes(searchLower) ||
        template.template_id.toLowerCase().includes(searchLower);

      // Type filter
      const matchesType = typeFilter === "all" || template.device_type === typeFilter;

      // Brand filter
      const matchesBrand = brandFilter === "all" || template.brand === brandFilter;

      // Template type filter (public/custom)
      const matchesTemplateType =
        templateTypeFilter === "all" ||
        (templateTypeFilter === "public" && (!template.template_type || template.template_type === "public")) ||
        (templateTypeFilter === "custom" && template.template_type === "custom");

      return matchesSearch && matchesType && matchesBrand && matchesTemplateType;
    });
  }, [templates, searchQuery, typeFilter, brandFilter, templateTypeFilter]);

  // Group filtered templates by device type
  const templatesByType = useMemo(() => {
    return filteredTemplates.reduce(
      (acc, template) => {
        const type = template.device_type;
        if (!acc[type]) acc[type] = [];
        acc[type].push(template);
        return acc;
      },
      {} as Record<string, DeviceTemplate[]>
    );
  }, [filteredTemplates]);

  // Clear all filters
  const clearFilters = () => {
    setSearchQuery("");
    setTypeFilter("all");
    setBrandFilter("all");
    setTemplateTypeFilter("all");
  };

  const hasActiveFilters = searchQuery !== "" || typeFilter !== "all" || brandFilter !== "all" || templateTypeFilter !== "all";

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Search and Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search Input */}
        <div className="relative flex-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <Input
            type="text"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 min-h-[44px]"
          />
        </div>

        {/* Type Filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="min-h-[44px] px-3 rounded-md border border-input bg-background sm:w-48"
        >
          <option value="all">All Types</option>
          {DEVICE_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Brand Filter */}
        <select
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
          className="min-h-[44px] px-3 rounded-md border border-input bg-background sm:w-40"
        >
          <option value="all">All Brands</option>
          {uniqueBrands.map((brand) => (
            <option key={brand} value={brand}>
              {brand}
            </option>
          ))}
        </select>

        {/* Template Type Filter (Public/Custom) */}
        <select
          value={templateTypeFilter}
          onChange={(e) => setTemplateTypeFilter(e.target.value)}
          className="min-h-[44px] px-3 rounded-md border border-input bg-background sm:w-32"
        >
          <option value="all">All</option>
          <option value="public">Public</option>
          <option value="custom">Custom</option>
        </select>

        {/* Clear Filters Button */}
        {hasActiveFilters && (
          <Button variant="ghost" onClick={clearFilters} className="min-h-[44px]">
            Clear
          </Button>
        )}

        {/* Add Template Button (admin, super_admin, enterprise_admin) */}
        {canCreate && (
          <Button className="min-h-[44px]" onClick={handleAddTemplate}>
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
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            Add Template
          </Button>
        )}
      </div>

      {/* Results Count */}
      {hasActiveFilters && (
        <p className="text-sm text-muted-foreground">
          Showing {filteredTemplates.length} of {templates.length} templates
        </p>
      )}

      {/* No Results */}
      {filteredTemplates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6 text-muted-foreground"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">No templates found</h3>
            <p className="text-muted-foreground text-center max-w-sm">
              {hasActiveFilters
                ? "Try adjusting your search or filters."
                : "Device templates will be added to the database during setup."}
            </p>
            {hasActiveFilters && (
              <Button variant="outline" onClick={clearFilters} className="mt-4">
                Clear Filters
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Render each device type section */}
          {[...DEVICE_TYPE_OPTIONS.map(o => o.value), ...Object.keys(LEGACY_TYPE_MAP)].map((type) => {
            const typeTemplates = templatesByType[type];
            if (!typeTemplates || typeTemplates.length === 0) return null;

            return (
              <div key={type} className="space-y-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <div className={`h-8 w-8 rounded-lg ${sectionBgColors[type]} flex items-center justify-center`}>
                    {deviceTypeIcons[type]}
                  </div>
                  {sectionTitles[type]}
                  <Badge variant="secondary" className="ml-2">
                    {typeTemplates.length}
                  </Badge>
                </h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {typeTemplates.map((template) => (
                    <Card key={template.id} className="relative">
                      <CardHeader className="pb-3">
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap items-start gap-2">
                            {/* Template Name */}
                            <CardTitle className="text-base break-words flex-1 min-w-0">
                              {template.name}
                            </CardTitle>
                            {/* Badges */}
                            <div className="flex flex-wrap gap-1 items-center">
                              {/* Device Type Badge */}
                              <Badge className={deviceTypeColors[template.device_type]}>
                                {deviceTypeLabels[template.device_type] || template.device_type}
                              </Badge>
                              {/* Template type badge - Public (green) or Custom (blue) */}
                              <Badge
                                variant="secondary"
                                className={
                                  template.template_type === "custom"
                                    ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                                    : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                                }
                              >
                                {template.template_type === "custom" ? "Custom" : "Public"}
                              </Badge>
                              {/* Show enterprise name for custom templates */}
                              {template.template_type === "custom" && template.enterprise_id && (
                                <span className="text-xs text-muted-foreground">
                                  {enterpriseNameMap.get(template.enterprise_id) || "Unknown"}
                                </span>
                              )}
                            </div>
                          </div>
                          {/* Template ID */}
                          <CardDescription className="font-mono text-xs">
                            {template.template_id}
                          </CardDescription>
                        </div>
                      </CardHeader>

                      <CardContent className="pt-0">
                        {/* Brand & Model */}
                        <p className="text-sm text-muted-foreground mb-3">
                          {template.brand} {template.model}
                        </p>

                        {/* Stats */}
                        <div className="flex gap-4 text-sm text-muted-foreground mb-4">
                          {template.rated_power_kw && (
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
                                <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
                              </svg>
                              {template.rated_power_kw} kW
                            </span>
                          )}
                        </div>

                        {/* Active Status + Action Buttons */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Badge variant={template.is_active !== false ? "default" : "secondary"}>
                            {template.is_active !== false ? "Active" : "Inactive"}
                          </Badge>

                          {/* Action Buttons */}
                          <div className="flex flex-wrap gap-1 sm:gap-2">
                            {/* Duplicate button - visible to users who can create templates */}
                            {canCreate && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDuplicateTemplate(template)}
                                className="h-8 px-2 sm:px-3 text-sm"
                                title="Create a copy of this template"
                              >
                                Duplicate
                              </Button>
                            )}
                            {/* Edit button - visible to users who can edit this template */}
                            {canEditTemplate(template) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditTemplate(template)}
                                className="h-8 px-2 sm:px-3 text-sm"
                              >
                                Edit
                              </Button>
                            )}
                            {/* Delete button - visible to users who can edit this template */}
                            {canEditTemplate(template) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteTemplate(template)}
                                disabled={isCheckingUsage}
                                className="h-8 px-2 sm:px-3 text-sm text-destructive hover:text-destructive"
                              >
                                {isCheckingUsage ? "Checking..." : "Delete"}
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Template Create/Edit Dialog */}
      <TemplateFormDialog
        mode={dialogMode}
        template={editingTemplate}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={handleTemplateSaved}
        userRole={userRole}
        userEnterpriseId={userEnterpriseId}
        enterprises={enterprises}
      />

      {/* Duplicate Template Dialog */}
      {duplicatingTemplate && (
        <DuplicateTemplateDialog
          template={duplicatingTemplate}
          enterprises={enterprises}
          userRole={userRole}
          userEnterpriseId={userEnterpriseId}
          open={duplicateDialogOpen}
          onOpenChange={setDuplicateDialogOpen}
          onSuccess={handleDuplicateSuccess}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => !open && setDeleteDialogOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deletingTemplate?.name}&quot;? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Blocked Dialog - shown when trying to delete template in use */}
      <AlertDialog open={showDeleteBlocked} onOpenChange={(open) => {
        if (!open) {
          setShowDeleteBlocked(false);
          setDeletingTemplate(undefined);
          setTemplateUsage([]);
        }
      }}>
        <AlertDialogContent className="max-w-lg">
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
                  &quot;{deletingTemplate?.name}&quot; cannot be deleted because it is currently in use by {templateUsage.length} device{templateUsage.length !== 1 ? "s" : ""}.
                </p>
                <div className="rounded-md border p-3 bg-muted/50 max-h-48 overflow-y-auto">
                  <p className="text-sm font-medium mb-2">Used by:</p>
                  <ul className="space-y-1">
                    {templateUsage.map((usage, index) => (
                      <li key={index} className="text-sm">
                        <span className="font-medium">{usage.device_name}</span>
                        <span className="text-muted-foreground"> in </span>
                        <span>{usage.project_name}</span>
                        <span className="text-muted-foreground"> → </span>
                        <span>{usage.site_name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-sm text-muted-foreground">
                  To delete this template, first remove the devices listed above from their sites.
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
