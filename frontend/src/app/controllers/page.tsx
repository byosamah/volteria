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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { ControllersTable } from "./controllers-table";
import Link from "next/link";

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

  // Viewers cannot access controllers page
  if (userProfile.role === "viewer") {
    redirect("/projects");
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

  // Fetch heartbeat data for connection status display
  // Get latest heartbeat timestamp for each controller
  const { data: heartbeatData } = await supabase
    .from("controller_heartbeats")
    .select("controller_id, timestamp")
    .not("controller_id", "is", null)
    .order("timestamp", { ascending: false });

  // Build map of controller_id -> latest heartbeat timestamp
  const heartbeatMap = new Map<string, string>();
  if (heartbeatData) {
    for (const hb of heartbeatData) {
      if (hb.controller_id && !heartbeatMap.has(hb.controller_id)) {
        heartbeatMap.set(hb.controller_id, hb.timestamp);
      }
    }
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
    last_heartbeat?: string | null;
  }

  // Add last_heartbeat to each controller from the heartbeat map
  const controllersWithHeartbeat = ((controllersData as unknown as ControllerRow[]) || []).map(
    (controller) => ({
      ...controller,
      last_heartbeat: heartbeatMap.get(controller.id) || null,
    })
  );
  const controllers = controllersWithHeartbeat;

  // Fetch approved hardware for the claim dialog dropdown
  const { data: hardwareTypes } = await supabase
    .from("approved_hardware")
    .select("id, hardware_type, name, manufacturer")
    .eq("is_active", true)
    .order("name");

  // Fetch enterprises for super admin dropdown in claim dialog
  // Super admins can assign controllers to any enterprise
  const { data: enterprises } = await supabase
    .from("enterprises")
    .select("id, name")
    .order("name");

  // Determine if user can claim/edit (enterprise_admin or super_admin)
  const canEdit = ["super_admin", "enterprise_admin"].includes(userProfile.role || "");

  // Count "ready" controllers available to claim (not yet assigned to any enterprise)
  // Only super_admin needs this - enterprise admins see status summary instead
  let readyToClaimCount = 0;
  if (isSuperAdmin) {
    const { count } = await supabase
      .from("controllers")
      .select("*", { count: "exact", head: true })
      .eq("status", "ready")
      .is("enterprise_id", null);

    readyToClaimCount = count || 0;
  }

  // Count controllers by deployment status (for enterprise admin summary)
  const deployedCount = controllers.filter((c) => c.status === "deployed").length;
  const readyToDeployCount = controllers.filter((c) => c.status === "claimed").length;

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

        {/* Ready to Claim Card - only shown to super_admin */}
        {isSuperAdmin && readyToClaimCount > 0 && (
          <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                {/* Icon */}
                <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center flex-shrink-0">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5 text-green-600 dark:text-green-400"
                  >
                    <rect width="20" height="14" x="2" y="3" rx="2" />
                    <line x1="8" x2="16" y1="21" y2="21" />
                    <line x1="12" x2="12" y1="17" y2="21" />
                  </svg>
                </div>
                {/* Text */}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-green-900 dark:text-green-100">
                      {readyToClaimCount} Controller{readyToClaimCount !== 1 ? "s" : ""} Ready to Claim
                    </span>
                    <Badge className="bg-green-600 hover:bg-green-700">New</Badge>
                  </div>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    Controllers are ready and waiting for you to claim them
                  </p>
                </div>
              </div>
              {/* Claim Button */}
              <Button asChild className="bg-green-600 hover:bg-green-700 min-h-[44px] w-full sm:w-auto">
                <Link href="/claim">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 mr-2"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Claim Controller
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Status Summary Card - for enterprise admins (not super_admin) */}
        {!isSuperAdmin && canEdit && (deployedCount > 0 || readyToDeployCount > 0) && (
          <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30">
            <CardContent className="p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
                {/* Deployed count */}
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center flex-shrink-0">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-5 w-5 text-green-600 dark:text-green-400"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-700 dark:text-green-400">{deployedCount}</p>
                    <p className="text-sm text-muted-foreground">Deployed</p>
                  </div>
                </div>

                {/* Ready to Deploy count */}
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-5 w-5 text-blue-600 dark:text-blue-400"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{readyToDeployCount}</p>
                    <p className="text-sm text-muted-foreground">Ready to Deploy</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

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
              enterprises={enterprises || []}
              canEdit={canEdit}
              isSuperAdmin={isSuperAdmin}
              userEnterpriseId={userProfile.enterprise_id}
              userEnterpriseName={enterpriseName !== "All Enterprises" ? enterpriseName : null}
            />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
