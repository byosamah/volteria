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
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    online: "default",
    offline: "secondary",
    error: "destructive",
  };

  return (
    <Badge variant={variants[status] || "outline"} className="capitalize">
      {status}
    </Badge>
  );
}

// Stat card component
function StatCard({
  title,
  value,
  description,
  icon,
}: {
  title: string;
  value: string | number;
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

  // Fetch projects (with error handling for missing table)
  let projects: Array<{
    id: string;
    name: string;
    location: string | null;
    controller_status: string;
  }> = [];
  let projectCount = 0;
  let onlineCount = 0;

  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, location, controller_status")
      .eq("is_active", true)
      .order("name")
      .limit(6);

    if (!error && data) {
      projects = data;
      projectCount = data.length;
      onlineCount = data.filter((p) => p.controller_status === "online").length;
    }
  } catch {
    // Table might not exist yet
  }

  // Fetch recent alarms
  let alarms: Array<{
    id: string;
    alarm_type: string;
    message: string;
    severity: string;
    created_at: string;
  }> = [];
  let unacknowledgedCount = 0;

  try {
    const { data, error } = await supabase
      .from("alarms")
      .select("id, alarm_type, message, severity, created_at")
      .eq("acknowledged", false)
      .order("created_at", { ascending: false })
      .limit(5);

    if (!error && data) {
      alarms = data;
      unacknowledgedCount = data.length;
    }
  } catch {
    // Table might not exist yet
  }

  return (
    <DashboardLayout user={{ email: user?.email }}>
      {/* MOBILE-FRIENDLY: Responsive padding - smaller on mobile, larger on desktop */}
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header - responsive text sizes */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Overview of your hybrid energy systems
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Projects"
            value={projectCount}
            description="Active sites"
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            }
          />
          <StatCard
            title="Online"
            value={onlineCount}
            description="Controllers connected"
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            }
          />
          <StatCard
            title="Offline"
            value={projectCount - onlineCount}
            description="Controllers disconnected"
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
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
                      <StatusBadge status={project.controller_status} />
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
                          {new Date(alarm.created_at).toLocaleString()}
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
