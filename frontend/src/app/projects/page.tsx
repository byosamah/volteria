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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    online: "default",
    offline: "secondary",
    error: "destructive",
  };

  const colors: Record<string, string> = {
    online: "bg-[#6baf4f]",
    offline: "bg-gray-400",
    error: "bg-red-500",
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`h-2 w-2 rounded-full ${colors[status] || "bg-gray-400"}`} />
      <Badge variant={variants[status] || "outline"} className="capitalize">
        {status}
      </Badge>
    </div>
  );
}

export default async function ProjectsPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch all projects
  let projects: Array<{
    id: string;
    name: string;
    location: string | null;
    description: string | null;
    controller_serial_number: string | null;
    controller_status: string;
    controller_last_seen: string | null;
    dg_reserve_kw: number;
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
        dg_reserve_kw,
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

  // Get device counts for each project
  const projectsWithCounts = await Promise.all(
    projects.map(async (project) => {
      let deviceCount = 0;
      try {
        const { count } = await supabase
          .from("project_devices")
          .select("*", { count: "exact", head: true })
          .eq("project_id", project.id);
        deviceCount = count || 0;
      } catch {
        // Ignore errors
      }
      return { ...project, deviceCount };
    })
  );

  return (
    <DashboardLayout user={{ email: user?.email }}>
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
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{project.name}</CardTitle>
                        <CardDescription>
                          {project.location || "No location set"}
                        </CardDescription>
                      </div>
                      <StatusBadge status={project.controller_status} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {project.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {project.description}
                        </p>
                      )}

                      <div className="grid grid-cols-2 gap-4 pt-2">
                        <div>
                          <p className="text-xs text-muted-foreground">Devices</p>
                          <p className="text-lg font-semibold">{project.deviceCount}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">DG Reserve</p>
                          <p className="text-lg font-semibold">{project.dg_reserve_kw} kW</p>
                        </div>
                      </div>

                      {/* Only show "Last seen" when controller is offline */}
                      {project.controller_status === "offline" && project.controller_last_seen && (
                        <p className="text-xs text-muted-foreground pt-2 border-t">
                          Last seen: {new Date(project.controller_last_seen).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
