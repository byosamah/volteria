/**
 * Controller Master List Page
 *
 * Admin page for managing all controller hardware.
 * Only accessible to super_admin and backend_admin users.
 *
 * Features:
 * - List all controllers (draft, ready, claimed, deployed, eol)
 * - Register new controller hardware
 * - Generate/copy passcodes
 * - View deployment status
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import { ControllersList } from "./controllers-list";

export default async function ControllersPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Check user role - only super_admin and backend_admin can access
  let userProfile: { role: string | null; full_name: string | null; avatar_url: string | null } | null = null;
  if (user?.id) {
    const { data: userData, error } = await supabase
      .from("users")
      .select("role, full_name, avatar_url")
      .eq("id", user.id)
      .single();

    // Error handling: Log and redirect if query fails
    if (error) {
      console.error("Failed to fetch user role:", error);
      redirect("/");
    }
    userProfile = userData;
  }
  const userRole = userProfile?.role;

  // Redirect if not authorized (requires super_admin or backend_admin)
  if (!userRole || (userRole !== "super_admin" && userRole !== "backend_admin")) {
    redirect("/");
  }

  // Fetch controllers with hardware type info
  let controllers: Array<{
    id: string;
    serial_number: string;
    status: string;
    firmware_version: string | null;
    notes: string | null;
    passcode: string | null;
    enterprise_id: string | null;
    created_at: string;
    approved_hardware: {
      name: string;
      hardware_type: string;
    } | null;
    enterprises: {
      name: string;
    } | null;
    last_heartbeat: string | null;
    pending_restart: boolean | null;
    ssh_port: number | null;
    ssh_username: string | null;
    ssh_password: string | null;
    wizard_step: number | null;
  }> = [];

  try {
    const { data, error } = await supabase
      .from("controllers")
      .select(`
        id,
        serial_number,
        status,
        firmware_version,
        notes,
        passcode,
        enterprise_id,
        created_at,
        pending_restart,
        ssh_port,
        ssh_username,
        ssh_password,
        wizard_step,
        approved_hardware:hardware_type_id (
          name,
          hardware_type
        ),
        enterprises:enterprise_id (
          name
        )
      `)
      .order("created_at", { ascending: false });

    if (!error && data) {
      // Transform Supabase data - relations come as arrays, extract first element
      controllers = data.map((item) => ({
        ...item,
        approved_hardware: Array.isArray(item.approved_hardware)
          ? item.approved_hardware[0] || null
          : item.approved_hardware,
        enterprises: Array.isArray(item.enterprises)
          ? item.enterprises[0] || null
          : item.enterprises,
        last_heartbeat: null, // Will be populated below
        ssh_port: item.ssh_port || null,
        ssh_username: item.ssh_username || null,
        ssh_password: item.ssh_password || null,
        wizard_step: item.wizard_step || null,
      })) as typeof controllers;
    }
  } catch {
    // Tables might not exist yet
  }

  // Fetch latest heartbeat for each controller DIRECTLY from controller_heartbeats table
  // Controllers send heartbeats with their controller_id, even before being assigned to a site
  // This allows showing online/offline status for ALL controllers in the master list
  let initialHeartbeats: Record<string, string> = {};
  try {
    const { data: heartbeatData } = await supabase
      .from("controller_heartbeats")
      .select("controller_id, timestamp")
      .not("controller_id", "is", null)
      .order("timestamp", { ascending: false })
      .limit(500);

    if (heartbeatData) {
      // Build a map of controller_id -> latest heartbeat timestamp
      // Since results are ordered by timestamp DESC, the first occurrence for each controller is the latest
      const heartbeatMap = new Map<string, string>();

      for (const hb of heartbeatData) {
        // Only store the first (most recent) heartbeat for each controller
        if (hb.controller_id && !heartbeatMap.has(hb.controller_id)) {
          heartbeatMap.set(hb.controller_id, hb.timestamp);
        }
      }

      // Update controllers with their latest heartbeat
      controllers = controllers.map((c) => ({
        ...c,
        last_heartbeat: heartbeatMap.get(c.id) || null,
      }));

      // Store heartbeat map for passing to client component
      initialHeartbeats = Object.fromEntries(heartbeatMap);
    }
  } catch {
    // Heartbeat tables might not exist yet
  }

  // Fetch hardware types for the create form
  let hardwareTypes: Array<{
    id: string;
    name: string;
    hardware_type: string;
  }> = [];

  try {
    const { data } = await supabase
      .from("approved_hardware")
      .select("id, name, hardware_type")
      .eq("is_active", true)
      .order("name");

    if (data) {
      hardwareTypes = data;
    }
  } catch {
    // Table might not exist yet
  }

  // Count by status
  const draftCount = controllers.filter((c) => c.status === "draft").length;
  const readyCount = controllers.filter((c) => c.status === "ready").length;
  const claimedCount = controllers.filter((c) => c.status === "claimed").length;
  const deployedCount = controllers.filter((c) => c.status === "deployed").length;
  const eolCount = controllers.filter((c) => c.status === "eol").length;

  return (
    <DashboardLayout user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}>
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-bold">Controller Master List</h1>
              <Badge variant="secondary">Admin</Badge>
            </div>
            <p className="text-muted-foreground text-sm md:text-base">
              Manage all controller hardware units
            </p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total</CardDescription>
              <CardTitle className="text-3xl">{controllers.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Draft</CardDescription>
              <CardTitle className="text-3xl text-gray-500">{draftCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Ready</CardDescription>
              <CardTitle className="text-3xl text-yellow-600">{readyCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Claimed</CardDescription>
              <CardTitle className="text-3xl text-blue-600">{claimedCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Deployed</CardDescription>
              <CardTitle className="text-3xl text-green-600">{deployedCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>End of Life</CardDescription>
              <CardTitle className="text-3xl text-red-600">{eolCount}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Controllers List */}
        <ControllersList controllers={controllers} hardwareTypes={hardwareTypes} initialHeartbeats={initialHeartbeats} />
      </div>
    </DashboardLayout>
  );
}
