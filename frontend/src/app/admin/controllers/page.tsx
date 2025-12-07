/**
 * Controller Master List Page
 *
 * Admin page for managing all controller hardware.
 * Only accessible to super_admin and backend_admin users.
 *
 * Features:
 * - List all controllers (draft, ready, deployed)
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
  let userRole: string | null = null;
  if (user?.id) {
    const { data: userData } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    userRole = userData?.role || null;
  }

  // Redirect if not authorized
  if (userRole !== "super_admin" && userRole !== "backend_admin") {
    redirect("/");
  }

  // Fetch controllers with hardware type info
  let controllers: Array<{
    id: string;
    serial_number: string;
    status: string;
    firmware_version: string | null;
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
  }> = [];

  try {
    const { data, error } = await supabase
      .from("controllers")
      .select(`
        id,
        serial_number,
        status,
        firmware_version,
        passcode,
        enterprise_id,
        created_at,
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
      })) as typeof controllers;
    }
  } catch {
    // Tables might not exist yet
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
  const deployedCount = controllers.filter((c) => c.status === "deployed").length;

  return (
    <DashboardLayout user={{ email: user?.email }}>
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
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Controllers</CardDescription>
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
              <CardDescription>Deployed</CardDescription>
              <CardTitle className="text-3xl text-green-600">{deployedCount}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Controllers List */}
        <ControllersList controllers={controllers} hardwareTypes={hardwareTypes} />
      </div>
    </DashboardLayout>
  );
}
