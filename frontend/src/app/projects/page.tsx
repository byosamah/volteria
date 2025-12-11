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

  // Fetch user profile including avatar and role
  let userProfile: { full_name: string | null; avatar_url: string | null; role: string | null } | null = null;
  if (user?.id) {
    const { data } = await supabase
      .from("users")
      .select("full_name, avatar_url, role")
      .eq("id", user.id)
      .single();
    userProfile = data;
  }

  // Fetch all projects
  let projects: Array<{
    id: string;
    name: string;
    location: string | null;
    description: string | null;
    controller_serial_number: string | null;
    controller_status: string;
    controller_last_seen: string | null;
    created_at: string;
  }> = [];

  try {
    const { data, error } = await supabase
      .from("projects")
      .select(`
        id,
        name,
        location,
        description,
        controller_serial_number,
        controller_status,
        controller_last_seen,
        created_at
      `)
      .eq("is_active", true)
      .order("name");

    if (!error && data) {
      projects = data;
    }
  } catch {
    // Table might not exist yet
  }

  // Get site and device counts for all projects in batch (avoids N+1 queries)
  const projectIds = projects.map((p) => p.id);

  // Single query for all device counts
  let deviceCountMap: Record<string, number> = {};
  if (projectIds.length > 0) {
    try {
      const { data: deviceRows } = await supabase
        .from("project_devices")
        .select("project_id")
        .in("project_id", projectIds);

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
  if (projectIds.length > 0) {
    try {
      const { data: siteRows } = await supabase
        .from("sites")
        .select("project_id")
        .in("project_id", projectIds)
        .eq("is_active", true);

      // Count sites per project
      if (siteRows) {
        for (const row of siteRows) {
          siteCountMap[row.project_id] = (siteCountMap[row.project_id] || 0) + 1;
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // Combine projects with their counts
  const projectsWithCounts = projects.map((project) => ({
    ...project,
    deviceCount: deviceCountMap[project.id] || 0,
    siteCount: siteCountMap[project.id] || 0,
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
