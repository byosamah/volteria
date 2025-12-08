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
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DeviceTemplatesList } from "@/components/devices/device-templates-list";

export default async function DevicesPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch user's profile (role, full_name, avatar_url) from users table
  let userProfile: { role: string | null; full_name: string | null; avatar_url: string | null } | null = null;
  if (user?.id) {
    const { data: userData } = await supabase
      .from("users")
      .select("role, full_name, avatar_url")
      .eq("id", user.id)
      .single();
    userProfile = userData;
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
  }> = [];

  try {
    const { data, error } = await supabase
      .from("device_templates")
      .select("id, template_id, name, device_type, brand, model, rated_power_kw, template_type")
      .order("device_type")
      .order("brand");

    if (!error && data) {
      templates = data;
    }
  } catch {
    // Table might not exist yet
  }

  return (
    <DashboardLayout user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
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
        <DeviceTemplatesList templates={templates} userRole={userRole} />
      </div>
    </DashboardLayout>
  );
}
