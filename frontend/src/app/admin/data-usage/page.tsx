/**
 * Data Usage & Storage Analytics Page
 *
 * Admin page for monitoring storage and bandwidth across all enterprises.
 * Only accessible to super_admin and backend_admin users.
 *
 * Features:
 * - System-wide usage summary
 * - Per-enterprise usage with package info
 * - Warning indicators for over-limit enterprises
 * - Historical usage charts
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import { DataUsageList } from "./data-usage-list";

// Helper to convert bytes to human-readable format
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function bytesToGB(bytes: number): number {
  return Math.round((bytes / (1024 ** 3)) * 100) / 100;
}

export default async function DataUsagePage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Check user role - only super_admin and backend_admin can access
  const { data: userData, error } = await supabase
    .from("users")
    .select("role, full_name, avatar_url, enterprise_id")
    .eq("id", user.id)
    .single();

  if (error || !userData) {
    redirect("/");
  }

  const userRole = userData.role;

  // Only allow super_admin and backend_admin
  if (!userRole || !["super_admin", "backend_admin"].includes(userRole)) {
    redirect("/");
  }

  // Fetch enterprises with their package info
  const { data: enterprises } = await supabase
    .from("enterprises")
    .select(`
      id,
      name,
      is_active,
      usage_package_id,
      usage_warning_level,
      usage_grace_period_start
    `)
    .eq("is_active", true)
    .order("name");

  // Fetch all packages
  const { data: packages } = await supabase
    .from("usage_packages")
    .select("*")
    .eq("is_active", true)
    .order("display_order");

  // Create packages lookup map
  const packagesMap = new Map(
    (packages || []).map((p) => [p.id, p])
  );

  // Fetch latest snapshots for today
  const today = new Date().toISOString().split("T")[0];
  const { data: snapshots } = await supabase
    .from("enterprise_usage_snapshots")
    .select("*")
    .eq("snapshot_date", today);

  // Create snapshots lookup map
  const snapshotsMap = new Map(
    (snapshots || []).map((s) => [s.enterprise_id, s])
  );

  // Fetch LIVE resource counts per enterprise (instead of relying on snapshots)
  // This ensures we always show current counts, not stale snapshot data
  const liveResourceCounts = new Map<string, { sites: number; controllers: number; users: number }>();

  // Sites count: sites → projects → enterprise
  const { data: siteCounts } = await supabase
    .from("sites")
    .select("id, project_id, projects!inner(enterprise_id)")
    .eq("is_active", true);

  // Group sites by enterprise_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (siteCounts || []).forEach((site: any) => {
    const enterpriseId = site.projects?.enterprise_id;
    if (enterpriseId) {
      const current = liveResourceCounts.get(enterpriseId) || { sites: 0, controllers: 0, users: 0 };
      current.sites++;
      liveResourceCounts.set(enterpriseId, current);
    }
  });

  // Controllers count by enterprise
  const { data: controllerCounts } = await supabase
    .from("controllers_master")
    .select("enterprise_id")
    .eq("is_active", true);

  (controllerCounts || []).forEach((c) => {
    if (c.enterprise_id) {
      const current = liveResourceCounts.get(c.enterprise_id) || { sites: 0, controllers: 0, users: 0 };
      current.controllers++;
      liveResourceCounts.set(c.enterprise_id, current);
    }
  });

  // Users count by enterprise
  const { data: userCounts } = await supabase
    .from("users")
    .select("enterprise_id")
    .eq("is_active", true);

  (userCounts || []).forEach((u) => {
    if (u.enterprise_id) {
      const current = liveResourceCounts.get(u.enterprise_id) || { sites: 0, controllers: 0, users: 0 };
      current.users++;
      liveResourceCounts.set(u.enterprise_id, current);
    }
  });

  // Build enterprise usage data
  const enterpriseUsage = (enterprises || []).map((enterprise) => {
    const snapshot = snapshotsMap.get(enterprise.id) || {};
    const pkg = enterprise.usage_package_id
      ? packagesMap.get(enterprise.usage_package_id)
      : null;

    const totalBytes = snapshot.total_storage_bytes || 0;
    const limitBytes = pkg?.storage_limit_bytes || null;
    const usagePercent = limitBytes ? (totalBytes / limitBytes) * 100 : 0;

    let warningLevel = "normal";
    if (usagePercent >= 110) warningLevel = "critical";
    else if (usagePercent >= 100) warningLevel = "exceeded";
    else if (usagePercent >= 80) warningLevel = "approaching";

    return {
      enterprise_id: enterprise.id,
      enterprise_name: enterprise.name,
      package_id: enterprise.usage_package_id,
      package_name: pkg?.name || null,
      storage_limit_bytes: limitBytes,
      storage_limit_gb: limitBytes ? bytesToGB(limitBytes) : null,
      total_storage_bytes: totalBytes,
      total_storage_gb: bytesToGB(totalBytes),
      storage_usage_percent: Math.round(usagePercent * 10) / 10,
      control_logs_bytes: snapshot.control_logs_bytes || 0,
      control_logs_rows: snapshot.control_logs_rows || 0,
      alarms_bytes: snapshot.alarms_bytes || 0,
      heartbeats_bytes: snapshot.heartbeats_bytes || 0,
      // Use LIVE counts (always accurate) with fallback to snapshot
      sites_count: liveResourceCounts.get(enterprise.id)?.sites || snapshot.sites_count || 0,
      controllers_count: liveResourceCounts.get(enterprise.id)?.controllers || snapshot.controllers_count || 0,
      users_count: liveResourceCounts.get(enterprise.id)?.users || snapshot.users_count || 0,
      warning_level: warningLevel,
      grace_period_start: enterprise.usage_grace_period_start,
      snapshot_date: snapshot.snapshot_date || null,
    };
  });

  // Calculate summary stats
  const totalStorage = enterpriseUsage.reduce((sum, e) => sum + e.total_storage_bytes, 0);
  const warningCounts = enterpriseUsage.reduce(
    (counts, e) => {
      counts[e.warning_level as keyof typeof counts]++;
      return counts;
    },
    { normal: 0, approaching: 0, exceeded: 0, critical: 0 }
  );

  return (
    <DashboardLayout
      user={{
        email: user?.email,
        full_name: userData?.full_name || undefined,
        avatar_url: userData?.avatar_url || undefined,
        role: userData?.role || undefined,
        enterprise_id: userData?.enterprise_id || undefined,
      }}
    >
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-bold">Data Usage & Storage</h1>
              <Badge variant="secondary">Admin</Badge>
            </div>
            <p className="text-muted-foreground text-sm md:text-base">
              Monitor storage and bandwidth across all enterprises
            </p>
          </div>
        </div>

        {/* Summary Stats Cards */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          {/* Total Storage */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Storage</CardDescription>
              <CardTitle className="text-2xl md:text-3xl">
                {formatBytes(totalStorage)}
              </CardTitle>
            </CardHeader>
          </Card>

          {/* Active Enterprises */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Active Enterprises</CardDescription>
              <CardTitle className="text-2xl md:text-3xl">
                {enterpriseUsage.length}
              </CardTitle>
            </CardHeader>
          </Card>

          {/* Approaching Limit (Warning) */}
          <Card className={warningCounts.approaching > 0 ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30" : ""}>
            <CardHeader className="pb-2">
              <CardDescription>Approaching Limit</CardDescription>
              <CardTitle className={`text-2xl md:text-3xl ${warningCounts.approaching > 0 ? "text-amber-600" : ""}`}>
                {warningCounts.approaching}
              </CardTitle>
            </CardHeader>
          </Card>

          {/* Over Limit (Critical) */}
          <Card className={(warningCounts.exceeded + warningCounts.critical) > 0 ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30" : ""}>
            <CardHeader className="pb-2">
              <CardDescription>Over Limit</CardDescription>
              <CardTitle className={`text-2xl md:text-3xl ${(warningCounts.exceeded + warningCounts.critical) > 0 ? "text-red-600" : ""}`}>
                {warningCounts.exceeded + warningCounts.critical}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Enterprise Usage List */}
        <Card>
          <CardHeader>
            <CardTitle>Enterprise Storage Usage</CardTitle>
            <CardDescription>
              {enterpriseUsage.length} enterprise(s) with usage data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataUsageList
              enterprises={enterpriseUsage}
              packages={packages || []}
            />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
