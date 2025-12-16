/**
 * Site Settings Page
 *
 * Edit site configuration:
 * - Basic info (name, location, description)
 * - Control settings (DG reserve, control interval)
 * - Logging settings
 * - Safe mode settings
 * - Danger zone (delete)
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { notFound } from "next/navigation";
import Link from "next/link";
import { SiteSettingsForm } from "./site-settings-form";
import { DeleteSiteButton } from "./delete-site-button";

export default async function SiteSettingsPage({
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

  // Fetch site
  const { data: site, error } = await supabase
    .from("sites")
    .select("*")
    .eq("id", siteId)
    .single();

  if (error || !site) {
    notFound();
  }

  // Fetch project for breadcrumb
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();

  return (
    <DashboardLayout user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}>
      {/* MOBILE-FRIENDLY: Responsive padding with max-width on larger screens */}
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4 md:space-y-6">
        {/* Header - responsive with 44px touch target for back button */}
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${projectId}/sites/${siteId}`}
            className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Site Settings</h1>
            <p className="text-muted-foreground text-sm md:text-base">
              {project?.name} / {site.name}
            </p>
          </div>
        </div>

        {/* Settings Form */}
        <Card>
          <CardHeader>
            <CardTitle>Site Configuration</CardTitle>
            <CardDescription>
              Update settings for this physical location
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SiteSettingsForm site={site} projectId={projectId} />
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="text-red-600">Danger Zone</CardTitle>
            <CardDescription>
              Irreversible actions for this site
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Delete this site</p>
                <p className="text-sm text-muted-foreground">
                  All devices and data for this site will be permanently removed
                </p>
              </div>
              <DeleteSiteButton siteId={siteId} siteName={site.name} projectId={projectId} userRole={userProfile?.role || undefined} />
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
