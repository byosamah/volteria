/**
 * Project Detail Page
 *
 * Shows project overview with list of sites.
 * Projects are virtual groupings that contain multiple sites.
 * Sites are physical locations with one controller each.
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormattedDate } from "@/components/ui/formatted-date";
import Link from "next/link";
import { notFound } from "next/navigation";

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

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  // Fetch project details
  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !project) {
    notFound();
  }

  // Fetch sites for this project
  let sites: Array<{
    id: string;
    name: string;
    location: string | null;
    controller_status: string;
    controller_last_seen: string | null;
    dg_reserve_kw: number;
    is_active: boolean;
  }> = [];

  try {
    const { data } = await supabase
      .from("sites")
      .select("id, name, location, controller_status, controller_last_seen, dg_reserve_kw, is_active")
      .eq("project_id", id)
      .eq("is_active", true)
      .order("name");

    if (data) {
      sites = data;
    }
  } catch {
    // Ignore errors
  }

  // Count devices per site
  const siteDeviceCounts: Record<string, number> = {};
  for (const site of sites) {
    try {
      const { count } = await supabase
        .from("project_devices")
        .select("id", { count: "exact", head: true })
        .eq("site_id", site.id)
        .eq("enabled", true);
      siteDeviceCounts[site.id] = count || 0;
    } catch {
      siteDeviceCounts[site.id] = 0;
    }
  }

  // Calculate summary stats
  const totalSites = sites.length;
  const onlineSites = sites.filter(s => s.controller_status === "online").length;
  const totalDevices = Object.values(siteDeviceCounts).reduce((a, b) => a + b, 0);

  return (
    <DashboardLayout user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}>
      {/* MOBILE-FRIENDLY: Responsive padding */}
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header - stacks on mobile */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Back button - 44px touch target */}
              <Link
                href="/projects"
                className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </Link>
              <h1 className="text-2xl md:text-3xl font-bold">{project.name}</h1>
            </div>
            <p className="text-muted-foreground text-sm md:text-base">
              {project.description || "No description"}
            </p>
          </div>
          {/* Add Site button */}
          <div className="flex gap-2">
            <Button asChild className="w-full sm:w-auto min-h-[44px]">
              <Link href={`/projects/${id}/sites/new`}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-2">
                  <path d="M5 12h14" />
                  <path d="M12 5v14" />
                </svg>
                Add Site
              </Link>
            </Button>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Sites</CardDescription>
              <CardTitle className="text-3xl">{totalSites}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Online</CardDescription>
              <CardTitle className="text-3xl text-green-600">{onlineSites}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Devices</CardDescription>
              <CardTitle className="text-3xl">{totalDevices}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Sites List */}
        <Card>
          <CardHeader>
            <CardTitle>Sites</CardTitle>
            <CardDescription>Physical locations with controllers</CardDescription>
          </CardHeader>
          <CardContent>
            {sites.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No sites yet.</p>
                <Link
                  href={`/projects/${id}/sites/new`}
                  className="text-primary hover:underline"
                >
                  Add your first site
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {sites.map((site) => (
                  <Link
                    key={site.id}
                    href={`/projects/${id}/sites/${site.id}`}
                    className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{site.name}</p>
                        <StatusBadge status={site.controller_status} />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {site.location || "No location"}
                      </p>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{siteDeviceCounts[site.id] || 0} devices</span>
                        <span>DG Reserve: {site.dg_reserve_kw} kW</span>
                        {site.controller_status === "offline" && site.controller_last_seen && (
                          <span>Last seen: <FormattedDate date={site.controller_last_seen} /></span>
                        )}
                      </div>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-muted-foreground">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
