/**
 * Controller Setup Wizard Page
 *
 * Multi-step wizard for registering and configuring new controllers.
 * Guides admins from fresh hardware through full setup, testing, and deployment readiness.
 *
 * URL: /admin/controllers/wizard
 * URL with existing controller: /admin/controllers/wizard?id=<controller-id>
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { redirect } from "next/navigation";
import { ControllerWizard } from "./controller-wizard";

interface PageProps {
  searchParams: Promise<{ id?: string }>;
}

export default async function ControllerWizardPage({ searchParams }: PageProps) {
  const params = await searchParams;
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

    if (error) {
      console.error("Failed to fetch user role:", error);
      redirect("/");
    }
    userProfile = userData;
  }
  const userRole = userProfile?.role;

  // Redirect if not authorized
  if (!userRole || (userRole !== "super_admin" && userRole !== "backend_admin")) {
    redirect("/");
  }

  // Fetch hardware types for the form
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

  // If an ID is provided, fetch the existing controller (for resuming wizard)
  let existingController: {
    id: string;
    serial_number: string;
    hardware_type_id: string;
    firmware_version: string | null;
    notes: string | null;
    wizard_step: number | null;
    status: string;
  } | null = null;

  if (params.id) {
    const { data } = await supabase
      .from("controllers")
      .select("id, serial_number, hardware_type_id, firmware_version, notes, wizard_step, status")
      .eq("id", params.id)
      .single();

    if (data) {
      existingController = data;
    }
  }

  return (
    <DashboardLayout
      user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}
    >
      <div className="p-4 md:p-6">
        <ControllerWizard
          hardwareTypes={hardwareTypes}
          existingController={existingController}
        />
      </div>
    </DashboardLayout>
  );
}
