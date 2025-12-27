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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TemplateFormDialog } from "./template-form-dialog";
import { DuplicateTemplateDialog } from "./duplicate-template-dialog";
import { Copy } from "lucide-react";

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
  load_meter: "bg-blue-100 text-blue-800",
  dg: "bg-slate-100 text-slate-800",
  sensor: "bg-purple-100 text-purple-800",
  fuel_level_sensor: "bg-orange-100 text-orange-800",
  temperature_humidity_sensor: "bg-teal-100 text-teal-800",
  solar_radiation_sensor: "bg-yellow-100 text-yellow-800",
  wind_sensor: "bg-cyan-100 text-cyan-800",
};

// Device type labels
const deviceTypeLabels: Record<string, string> = {
  inverter: "Solar Inverter",
  load_meter: "Energy Meter",
  dg: "Generator Controller",
  sensor: "Sensor (Generic)",
  fuel_level_sensor: "Fuel Level",
  temperature_humidity_sensor: "Temp & Humidity",
  solar_radiation_sensor: "Solar Radiation",
  wind_sensor: "Wind Sensor",
};

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
};

// Section background colors
const sectionBgColors: Record<string, string> = {
  inverter: "bg-amber-100",
  load_meter: "bg-blue-100",
  dg: "bg-slate-100",
  sensor: "bg-purple-100",
  fuel_level_sensor: "bg-orange-100",
  temperature_humidity_sensor: "bg-teal-100",
  solar_radiation_sensor: "bg-yellow-100",
  wind_sensor: "bg-cyan-100",
};

// Section titles
const sectionTitles: Record<string, string> = {
  inverter: "Solar Inverters",
  load_meter: "Energy Meters",
  dg: "Generator Controllers",
  sensor: "Sensors (Generic)",
  fuel_level_sensor: "Fuel Level Sensors",
  temperature_humidity_sensor: "Temperature & Humidity Sensors",
  solar_radiation_sensor: "Solar Radiation Sensors",
  wind_sensor: "Wind Sensors",
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
          <option value="inverter">Solar Inverters</option>
          <option value="load_meter">Energy Meters</option>
          <option value="dg">Generator Controllers</option>
          <option value="sensor">Sensors (Generic)</option>
          <option value="fuel_level_sensor">Fuel Level Sensors</option>
          <option value="temperature_humidity_sensor">Temp & Humidity</option>
          <option value="solar_radiation_sensor">Solar Radiation</option>
          <option value="wind_sensor">Wind Sensors</option>
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
          {/* All device types including new sensor subtypes */}
          {(["inverter", "load_meter", "dg", "sensor", "fuel_level_sensor", "temperature_humidity_sensor", "solar_radiation_sensor", "wind_sensor"] as const).map((type) => {
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
                    <Card key={template.id} className="group relative">
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-lg">{template.name}</CardTitle>
                            <CardDescription>
                              {template.brand} {template.model}
                            </CardDescription>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <Badge className={deviceTypeColors[template.device_type]}>
                              {deviceTypeLabels[template.device_type] || template.device_type}
                            </Badge>
                            {/* Template type badge - Public (green) or Custom (blue) */}
                            <Badge
                              variant="outline"
                              className={
                                template.template_type === "custom"
                                  ? "bg-blue-50 text-blue-700 border-blue-200"
                                  : "bg-green-50 text-green-700 border-green-200"
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
                      </CardHeader>
                      <CardContent>
                        <div className="text-sm space-y-1">
                          {template.rated_power_kw && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Rated Power</span>
                              <span className="font-medium">{template.rated_power_kw} kW</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Template ID</span>
                            <span className="font-mono text-xs">{template.template_id}</span>
                          </div>
                        </div>

                        {/* Action buttons - show on hover/focus if user has permission */}
                        {(canCreate || canEditTemplate(template)) && (
                          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex gap-1">
                            {/* Duplicate button - visible to users who can create templates */}
                            {canCreate && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => handleDuplicateTemplate(template)}
                                title="Duplicate template"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            )}
                            {/* Edit button - visible to users who can edit this template */}
                            {canEditTemplate(template) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => handleEditTemplate(template)}
                                title="Edit template"
                              >
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
                                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                  <path d="m15 5 4 4" />
                                </svg>
                              </Button>
                            )}
                          </div>
                        )}
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
    </div>
  );
}
