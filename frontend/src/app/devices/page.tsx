/**
 * Device Templates Page
 *
 * Shows two tabs:
 * 1. Device Templates - Modbus devices (inverters, meters, DGs)
 * 2. Master Devices - Controller templates (Raspberry Pi, Gateway, PLC)
 *
 * Features:
 * - Search by name, brand, model
 * - Filter by device type
 * - Filter by brand
 * - Edit/Delete actions (role-based)
 * - Public/Custom template types for Master Devices
 */

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DeviceTemplatesList } from "@/components/devices/device-templates-list";
import { MasterDeviceTemplatesList } from "@/components/devices/master-device-templates-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ControllerTemplate } from "@/lib/types";

export default async function DevicesPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch user's profile (role, full_name, avatar_url, enterprise_id) from users table
  let userProfile: { role: string | null; full_name: string | null; avatar_url: string | null; enterprise_id: string | null } | null = null;
  if (user?.id) {
    const { data: userData } = await supabase
      .from("users")
      .select("role, full_name, avatar_url, enterprise_id")
      .eq("id", user.id)
      .single();
    userProfile = userData;
  }

  // Viewers cannot access device templates page
  if (userProfile?.role === "viewer") {
    redirect("/projects");
  }

  const userRole = userProfile?.role || undefined;
  const userEnterpriseId = userProfile?.enterprise_id || null;
  const isSuperAdmin = userProfile?.role === "super_admin" || userProfile?.role === "backend_admin";

  // Fetch device templates
  // Updated to include new columns: logging_registers, visualization_registers, calculated_fields
  // Show all templates (active and inactive) but filter inactive when adding new devices
  let templates: Array<{
    id: string;
    template_id: string;
    name: string;
    device_type: string;
    brand: string;
    model: string;
    rated_power_kw: number | null;
    template_type: string | null;
    enterprise_id: string | null;
    is_active?: boolean;
    logging_registers: Array<{
      address: number;
      name: string;
      type: string;
      datatype: string;
      access: string;
      logging_frequency?: number;
    }> | null;
    visualization_registers: Array<{
      address: number;
      name: string;
      type: string;
      datatype: string;
      access: string;
      scale?: number;
    }> | null;
    alarm_registers: Array<{
      address: number;
      name: string;
      type: string;
      datatype: string;
      access: string;
      thresholds?: Array<{
        operator: string;
        value: number;
        severity: string;
        message?: string;
      }>;
    }> | null;
    calculated_fields: Array<{
      field_id: string;
      name: string;
      storage_mode: "log" | "viz_only";
    }> | null;
    registers?: Array<{
      address: number;
      name: string;
      type: string;
      datatype: string;
      access: string;
      logging_interval?: string;
    }> | null;
  }> = [];

  try {
    // Query templates with visibility filtering
    // - Super admin/backend admin see all templates
    // - Enterprise users see: public templates + their enterprise's custom templates
    let query = supabase
      .from("device_templates")
      .select("id, template_id, name, device_type, brand, model, rated_power_kw, template_type, enterprise_id, logging_registers, visualization_registers, alarm_registers, calculated_fields, registers, is_active")
      .order("device_type")
      .order("brand");

    // Apply visibility filter for non-super admin users
    if (!isSuperAdmin && userEnterpriseId) {
      // Enterprise users see: public templates OR their enterprise's custom templates
      query = query.or(`template_type.eq.public,template_type.is.null,enterprise_id.eq.${userEnterpriseId}`);
    } else if (!isSuperAdmin && !userEnterpriseId) {
      // Users without enterprise only see public templates
      query = query.or("template_type.eq.public,template_type.is.null");
    }

    const { data, error } = await query;

    if (error) {
      // Log the error for debugging
      console.error("[DevicesPage] Error fetching device templates:", error.message, error.code, error.details);
    } else {
      console.log("[DevicesPage] Fetched device templates count (raw):", data?.length || 0);
    }

    if (data) {
      // Show all templates (including inactive) so users can manage them
      // Inactive templates will show "Inactive" badge and won't appear in add device pages
      templates = data;
      console.log("[DevicesPage] Templates count:", templates.length);
    }
  } catch (err) {
    // Log any unexpected errors
    console.error("[DevicesPage] Unexpected error fetching device templates:", err);
  }

  // Fetch enterprises for:
  // 1. Super admin to select when creating custom templates
  // 2. All users to display enterprise names on custom templates
  let enterprises: Array<{ id: string; name: string }> = [];

  // Fetch all active enterprises for name display
  const { data: enterprisesData } = await supabase
    .from("enterprises")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  enterprises = enterprisesData || [];

  // Fetch controller templates (Master Devices)
  // Visibility rules:
  // - super_admin/backend_admin see all templates
  // - Others see: public templates + their enterprise's custom templates
  let controllerTemplates: ControllerTemplate[] = [];

  try {
    let query = supabase
      .from("controller_templates")
      .select("*")
      .eq("is_active", true)
      .order("name");

    // Apply visibility filter for non-admin users
    if (!isSuperAdmin) {
      // Use RLS or filter manually:
      // Either template_type = 'public' OR (template_type = 'custom' AND enterprise_id = user's enterprise)
      query = query.or(`template_type.eq.public,enterprise_id.eq.${userEnterpriseId}`);
    }

    const { data, error } = await query;

    if (!error && data) {
      controllerTemplates = data as ControllerTemplate[];
    }
  } catch {
    // Table might not exist yet
  }

  return (
    <DashboardLayout user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}>
      {/* MOBILE-FRIENDLY: Responsive padding */}
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Device Templates</h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Supported devices and their configurations
          </p>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="device-templates" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:inline-flex">
            <TabsTrigger value="device-templates" className="gap-2">
              Device Templates
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                {templates.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="master-devices" className="gap-2">
              Master Devices
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                {controllerTemplates.length}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* Device Templates Tab */}
          <TabsContent value="device-templates" className="space-y-4">
            <DeviceTemplatesList
              templates={templates}
              userRole={userRole}
              userEnterpriseId={userEnterpriseId}
              enterprises={enterprises}
            />
          </TabsContent>

          {/* Master Devices Tab */}
          <TabsContent value="master-devices" className="space-y-4">
            <MasterDeviceTemplatesList
              templates={controllerTemplates}
              userRole={userRole}
              userEnterpriseId={userEnterpriseId}
              enterprises={enterprises}
            />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
