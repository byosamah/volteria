/**
 * Historical Data Page (V2)
 *
 * Redesigned historical data viewer with drag-and-drop parameter selection.
 * Features:
 * - Project/Site/Device cascading selection
 * - Drag-and-drop parameter selection to Left/Right Y-axes
 * - Calendar date picker with quick presets (24h, 3d, 7d)
 * - Cloud/Local data source toggle (super admin only)
 * - Multiple parameters (max 10) with per-parameter chart type
 * - Reference lines and calculated fields (in Advanced Options)
 * - CSV/PNG export
 *
 * Limits:
 * - Max 10 parameters on one graph
 * - Max 7 day date range
 */

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { HistoricalDataClientV2 } from "@/components/historical/v2";

// Types for projects and sites
interface Project {
  id: string;
  name: string;
  timezone: string | null;
  is_active?: boolean;
}

interface Site {
  id: string;
  name: string;
  project_id: string;
  is_active?: boolean;
}

interface Device {
  id: string;
  name: string;
  site_id: string;
  device_type: string | null;
  enabled?: boolean;
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
    // Fetch ALL projects (including inactive) - client filters based on activeFilter toggle
    const { data } = await supabase
      .from("projects")
      .select("id, name, timezone, is_active")
      .order("is_active", { ascending: false }) // Active first
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
      // Fetch ALL assigned projects (including inactive)
      const { data } = await supabase
        .from("projects")
        .select("id, name, timezone, is_active")
        .in("id", projectIds)
        .order("is_active", { ascending: false }) // Active first
        .order("name");
      projects = data || [];
    }
  }

  // Fetch ALL sites for these projects (including inactive) - client filters based on activeFilter toggle
  const projectIds = projects.map((p) => p.id);
  let sites: Site[] = [];
  if (projectIds.length > 0) {
    const { data } = await supabase
      .from("sites")
      .select("id, name, project_id, is_active")
      .in("project_id", projectIds)
      .order("is_active", { ascending: false }) // Active first
      .order("name");
    sites = data || [];
  }

  // Fetch ALL devices for these sites (including disabled) - client filters based on activeFilter toggle
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
        enabled,
        device_templates(device_type)
      `)
      .in("site_id", siteIds)
      .order("enabled", { ascending: false }) // Enabled first
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
          device_type: d.device_type || (template as { device_type: string } | null)?.device_type || "unknown",
          enabled: d.enabled,
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
      {/* V2 Client Component - includes own header */}
      <HistoricalDataClientV2
        projects={projects}
        sites={sites}
        devices={devices}
        isSuperAdmin={userProfile?.role === "super_admin"}
      />
    </DashboardLayout>
  );
}
