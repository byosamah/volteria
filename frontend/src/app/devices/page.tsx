/**
 * Device Templates Page
 *
 * Shows all available device templates with:
 * - Search by name, brand, model
 * - Filter by device type
 * - Filter by brand
 * - Edit/Delete actions (admin only)
 */

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DeviceTemplatesList } from "@/components/devices/device-templates-list";

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

  // Fetch device templates
  let templates: Array<{
    id: string;
    template_id: string;
    name: string;
    device_type: string;
    brand: string;
    model: string;
    rated_power_kw: number | null;
    template_type: string | null;
    enterprise_id: string | null;  // Which enterprise owns custom templates
    registers: Array<{
      address: number;
      name: string;
      type: string;
      datatype: string;
      access: string;
      logging_interval?: string;
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
  }> = [];

  try {
    const { data, error } = await supabase
      .from("device_templates")
      .select("id, template_id, name, device_type, brand, model, rated_power_kw, template_type, enterprise_id, registers, alarm_registers")
      .order("device_type")
      .order("brand");

    if (!error && data) {
      templates = data;
    }
  } catch {
    // Table might not exist yet
  }

  // Fetch enterprises for super admin to select when creating custom templates
  // Only fetch if user is super_admin or backend_admin
  let enterprises: Array<{ id: string; name: string }> = [];
  const isSuperAdmin = userProfile?.role === "super_admin" || userProfile?.role === "backend_admin";
  if (isSuperAdmin) {
    const { data: enterprisesData } = await supabase
      .from("enterprises")
      .select("id, name")
      .eq("is_active", true)
      .order("name");
    enterprises = enterprisesData || [];
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
        {/* Header - responsive text sizes */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Device Templates</h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Supported devices and their Modbus configurations
          </p>
        </div>

        {/* Device Templates List with search, filter, and admin actions */}
        <DeviceTemplatesList
          templates={templates}
          userRole={userRole}
          userEnterpriseId={userProfile?.enterprise_id}
          enterprises={enterprises}
        />
      </div>
    </DashboardLayout>
  );
}
