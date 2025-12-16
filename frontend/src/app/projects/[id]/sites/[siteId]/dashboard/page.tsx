/**
 * Interactive Site Dashboard Page
 *
 * Customizable dashboard for viewing site status with:
 * - Visual layout of site equipment (icons with live data)
 * - Custom charts for selected registers
 * - Alarm list
 * - Device status indicators
 *
 * Features:
 * - Grid-based layout (12 columns)
 * - Drag-and-drop widget positioning (edit mode)
 * - Auto-refresh every 30 seconds (configurable)
 * - Max 30 widgets/registers per dashboard
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { notFound } from "next/navigation";
import { DashboardCanvas } from "./dashboard-canvas";

export default async function SiteDashboardPage({
  params,
}: {
  params: Promise<{ id: string; siteId: string }>;
}) {
  const { id: projectId, siteId } = await params;
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch user profile
  let userProfile: {
    full_name: string | null;
    avatar_url: string | null;
    role: string | null;
  } | null = null;

  if (user?.id) {
    const { data } = await supabase
      .from("users")
      .select("full_name, avatar_url, role")
      .eq("id", user.id)
      .single();
    userProfile = data;
  }

  // Fetch site details
  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("id, name, project_id")
    .eq("id", siteId)
    .single();

  if (siteError || !site) {
    notFound();
  }

  // Verify site belongs to project
  if (site.project_id !== projectId) {
    notFound();
  }

  // Fetch project for breadcrumb
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .single();

  // Fetch dashboard config (if exists)
  const { data: dashboard } = await supabase
    .from("site_dashboards")
    .select("*")
    .eq("site_id", siteId)
    .single();

  // Fetch widgets (if dashboard exists)
  let widgets: Array<{
    id: string;
    widget_type: string;
    grid_row: number;
    grid_col: number;
    grid_width: number;
    grid_height: number;
    config: Record<string, unknown>;
    z_index: number;
  }> = [];

  if (dashboard) {
    const { data: widgetData } = await supabase
      .from("dashboard_widgets")
      .select("*")
      .eq("dashboard_id", dashboard.id)
      .order("z_index", { ascending: true });

    if (widgetData) {
      widgets = widgetData;
    }
  }

  // Fetch site devices for widget configuration
  const { data: rawDevices } = await supabase
    .from("project_devices")
    .select(`
      id,
      name,
      device_type,
      is_online,
      last_seen,
      device_templates (
        id,
        name,
        device_type,
        registers
      )
    `)
    .eq("site_id", siteId)
    .eq("enabled", true)
    .order("name");

  // Transform devices to handle Supabase join format (array vs object)
  const devices = rawDevices?.map((d) => {
    const rawTemplate = d.device_templates;
    const template = Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate;
    return {
      id: d.id,
      name: d.name,
      device_type: d.device_type,
      is_online: d.is_online,
      last_seen: d.last_seen,
      device_templates: template || null,
    };
  });

  // Determine if user can edit
  const canEdit =
    userProfile?.role &&
    ["super_admin", "backend_admin", "admin", "enterprise_admin", "configurator"].includes(
      userProfile.role
    );

  return (
    <DashboardLayout
      user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}
    >
      <DashboardCanvas
        siteId={siteId}
        siteName={site.name}
        projectId={projectId}
        projectName={project?.name || "Project"}
        dashboard={dashboard}
        initialWidgets={widgets}
        devices={devices || []}
        canEdit={canEdit || false}
      />
    </DashboardLayout>
  );
}
