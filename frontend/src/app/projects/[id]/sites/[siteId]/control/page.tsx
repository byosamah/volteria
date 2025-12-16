/**
 * Remote Control Panel Page
 *
 * ⚠️ PHASE 3 - Remote Control UI
 *
 * Allows configurators to remotely control site operations:
 * - Inverter power limit adjustment (0-100%)
 * - DG reserve adjustment
 * - Emergency stop functionality
 * - Command history/audit trail
 *
 * Only users with "can_control" permission can send commands.
 * All commands are logged for audit purposes.
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Zap, Gauge, AlertTriangle, History, Power, ShieldAlert } from "lucide-react";
import { RemoteControlPanel } from "@/components/control/remote-control-panel";
import { CommandHistory } from "@/components/control/command-history";
import { EmergencyStopCard } from "@/components/control/emergency-stop-card";
import { DeviceRegistersPanel } from "@/components/control/device-registers-panel";

// Page props with project and site IDs from URL
interface ControlPageProps {
  params: Promise<{
    id: string;
    siteId: string;
  }>;
}

export default async function ControlPage({ params }: ControlPageProps) {
  const { id: projectId, siteId } = await params;
  const supabase = await createClient();

  // Get authenticated user
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) {
    redirect("/login");
  }

  // Get user profile with role
  const { data: userProfile } = await supabase
    .from("users")
    .select("id, email, full_name, role, avatar_url, enterprise_id")
    .eq("id", authUser.id)
    .single();

  if (!userProfile) {
    redirect("/login");
  }

  // Check user permissions for this project
  // Super admins, backend admins, and admins have full access
  const isAdmin = ["super_admin", "backend_admin", "admin"].includes(userProfile.role);

  let canControl = isAdmin;

  // For non-admins, check project assignment
  if (!isAdmin) {
    const { data: assignment } = await supabase
      .from("user_projects")
      .select("can_control")
      .eq("user_id", authUser.id)
      .eq("project_id", projectId)
      .single();

    canControl = assignment?.can_control || false;
  }

  // If user doesn't have control permission, show access denied
  if (!canControl) {
    return (
      <DashboardLayout
        user={{
          email: userProfile.email,
          full_name: userProfile.full_name,
          role: userProfile.role,
          avatar_url: userProfile.avatar_url,
          id: userProfile.id,
        }}
      >
        <div className="p-4 md:p-6 space-y-4 md:space-y-6">
          {/* Back button with 44px touch target */}
          <Link
            href={`/projects/${projectId}/sites/${siteId}`}
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px]"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Site
          </Link>

          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <ShieldAlert className="h-5 w-5" />
                Access Denied
              </CardTitle>
              <CardDescription>
                You don&apos;t have permission to control this site.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Only users with &quot;Can Control&quot; permission can send remote commands.
                Contact your administrator to request access.
              </p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  // Fetch project data
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .single();

  if (projectError || !project) {
    notFound();
  }

  // Fetch site data with control settings
  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select(`
      id,
      name,
      controller_status,
      dg_reserve_kw,
      control_interval_ms,
      operation_mode,
      safe_mode_enabled,
      safe_mode_power_limit_pct
    `)
    .eq("id", siteId)
    .eq("project_id", projectId)
    .single();

  if (siteError || !site) {
    notFound();
  }

  // Fetch devices with registers for this site
  const { data: devices } = await supabase
    .from("project_devices")
    .select(`
      id,
      name,
      is_online,
      registers,
      device_templates (
        name,
        device_type,
        brand,
        model
      )
    `)
    .eq("site_id", siteId)
    .eq("enabled", true)
    .order("name");

  // Check if controller is online - commands only work when online
  const isOnline = site.controller_status === "online";

  return (
    <DashboardLayout
      user={{
        email: userProfile.email,
        full_name: userProfile.full_name,
        role: userProfile.role,
        avatar_url: userProfile.avatar_url,
        id: userProfile.id,
      }}
    >
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header with back button */}
        <div className="space-y-2">
          {/* 44px touch target for back button */}
          <Link
            href={`/projects/${projectId}/sites/${siteId}`}
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] -ml-2 pl-2"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Site
          </Link>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                <Gauge className="h-6 w-6 md:h-8 md:w-8 text-primary" />
                Remote Control
              </h1>
              <p className="text-muted-foreground">
                {project.name} / {site.name}
              </p>
            </div>

            {/* Controller status badge */}
            <Badge
              variant={isOnline ? "default" : "secondary"}
              className={`${isOnline ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"} min-h-[32px] px-3`}
            >
              <Power className="h-3 w-3 mr-1" />
              Controller {isOnline ? "Online" : "Offline"}
            </Badge>
          </div>
        </div>

        {/* Offline warning banner */}
        {!isOnline && (
          <Card className="border-yellow-200 bg-yellow-50">
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-yellow-800">Controller Offline</p>
                  <p className="text-sm text-yellow-700">
                    Commands cannot be sent while the controller is offline.
                    Commands will be queued and executed when the controller reconnects.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main control grid */}
        <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
          {/* Remote Control Panel - Power limit and DG reserve adjustments */}
          <RemoteControlPanel
            siteId={siteId}
            projectId={projectId}
            currentDgReserve={site.dg_reserve_kw || 0}
            currentPowerLimit={site.safe_mode_power_limit_pct || 100}
            isOnline={isOnline}
          />

          {/* Emergency Stop Card - Big red button for emergencies */}
          <EmergencyStopCard
            siteId={siteId}
            projectId={projectId}
            isOnline={isOnline}
          />
        </div>

        {/* Device Registers Panel - View and edit device registers */}
        <DeviceRegistersPanel
          siteId={siteId}
          projectId={projectId}
          devices={(devices || []).map((d) => ({
            ...d,
            // Supabase returns joined data as arrays - extract first element
            device_templates: Array.isArray(d.device_templates)
              ? d.device_templates[0] || null
              : d.device_templates || null,
          }))}
          isOnline={isOnline}
        />

        {/* Command History - Shows all recent commands sent to this site */}
        <CommandHistory
          siteId={siteId}
          projectId={projectId}
        />
      </div>
    </DashboardLayout>
  );
}
