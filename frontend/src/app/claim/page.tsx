/**
 * Controller Claim Page
 *
 * Allows Enterprise Admins to claim controllers using serial number + passcode.
 * Flow:
 * 1. Enter serial number and passcode
 * 2. System validates the passcode matches
 * 3. Controller is assigned to the user's enterprise
 * 4. Controller status changes to "deployed"
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ClaimForm } from "./claim-form";

export default async function ClaimPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get user data including role and enterprise
  const { data: userData } = await supabase
    .from("users")
    .select("role, enterprise_id, full_name, avatar_url")
    .eq("id", user.id)
    .single();

  // Only enterprise_admin can claim controllers
  if (!userData || userData.role !== "enterprise_admin") {
    redirect("/");
  }

  // Must be assigned to an enterprise
  if (!userData.enterprise_id) {
    redirect("/");
  }

  // Get enterprise info
  const { data: enterprise } = await supabase
    .from("enterprises")
    .select("id, name")
    .eq("id", userData.enterprise_id)
    .single();

  return (
    <DashboardLayout user={{
        email: user.email,
        full_name: userData?.full_name || undefined,
        avatar_url: userData?.avatar_url || undefined,
        role: userData?.role || undefined,
      }}>
      <div className="p-4 md:p-6 space-y-6 max-w-2xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Claim Controller</h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Register a new controller for {enterprise?.name || "your enterprise"}
          </p>
        </div>

        {/* Claim Form */}
        <ClaimForm enterpriseId={userData.enterprise_id} userId={user.id} />
      </div>
    </DashboardLayout>
  );
}
