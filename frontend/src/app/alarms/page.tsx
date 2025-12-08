/**
 * Alarms Page
 *
 * Shows all alarms across projects with:
 * - Filtering by severity and status
 * - Acknowledge functionality
 * - Real-time updates
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlarmsTable } from "./alarms-table";

// Stats card component
function StatCard({
  title,
  value,
  severity,
}: {
  title: string;
  value: number;
  severity: "critical" | "warning" | "info";
}) {
  const colors = {
    critical: "text-red-600",
    warning: "text-yellow-600",
    info: "text-blue-600",
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className={`text-3xl ${colors[severity]}`}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export default async function AlarmsPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch user profile including avatar and role
  let userProfile: { full_name: string | null; avatar_url: string | null; role: string | null } | null = null;
  if (user?.id) {
    const { data } = await supabase
      .from("users")
      .select("full_name, avatar_url, role")
      .eq("id", user.id)
      .single();
    userProfile = data;
  }

  // Fetch alarm counts
  let criticalCount = 0;
  let warningCount = 0;
  let totalUnacknowledged = 0;

  try {
    // Count critical alarms
    const { count: critical } = await supabase
      .from("alarms")
      .select("*", { count: "exact", head: true })
      .eq("acknowledged", false)
      .eq("severity", "critical");
    criticalCount = critical || 0;

    // Count warning alarms
    const { count: warning } = await supabase
      .from("alarms")
      .select("*", { count: "exact", head: true })
      .eq("acknowledged", false)
      .eq("severity", "warning");
    warningCount = warning || 0;

    totalUnacknowledged = criticalCount + warningCount;
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
      {/* MOBILE-FRIENDLY: Responsive padding */}
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header - responsive text sizes */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Alarms</h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Monitor and manage system alerts
          </p>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard title="Critical" value={criticalCount} severity="critical" />
          <StatCard title="Warnings" value={warningCount} severity="warning" />
          <StatCard title="Total Unacknowledged" value={totalUnacknowledged} severity="info" />
        </div>

        {/* Alarms Table */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Alarms</CardTitle>
            <CardDescription>
              Click an alarm to acknowledge it
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlarmsTable />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
