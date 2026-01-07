/**
 * Dashboard Page
 *
 * Main overview page showing:
 * - System status summary
 * - Project cards
 * - Recent alarms
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormattedDate } from "@/components/ui/formatted-date";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import Link from "next/link";

// Stat card component
function StatCard({
  title,
  value,
  description,
  icon,
}: {
  title: string;
  value: React.ReactNode;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch user profile including avatar, role, and enterprise_id
  let userProfile: { full_name: string | null; avatar_url: string | null; role: string | null; enterprise_id: string | null } | null = null;
  if (user?.id) {
    const { data } = await supabase
      .from("users")
      .select("full_name, avatar_url, role, enterprise_id")
      .eq("id", user.id)
      .single();

    userProfile = data;
  }

  const userRole = userProfile?.role || "viewer";
  const userEnterpriseId = userProfile?.enterprise_id;
  const isAdmin = ["super_admin", "backend_admin", "admin"].includes(userRole);
  const isEnterpriseAdmin = userRole === "enterprise_admin";

  // Build project query based on user role
  // - Admins see all projects
  // - Enterprise admins see all projects in their enterprise
  // - Configurators/viewers see only assigned projects
  let projectsQuery = supabase
    .from("projects")
    .select("id, name, location")
    .eq("is_active", true)
    .order("name")
    .limit(6);

  if (!isAdmin) {
    if (isEnterpriseAdmin && userEnterpriseId) {
      // Enterprise admin: see all projects in their enterprise
      projectsQuery = projectsQuery.eq("enterprise_id", userEnterpriseId);
    } else if (user?.id) {
      // Configurator/viewer: see only assigned projects
      const { data: assignedProjects } = await supabase
        .from("user_projects")
        .select("project_id")
        .eq("user_id", user.id);

      const projectIds = assignedProjects?.map(p => p.project_id) || [];
      if (projectIds.length > 0) {
        projectsQuery = projectsQuery.in("id", projectIds);
      } else {
        // No assigned projects - return empty
        projectsQuery = projectsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
      }
    }
  }

  // Build sites query based on same access rules
  let sitesQuery = supabase
    .from("sites")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);

  if (!isAdmin) {
    if (isEnterpriseAdmin && userEnterpriseId) {
      // Enterprise admin: count sites from their enterprise's projects
      sitesQuery = sitesQuery.in(
        "project_id",
        supabase.from("projects").select("id").eq("enterprise_id", userEnterpriseId)
      );
    } else if (user?.id) {
      // Configurator/viewer: count sites from assigned projects only
      const { data: assignedProjects } = await supabase
        .from("user_projects")
        .select("project_id")
        .eq("user_id", user.id);

      const projectIds = assignedProjects?.map(p => p.project_id) || [];
      if (projectIds.length > 0) {
        sitesQuery = sitesQuery.in("project_id", projectIds);
      } else {
        sitesQuery = sitesQuery.eq("project_id", "00000000-0000-0000-0000-000000000000");
      }
    }
  }

  // Fetch projects, sites, and alarms in parallel for better performance
  // Note: Status is now fetched live by ProjectStatusBadge component
  const [projectsResult, sitesResult, alarmsResult] = await Promise.all([
    // Fetch projects with access filtering applied above
    Promise.resolve(projectsQuery).then(({ data, error }) => ({ data, error })),

    // Fetch total site count with access filtering
    Promise.resolve(sitesQuery).then(({ count, error }) => ({ count, error })),

    // Fetch recent alarms (TODO: also filter by project access)
    Promise.resolve(
      supabase
        .from("alarms")
        .select("id, alarm_type, message, severity, created_at")
        .eq("acknowledged", false)
        .order("created_at", { ascending: false })
        .limit(5)
    ).then(({ data, error }) => ({ data, error })),
  ]);

  // Process projects result
  const projects: Array<{
    id: string;
    name: string;
    location: string | null;
  }> = projectsResult.data && !projectsResult.error ? projectsResult.data : [];
  const projectCount = projects.length;

  // Process sites result
  const siteCount = sitesResult.count !== null && !sitesResult.error ? sitesResult.count : 0;

  // Process alarms result
  const alarms: Array<{
    id: string;
    alarm_type: string;
    message: string;
    severity: string;
    created_at: string;
  }> = alarmsResult.data && !alarmsResult.error ? alarmsResult.data : [];
  const unacknowledgedCount = alarms.length;

  return (
    <DashboardLayout user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}>
      {/* MOBILE-FRIENDLY: Responsive padding - smaller on mobile, larger on desktop */}
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header - responsive text sizes */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Overview of your Energy management systems
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Projects"
            value={projectCount}
            description="Active projects"
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            }
          />
          <StatCard
            title="Total Sites"
            value={siteCount}
            description="Active sites"
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18" />
                <path d="M9 21V9" />
              </svg>
            }
          />
          <StatCard
            title="Site Status"
            value={
              <span className="flex items-center gap-1">
                <span className="relative flex h-2.5 w-2.5 mr-1">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                </span>
                <span className="text-base font-normal text-muted-foreground">Live</span>
              </span>
            }
            description="Per-project status shown in cards"
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            }
          />
          <StatCard
            title="Active Alarms"
            value={unacknowledgedCount}
            description="Unacknowledged"
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
            }
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Projects */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Projects</CardTitle>
                <CardDescription>Your active sites</CardDescription>
              </div>
              <Link
                href="/projects"
                className="text-sm text-primary hover:underline"
              >
                View all
              </Link>
            </CardHeader>
            <CardContent>
              {projects.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No projects yet.</p>
                  <Link
                    href="/projects/new"
                    className="text-primary hover:underline"
                  >
                    Create your first project
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {projects.map((project) => (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors"
                    >
                      <div>
                        <p className="font-medium">{project.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {project.location || "No location"}
                        </p>
                      </div>
                      <ProjectStatusBadge projectId={project.id} />
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Alarms */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Alarms</CardTitle>
                <CardDescription>Unacknowledged alerts</CardDescription>
              </div>
              <Link
                href="/alarms"
                className="text-sm text-primary hover:underline"
              >
                View all
              </Link>
            </CardHeader>
            <CardContent>
              {alarms.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No active alarms</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {alarms.map((alarm) => (
                    <div
                      key={alarm.id}
                      className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
                    >
                      <div
                        className={`h-2 w-2 rounded-full mt-2 ${
                          alarm.severity === "critical"
                            ? "bg-red-500"
                            : alarm.severity === "warning"
                            ? "bg-yellow-500"
                            : "bg-blue-500"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {alarm.alarm_type.replace(/_/g, " ")}
                        </p>
                        <p className="text-sm text-muted-foreground truncate">
                          {alarm.message}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          <FormattedDate date={alarm.created_at} />
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
