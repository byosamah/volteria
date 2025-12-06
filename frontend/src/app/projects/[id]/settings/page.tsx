/**
 * Project Settings Page
 *
 * Edit project configuration:
 * - Basic info
 * - Control settings
 * - Safe mode settings
 * - Danger zone (delete)
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ProjectSettingsForm } from "./project-settings-form";
import { DeleteProjectButton } from "./delete-project-button";

export default async function ProjectSettingsPage({
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

  // Fetch project
  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !project) {
    notFound();
  }

  return (
    <DashboardLayout user={{ email: user?.email }}>
      {/* MOBILE-FRIENDLY: Responsive padding with max-width on larger screens */}
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4 md:space-y-6">
        {/* Header - responsive with 44px touch target for back button */}
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${id}`}
            className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Project Settings</h1>
            <p className="text-muted-foreground text-sm md:text-base">{project.name}</p>
          </div>
        </div>

        {/* Settings Form */}
        <Card>
          <CardHeader>
            <CardTitle>Project Configuration</CardTitle>
            <CardDescription>
              Update your project settings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProjectSettingsForm project={project} />
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="text-red-600">Danger Zone</CardTitle>
            <CardDescription>
              Irreversible actions for this project
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Delete this project</p>
                <p className="text-sm text-muted-foreground">
                  Once deleted, all data will be permanently removed
                </p>
              </div>
              <DeleteProjectButton projectId={id} projectName={project.name} />
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
