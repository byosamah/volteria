/**
 * Approved Hardware Page
 *
 * Admin page for managing approved hardware types.
 * Only accessible to super_admin and backend_admin users.
 *
 * Features:
 * - List all approved hardware types
 * - Add new hardware types
 * - Edit hardware features
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import { HardwareList } from "./hardware-list";

export default async function HardwarePage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Check user role - only super_admin and backend_admin can access
  let userProfile: { role: string | null; full_name: string | null; avatar_url: string | null } | null = null;
  if (user?.id) {
    const { data: userData } = await supabase
      .from("users")
      .select("role, full_name, avatar_url")
      .eq("id", user.id)
      .single();
    userProfile = userData;
  }
  const userRole = userProfile?.role || null;

  // Redirect if not authorized
  if (userRole !== "super_admin" && userRole !== "backend_admin") {
    redirect("/");
  }

  // Fetch hardware types
  let hardwareTypes: Array<{
    id: string;
    hardware_type: string;
    name: string;
    manufacturer: string | null;
    description: string | null;
    features: Record<string, unknown>;
    min_firmware_version: string | null;
    is_active: boolean;
    created_at: string;
  }> = [];

  try {
    const { data, error } = await supabase
      .from("approved_hardware")
      .select("*")
      .order("name");

    if (!error && data) {
      hardwareTypes = data;
    }
  } catch {
    // Table might not exist yet
  }

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
              <h1 className="text-2xl md:text-3xl font-bold">Approved Hardware</h1>
              <Badge variant="secondary">Admin</Badge>
            </div>
            <p className="text-muted-foreground text-sm md:text-base">
              Manage approved controller hardware types
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Hardware Types</CardDescription>
              <CardTitle className="text-3xl">{hardwareTypes.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Active Types</CardDescription>
              <CardTitle className="text-3xl text-green-600">
                {hardwareTypes.filter((h) => h.is_active).length}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Hardware List */}
        <HardwareList hardwareTypes={hardwareTypes} />
      </div>
    </DashboardLayout>
  );
}
