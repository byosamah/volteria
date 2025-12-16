/**
 * Controller Templates Page
 *
 * Admin page for managing controller templates (Raspberry Pi, gateways).
 * Only accessible to super_admin users.
 *
 * Features:
 * - List all controller templates
 * - Create new templates with registers and alarm definitions
 * - Edit existing templates
 * - Manage alarm thresholds
 * - Link calculated fields
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import { ControllerTemplatesList } from "./controller-templates-list";
import type { ControllerTemplate } from "@/lib/types";

export default async function ControllerTemplatesPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Check user role - only super_admin can access controller templates management
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

  // Redirect if not authorized (requires super_admin only)
  if (!userRole || userRole !== "super_admin") {
    redirect("/");
  }

  // Fetch controller templates
  let controllerTemplates: ControllerTemplate[] = [];
  try {
    const { data, error } = await supabase
      .from("controller_templates")
      .select("*")
      .order("name");

    if (!error && data) {
      controllerTemplates = data as ControllerTemplate[];
    }
  } catch {
    // Table might not exist yet - migrations need to run
  }

  // Fetch calculated field definitions for selection
  let calculatedFields: Array<{ field_id: string; name: string; scope: string }> = [];
  try {
    const { data, error } = await supabase
      .from("calculated_field_definitions")
      .select("field_id, name, scope")
      .eq("is_active", true)
      .order("name");

    if (!error && data) {
      calculatedFields = data;
    }
  } catch {
    // Table might not exist yet
  }

  // Fetch approved hardware for linking
  let approvedHardware: Array<{ id: string; name: string; hardware_type: string }> = [];
  try {
    const { data, error } = await supabase
      .from("approved_hardware")
      .select("id, name, hardware_type")
      .eq("is_active", true)
      .order("name");

    if (!error && data) {
      approvedHardware = data;
    }
  } catch {
    // Table might not exist yet
  }

  // Count stats
  const totalTemplates = controllerTemplates.length;
  const activeTemplates = controllerTemplates.filter((t) => t.is_active).length;
  const masterTemplates = controllerTemplates.filter((t) => t.template_type === "master").length;
  const totalAlarmDefinitions = controllerTemplates.reduce(
    (sum, t) => sum + (t.alarm_definitions?.length || 0),
    0
  );

  return (
    <DashboardLayout
      user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}
    >
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-bold">Controller Templates</h1>
              <Badge variant="secondary">Super Admin</Badge>
            </div>
            <p className="text-muted-foreground text-sm md:text-base">
              Manage templates for controllers and gateways with alarm definitions
            </p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Templates</CardDescription>
              <CardTitle className="text-3xl">{totalTemplates}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Active Templates</CardDescription>
              <CardTitle className="text-3xl text-green-600">{activeTemplates}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Master Templates</CardDescription>
              <CardTitle className="text-3xl text-blue-600">{masterTemplates}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Alarm Definitions</CardDescription>
              <CardTitle className="text-3xl text-amber-600">{totalAlarmDefinitions}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Controller Templates List */}
        <ControllerTemplatesList
          templates={controllerTemplates}
          calculatedFields={calculatedFields}
          approvedHardware={approvedHardware}
        />
      </div>
    </DashboardLayout>
  );
}
