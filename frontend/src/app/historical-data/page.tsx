/**
 * Historical Data Page
 *
 * Advanced time-series visualization for device data.
 * Features:
 * - Project/Site selection cascade
 * - Multiple parameters (up to 10) with color selection
 * - Multiple Y-axes (up to 3)
 * - Zoom via Recharts Brush component
 * - Reference lines
 * - Calculated fields
 * - CSV export
 */

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { HistoricalDataClient } from "@/components/historical/historical-data-client";

// Types for projects and sites
interface Project {
  id: string;
  name: string;
}

interface Site {
  id: string;
  name: string;
  project_id: string;
}

interface Device {
  id: string;
  name: string;
  site_id: string;
  device_type: string | null;
}

export default async function HistoricalDataPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch user profile
  const { data: userProfile } = await supabase
    .from("users")
    .select("full_name, avatar_url, role, enterprise_id")
    .eq("id", user.id)
    .single();

  // Fetch projects the user has access to
  // For super_admin/backend_admin, show all projects
  // For other users, show only assigned projects
  let projects: Project[] = [];
  const isAdmin = userProfile?.role === "super_admin" || userProfile?.role === "backend_admin";

  if (isAdmin) {
    const { data } = await supabase
      .from("projects")
      .select("id, name")
      .eq("is_active", true)
      .order("name");
    projects = data || [];
  } else {
    // Get projects via user_projects junction table
    const { data: userProjects } = await supabase
      .from("user_projects")
      .select("project_id")
      .eq("user_id", user.id);

    if (userProjects && userProjects.length > 0) {
      const projectIds = userProjects.map((up) => up.project_id);
      const { data } = await supabase
        .from("projects")
        .select("id, name")
        .in("id", projectIds)
        .eq("is_active", true)
        .order("name");
      projects = data || [];
    }
  }

  // Fetch all sites for these projects (client will filter by selected project)
  const projectIds = projects.map((p) => p.id);
  let sites: Site[] = [];
  if (projectIds.length > 0) {
    const { data } = await supabase
      .from("sites")
      .select("id, name, project_id")
      .in("project_id", projectIds)
      .eq("is_active", true)
      .order("name");
    sites = data || [];
  }

  // Fetch all devices for these sites (client will filter by selected site)
  const siteIds = sites.map((s) => s.id);
  let devices: Device[] = [];
  if (siteIds.length > 0) {
    const { data } = await supabase
      .from("site_devices")
      .select(`
        id,
        name,
        site_id,
        device_type,
        device_templates(device_type)
      `)
      .in("site_id", siteIds)
      .eq("enabled", true)
      .order("name");

    if (data) {
      devices = data.map((d) => {
        // Handle Supabase join - may return array or object
        const rawTemplate = d.device_templates;
        const template = Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate;
        return {
          id: d.id,
          name: d.name,
          site_id: d.site_id,
          device_type: (template as { device_type: string } | null)?.device_type || "unknown",
          device_type: d.device_type,
        };
      });
    }
  }

  return (
    <DashboardLayout
      user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
        enterprise_id: userProfile?.enterprise_id || undefined,
      }}
    >
      <div className="space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Historical Data</h1>
          <p className="text-muted-foreground">
            Visualize and analyze time-series data from your devices
          </p>
        </div>

        {/* Main Content - Client Component */}
        <HistoricalDataClient
          projects={projects}
          sites={sites}
          devices={devices}
          isSuperAdmin={userProfile?.role === "super_admin"}
        />
      </div>
    </DashboardLayout>
  );
}
