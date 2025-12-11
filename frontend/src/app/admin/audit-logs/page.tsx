/**
 * Audit Logs Dashboard Page
 *
 * ⚠️ PHASE 5 - Enterprise Features
 *
 * Admin-only page showing complete audit trail:
 * - Filter by user, action, resource type, date range
 * - Search functionality
 * - Export capability
 * - Detailed view of each action
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { redirect } from "next/navigation";
import { AuditLogsTable } from "@/components/audit/audit-logs-table";

export default async function AuditLogsPage() {
  const supabase = await createClient();

  // Get authenticated user
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) {
    redirect("/login");
  }

  // Get user profile with role
  const { data: userProfile } = await supabase
    .from("users")
    .select("id, email, full_name, role, avatar_url")
    .eq("id", authUser.id)
    .single();

  if (!userProfile) {
    redirect("/login");
  }

  // Check if user is admin - only admins can view audit logs
  const isAdmin = ["super_admin", "backend_admin", "admin"].includes(userProfile.role || "");
  if (!isAdmin) {
    redirect("/");
  }

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
        {/* Page Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Audit Logs</h1>
          <p className="text-muted-foreground">
            Complete history of all user actions in the system
          </p>
        </div>

        {/* Audit Logs Table with filters */}
        <AuditLogsTable />
      </div>
    </DashboardLayout>
  );
}
