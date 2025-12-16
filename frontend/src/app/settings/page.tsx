/**
 * System Settings Page
 *
 * Displays enterprise information (read-only):
 * - Enterprise name and ID
 * - Contact information
 * - Address details
 * - Data usage (storage consumption)
 */

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { HardDrive, Database, Bell, Activity, AlertTriangle } from "lucide-react";

// Helper to format bytes to human-readable format
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

export default async function SettingsPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch user profile including enterprise_id
  let userProfile: {
    full_name: string | null;
    avatar_url: string | null;
    role: string | null;
    enterprise_id: string | null;
  } | null = null;

  if (user?.id) {
    const { data } = await supabase
      .from("users")
      .select("full_name, avatar_url, role, enterprise_id")
      .eq("id", user.id)
      .single();
    userProfile = data;
  }

  // Viewers cannot access system settings page
  if (userProfile?.role === "viewer") {
    redirect("/projects");
  }

  // Fetch enterprise information if user belongs to one
  let enterprise: {
    id: string;
    name: string;
    enterprise_id: string;
    contact_email: string | null;
    contact_phone: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    created_at: string;
    is_active: boolean;
    usage_package_id: string | null;
    usage_warning_level: string | null;
    usage_grace_period_start: string | null;
  } | null = null;

  // Usage package and snapshot data
  let usagePackage: {
    id: string;
    name: string;
    storage_limit_bytes: number;
    bandwidth_limit_bytes: number | null;
    max_sites: number | null;
    max_controllers: number | null;
  } | null = null;

  let usageSnapshot: {
    snapshot_date: string;
    total_storage_bytes: number;
    control_logs_bytes: number;
    control_logs_rows: number;
    alarms_bytes: number;
    heartbeats_bytes: number;
    sites_count: number;
    controllers_count: number;
    users_count: number;
  } | null = null;

  if (userProfile?.enterprise_id) {
    // Fetch enterprise with usage package info
    const { data } = await supabase
      .from("enterprises")
      .select("id, name, enterprise_id, contact_email, contact_phone, address, city, country, created_at, is_active, usage_package_id, usage_warning_level, usage_grace_period_start")
      .eq("id", userProfile.enterprise_id)
      .single();
    enterprise = data;

    // Fetch usage package if enterprise has one
    if (enterprise?.usage_package_id) {
      const { data: pkgData } = await supabase
        .from("usage_packages")
        .select("id, name, storage_limit_bytes, bandwidth_limit_bytes, max_sites, max_controllers")
        .eq("id", enterprise.usage_package_id)
        .single();
      usagePackage = pkgData;
    }

    // Fetch latest usage snapshot
    const today = new Date().toISOString().split("T")[0];
    const { data: snapshotData } = await supabase
      .from("enterprise_usage_snapshots")
      .select("snapshot_date, total_storage_bytes, control_logs_bytes, control_logs_rows, alarms_bytes, heartbeats_bytes, sites_count, controllers_count, users_count")
      .eq("enterprise_id", userProfile.enterprise_id)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .single();
    usageSnapshot = snapshotData;
  }

  // Calculate usage percentage
  const usagePercent = usagePackage && usageSnapshot
    ? Math.round((usageSnapshot.total_storage_bytes / usagePackage.storage_limit_bytes) * 1000) / 10
    : 0;

  return (
    <DashboardLayout user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
        enterprise_id: userProfile?.enterprise_id || undefined,
      }}>
      {/* MOBILE-FRIENDLY: Responsive padding with max-width on larger screens */}
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4 md:space-y-6">
        {/* Header - responsive text sizes */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">System Settings</h1>
          <p className="text-muted-foreground text-sm md:text-base">
            General system information
          </p>
        </div>

        {/* Enterprise Information */}
        {enterprise ? (
          <>
            {/* Enterprise Details Card */}
            <Card>
              <CardHeader>
                <CardTitle>Enterprise Information</CardTitle>
                <CardDescription>
                  Your organization details
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Enterprise Name</p>
                    <p className="font-medium">{enterprise.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Enterprise ID</p>
                    <p className="font-mono text-sm">{enterprise.enterprise_id}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    enterprise.is_active
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
                  }`}>
                    {enterprise.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Data Usage Card - Shows storage consumption */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HardDrive className="h-5 w-5" />
                  Data Usage
                </CardTitle>
                <CardDescription>
                  Your organization&apos;s storage consumption
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Package info */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Current Package</p>
                    <p className="font-medium">
                      {usagePackage ? usagePackage.name : "No package assigned"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Storage Limit</p>
                    <p className="font-medium">
                      {usagePackage
                        ? `${bytesToGB(usagePackage.storage_limit_bytes)} GB`
                        : "—"}
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                {usagePackage && usageSnapshot && (
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span>Storage Used</span>
                      <span className={usagePercent >= 80 ? "text-amber-600 font-medium" : ""}>
                        {bytesToGB(usageSnapshot.total_storage_bytes)} GB /{" "}
                        {bytesToGB(usagePackage.storage_limit_bytes)} GB ({usagePercent}%)
                      </span>
                    </div>
                    <Progress
                      value={Math.min(usagePercent, 100)}
                      className={`h-2 ${
                        usagePercent >= 100
                          ? "[&>div]:bg-red-500"
                          : usagePercent >= 80
                          ? "[&>div]:bg-amber-500"
                          : "[&>div]:bg-green-500"
                      }`}
                    />
                  </div>
                )}

                {/* Storage Breakdown */}
                {usageSnapshot && (
                  <div className="grid gap-3 sm:grid-cols-3 pt-2">
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                      <Database className="h-4 w-4 text-blue-500" />
                      <div>
                        <p className="text-xs text-muted-foreground">Control Logs</p>
                        <p className="text-sm font-medium">
                          {formatBytes(usageSnapshot.control_logs_bytes)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                      <Bell className="h-4 w-4 text-amber-500" />
                      <div>
                        <p className="text-xs text-muted-foreground">Alarms</p>
                        <p className="text-sm font-medium">
                          {formatBytes(usageSnapshot.alarms_bytes)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                      <Activity className="h-4 w-4 text-green-500" />
                      <div>
                        <p className="text-xs text-muted-foreground">Heartbeats</p>
                        <p className="text-sm font-medium">
                          {formatBytes(usageSnapshot.heartbeats_bytes)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Warning alert if approaching limit */}
                {usagePercent >= 80 && usagePercent < 100 && (
                  <Alert className="border-amber-200 bg-amber-50">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-amber-800">
                      You&apos;re approaching your storage limit. Consider deleting old data
                      or contact your administrator about upgrading your package.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Critical alert if exceeded */}
                {usagePercent >= 100 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Storage limit exceeded! You have a 30-day grace period.
                      Please delete old data or upgrade your package to avoid data loss.
                      {enterprise.usage_grace_period_start && (
                        <span className="block mt-1 text-sm">
                          Grace period started:{" "}
                          {new Date(enterprise.usage_grace_period_start).toLocaleDateString()}
                        </span>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                {/* No data yet */}
                {!usageSnapshot && (
                  <p className="text-sm text-muted-foreground">
                    No usage data available yet. Data snapshots are calculated daily.
                  </p>
                )}

                {/* Last updated */}
                {usageSnapshot?.snapshot_date && (
                  <p className="text-xs text-muted-foreground pt-2">
                    Last updated: {new Date(usageSnapshot.snapshot_date).toLocaleDateString()}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Contact Information Card */}
            <Card>
              <CardHeader>
                <CardTitle>Contact Information</CardTitle>
                <CardDescription>
                  Enterprise contact details
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Contact Email</p>
                    <p className="font-medium">{enterprise.contact_email || "Not provided"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Contact Phone</p>
                    <p className="font-medium">{enterprise.contact_phone || "Not provided"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Address Card - only show if any address field is provided */}
            {(enterprise.address || enterprise.city || enterprise.country) && (
              <Card>
                <CardHeader>
                  <CardTitle>Address</CardTitle>
                  <CardDescription>
                    Enterprise location
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {enterprise.address && (
                    <div>
                      <p className="text-sm text-muted-foreground">Street Address</p>
                      <p className="font-medium">{enterprise.address}</p>
                    </div>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {enterprise.city && (
                      <div>
                        <p className="text-sm text-muted-foreground">City</p>
                        <p className="font-medium">{enterprise.city}</p>
                      </div>
                    )}
                    {enterprise.country && (
                      <div>
                        <p className="text-sm text-muted-foreground">Country</p>
                        <p className="font-medium">{enterprise.country}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Registration Info */}
            <Card>
              <CardHeader>
                <CardTitle>Registration</CardTitle>
                <CardDescription>
                  Account registration details
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div>
                  <p className="text-sm text-muted-foreground">Registered On</p>
                  <p className="font-medium">
                    {enterprise.created_at
                      ? new Date(enterprise.created_at).toLocaleDateString()
                      : "Unknown"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          /* No Enterprise - Show message */
          <Card>
            <CardHeader>
              <CardTitle>Enterprise Information</CardTitle>
              <CardDescription>
                Organization details
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                No enterprise assigned to your account. Contact your administrator if you believe this is an error.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
