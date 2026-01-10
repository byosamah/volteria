/**
 * Projects List Page
 *
 * Shows all projects with:
 * - Status indicators
 * - Search/filter
 * - Quick actions
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ProjectCard } from "@/components/projects/project-card";

export default async function ProjectsPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch user profile including avatar, role, and enterprise
  let userProfile: { full_name: string | null; avatar_url: string | null; role: string | null; enterprise_id: string | null } | null = null;
  if (user?.id) {
    const { data } = await supabase
      .from("users")
      .select("full_name, avatar_url, role, enterprise_id")
      .eq("id", user.id)
      .single();
    userProfile = data;
  }

  // Fetch projects with enterprise data
  // Note: Status is now fetched live by ProjectStatusBadge component
  // Access control:
  // - super_admin/backend_admin/admin: see ALL projects
  // - enterprise_admin: see only projects in their enterprise
  // - configurator/viewer: see only assigned projects via user_projects
  let projects: Array<{
    id: string;
    name: string;
    location: string | null;
    description: string | null;
    created_at: string;
    enterprise_id: string | null;
    enterprises: { id: string; name: string } | null;
  }> = [];

  try {
    const userRole = userProfile?.role;
    const userEnterpriseId = userProfile?.enterprise_id;

    // Build the base query with enterprise join
    // Using explicit FK syntax to avoid ambiguity
    let query = supabase
      .from("projects")
      .select(`
        id,
        name,
        location,
        description,
        created_at,
        enterprise_id,
        enterprises!projects_enterprise_id_fkey (id, name)
      `)
      .eq("is_active", true);

    // Apply role-based filtering
    if (userRole === "super_admin" || userRole === "backend_admin" || userRole === "admin") {
      // Super admin, backend admin, and admin see ALL projects - no filter needed
    } else if (userRole === "enterprise_admin") {
      // Enterprise admin sees only projects in their enterprise
      if (userEnterpriseId) {
        query = query.eq("enterprise_id", userEnterpriseId);
      } else {
        // Enterprise admin without enterprise - show nothing
        query = query.eq("id", "00000000-0000-0000-0000-000000000000");
      }
    } else {
      // configurator/viewer: filter by user_projects assignments
      // First, get the project IDs this user has access to
      const { data: userProjectAssignments } = await supabase
        .from("user_projects")
        .select("project_id")
        .eq("user_id", user?.id || "");

      const assignedProjectIds = userProjectAssignments?.map((up) => up.project_id) || [];

      if (assignedProjectIds.length === 0) {
        // User has no project assignments - return empty
        projects = [];
      } else {
        query = query.in("id", assignedProjectIds);
      }
    }

    // Execute query (skip if already set to empty for no assignments)
    if (!(userRole !== "super_admin" && userRole !== "backend_admin" && userRole !== "admin" && userRole !== "enterprise_admin" && projects.length === 0)) {
      const { data, error } = await query.order("name");

      if (!error && data) {
        // Transform the Supabase response - enterprises might be an array
        projects = data.map((p) => ({
          ...p,
          enterprises: Array.isArray(p.enterprises)
            ? p.enterprises[0] || null
            : p.enterprises || null,
        }));
      }
    }
  } catch {
    // Table might not exist yet
  }

  // Get site and device counts for all projects in batch (avoids N+1 queries)
  const projectIds = projects.map((p) => p.id);

  // Single query for all device counts (only enabled devices)
  let deviceCountMap: Record<string, number> = {};
  if (projectIds.length > 0) {
    try {
      const { data: deviceRows } = await supabase
        .from("project_devices")
        .select("project_id")
        .in("project_id", projectIds)
        .eq("enabled", true);

      // Count devices per project
      if (deviceRows) {
        for (const row of deviceRows) {
          deviceCountMap[row.project_id] = (deviceCountMap[row.project_id] || 0) + 1;
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // Single query for all site counts
  let siteCountMap: Record<string, number> = {};
  // Store site_id -> project_id mapping for controller count lookup
  let siteToProjectMap: Record<string, string> = {};
  if (projectIds.length > 0) {
    try {
      const { data: siteRows } = await supabase
        .from("sites")
        .select("id, project_id")
        .in("project_id", projectIds)
        .eq("is_active", true);

      // Count sites per project and build site->project mapping
      if (siteRows) {
        for (const row of siteRows) {
          siteCountMap[row.project_id] = (siteCountMap[row.project_id] || 0) + 1;
          siteToProjectMap[row.id] = row.project_id;
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // Single query for all controller counts (only active master devices via sites)
  let controllerCountMap: Record<string, number> = {};
  const siteIds = Object.keys(siteToProjectMap);
  if (siteIds.length > 0) {
    try {
      const { data: masterDeviceRows } = await supabase
        .from("site_master_devices")
        .select("site_id")
        .in("site_id", siteIds)
        .eq("is_active", true);

      // Count master devices per project (via site->project mapping)
      if (masterDeviceRows) {
        for (const row of masterDeviceRows) {
          const projectId = siteToProjectMap[row.site_id];
          if (projectId) {
            controllerCountMap[projectId] = (controllerCountMap[projectId] || 0) + 1;
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // Combine projects with their counts and enterprise data
  const projectsWithCounts = projects.map((project) => ({
    id: project.id,
    name: project.name,
    location: project.location,
    description: project.description,
    deviceCount: deviceCountMap[project.id] || 0,
    siteCount: siteCountMap[project.id] || 0,
    controllerCount: controllerCountMap[project.id] || 0,
    enterprises: project.enterprises,
  }));

  return (
    <DashboardLayout user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}>
      {/* MOBILE-FRIENDLY: Responsive padding */}
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header - stacks on mobile, row on desktop */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Projects</h1>
            <p className="text-muted-foreground text-sm md:text-base">
              Manage your hybrid energy sites
            </p>
          </div>
          {/* Button - full width on mobile, auto width on desktop */}
          <Button asChild className="w-full sm:w-auto min-h-[44px]">
            <Link href="/projects/new">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Project
            </Link>
          </Button>
        </div>

        {/* Projects Grid */}
        {projectsWithCounts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-muted-foreground">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">No projects yet</h3>
              <p className="text-muted-foreground text-center max-w-sm mb-4">
                Create your first project to start monitoring your hybrid energy system.
              </p>
              <Button asChild>
                <Link href="/projects/new">Create Project</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projectsWithCounts.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
