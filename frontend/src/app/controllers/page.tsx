/**
 * My Controllers Page
 *
 * Shows all controllers claimed by the user's enterprise.
 * Enterprise admins can claim new controllers and update firmware.
 * Viewers get read-only access.
 * Super admins can see all controllers across enterprises.
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";
import { ControllersTable } from "./controllers-table";

export default async function ControllersPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch user profile including role and enterprise
  const { data: userProfile } = await supabase
    .from("users")
    .select("full_name, avatar_url, role, enterprise_id")
    .eq("id", user.id)
    .single();

  if (!userProfile) {
    redirect("/login");
  }

  // Check if user has access (must have enterprise_id OR be super_admin)
  const isSuperAdmin = userProfile.role === "super_admin";
  const hasEnterprise = !!userProfile.enterprise_id;

  if (!isSuperAdmin && !hasEnterprise) {
    // User doesn't belong to any enterprise and isn't super admin
    redirect("/projects");
  }

  // Fetch enterprise name if user belongs to one
  let enterpriseName = "All Enterprises";
  if (userProfile.enterprise_id) {
    const { data: enterprise } = await supabase
      .from("enterprises")
      .select("name")
      .eq("id", userProfile.enterprise_id)
      .single();

    if (enterprise) {
      enterpriseName = enterprise.name;
    }
  }

  // Fetch controllers based on user role
  // Super admin sees all, others see only their enterprise's controllers
  let controllersQuery = supabase
    .from("controllers")
    .select(`
      id,
      serial_number,
      status,
      firmware_version,
      firmware_updated_at,
      claimed_at,
      claimed_by,
      enterprise_id,
      project_id,
      approved_hardware:hardware_type_id (
        name,
        manufacturer,
        hardware_type
      ),
      enterprises:enterprise_id (
        name
      )
    `)
    .order("claimed_at", { ascending: false, nullsFirst: false });

  // Filter by enterprise unless super admin
  if (!isSuperAdmin && userProfile.enterprise_id) {
    controllersQuery = controllersQuery.eq("enterprise_id", userProfile.enterprise_id);
  }

  const { data: controllersData, error: controllersError } = await controllersQuery;

  if (controllersError) {
    console.error("Error fetching controllers:", controllersError);
  }

  // Transform data to match expected type (Supabase returns single objects for FK joins)
  // TypeScript can't infer this correctly so we need to cast
  interface ControllerRow {
    id: string;
    serial_number: string;
    status: string;
    firmware_version: string | null;
    firmware_updated_at: string | null;
    claimed_at: string | null;
    claimed_by: string | null;
    enterprise_id: string | null;
    project_id: string | null;
    approved_hardware: {
      name: string;
      manufacturer: string;
      hardware_type: string;
    } | null;
    enterprises: {
      name: string;
    } | null;
  }
  const controllers = (controllersData as unknown as ControllerRow[]) || [];

  // Fetch approved hardware for the claim dialog dropdown
  const { data: hardwareTypes } = await supabase
    .from("approved_hardware")
    .select("id, hardware_type, name, manufacturer")
    .eq("is_active", true)
    .order("name");

  // Determine if user can claim/edit (enterprise_admin or super_admin)
  const canEdit = ["super_admin", "enterprise_admin"].includes(userProfile.role || "");

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
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-bold">My Controllers</h1>
            <p className="text-muted-foreground">
              {isSuperAdmin
                ? "All controllers across all enterprises"
                : `Controllers claimed by ${enterpriseName}`}
            </p>
          </div>
        </div>

        {/* Controllers Table */}
        <Card>
          <CardHeader>
            <CardTitle>Claimed Controllers</CardTitle>
            <CardDescription>
              {controllers?.length || 0} controller(s) found
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ControllersTable
              controllers={controllers || []}
              hardwareTypes={hardwareTypes || []}
              canEdit={canEdit}
              isSuperAdmin={isSuperAdmin}
              userEnterpriseId={userProfile.enterprise_id}
            />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
