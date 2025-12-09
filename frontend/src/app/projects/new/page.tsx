/**
 * New Project Page
 *
 * Form to create a new project with:
 * - Basic info (name, location, description)
 * - Controller registration
 * - Control settings (DG reserve, intervals)
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewProjectForm } from "./new-project-form";

export default async function NewProjectPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch user profile including avatar, role, and enterprise
  let userProfile: {
    full_name: string | null;
    avatar_url: string | null;
    role: string | null;
    enterprise_id: string | null;
  } | null = null;
  let userEnterpriseName: string | null = null;

  if (user?.id) {
    const { data } = await supabase
      .from("users")
      .select("full_name, avatar_url, role, enterprise_id")
      .eq("id", user.id)
      .single();
    userProfile = data;

    // Fetch user's enterprise name if they have one
    if (data?.enterprise_id) {
      const { data: enterprise } = await supabase
        .from("enterprises")
        .select("name")
        .eq("id", data.enterprise_id)
        .single();
      userEnterpriseName = enterprise?.name || null;
    }
  }

  // For super_admin/backend_admin, fetch all enterprises
  let enterprises: Array<{ id: string; name: string }> = [];
  if (userProfile?.role === "super_admin" || userProfile?.role === "backend_admin") {
    const { data } = await supabase
      .from("enterprises")
      .select("id, name")
      .eq("is_active", true)
      .order("name");
    enterprises = data || [];
  }

  return (
    <DashboardLayout user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}>
      {/* MOBILE-FRIENDLY: Responsive padding with max-width on larger screens */}
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4 md:space-y-6">
        {/* Header - responsive text sizes */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Create New Project</h1>
          <p className="text-muted-foreground text-sm md:text-base">
            A project can have many sites
          </p>
        </div>

        {/* Form Card */}
        <Card>
          <CardHeader>
            <CardTitle>Project Details</CardTitle>
            <CardDescription>
              Enter the basic information for your project
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewProjectForm
              userRole={userProfile?.role || "viewer"}
              userEnterpriseId={userProfile?.enterprise_id || null}
              userEnterpriseName={userEnterpriseName}
              enterprises={enterprises}
            />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
