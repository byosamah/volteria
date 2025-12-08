/**
 * Project Detail Page
 *
 * Shows project details with:
 * - Live power data
 * - Device list
 * - Control settings
 * - Recent logs
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ControlLogsViewer } from "@/components/logs/control-logs-viewer";
import { AlarmsViewer } from "@/components/alarms/alarms-viewer";
import { DeviceList } from "@/components/devices/device-list";
import { SyncStatus } from "@/components/projects/sync-status";
import Link from "next/link";
import { notFound } from "next/navigation";

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    online: "default",
    offline: "secondary",
    error: "destructive",
  };

  return (
    <Badge variant={variants[status] || "outline"} className="capitalize">
      {status}
    </Badge>
  );
}

// Power gauge component
function PowerGauge({
  label,
  value,
  max,
  unit = "kW",
  color = "bg-primary",
}: {
  label: string;
  value: number;
  max: number;
  unit?: string;
  color?: string;
}) {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {value.toFixed(1)} {unit}
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch user profile including avatar
  let userProfile: { full_name: string | null; avatar_url: string | null } | null = null;
  if (user?.id) {
    const { data } = await supabase
      .from("users")
      .select("full_name, avatar_url")
      .eq("id", user.id)
      .single();
    userProfile = data;
  }

  // Fetch project details
  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !project) {
    notFound();
  }

  // Fetch project devices
  let devices: Array<{
    id: string;
    name: string;
    protocol: string;
    slave_id: number;
    ip_address: string | null;
    port: number | null;
    gateway_ip: string | null;
    gateway_port: number | null;
    is_online: boolean;
    last_seen: string | null;
    device_templates: {
      name: string;
      device_type: string;
      brand: string;
      model: string;
    } | null;
  }> = [];

  try {
    const { data } = await supabase
      .from("project_devices")
      .select(`
        id,
        name,
        protocol,
        slave_id,
        ip_address,
        port,
        gateway_ip,
        gateway_port,
        is_online,
        last_seen,
        device_templates (
          name,
          device_type,
          brand,
          model
        )
      `)
      .eq("project_id", id)
      .eq("enabled", true)
      .order("name");

    if (data) {
      // Cast data to the expected type (Supabase returns relations as objects for single FK)
      devices = data as unknown as typeof devices;
    }
  } catch {
    // Ignore errors
  }

  // Fetch latest control log
  let latestLog: {
    timestamp: string;
    total_load_kw: number;
    dg_power_kw: number;
    solar_output_kw: number;
    solar_limit_pct: number;
    safe_mode_active: boolean;
  } | null = null;

  try {
    const { data } = await supabase
      .from("control_logs")
      .select("timestamp, total_load_kw, dg_power_kw, solar_output_kw, solar_limit_pct, safe_mode_active")
      .eq("project_id", id)
      .order("timestamp", { ascending: false })
      .limit(1)
      .single();

    if (data) {
      latestLog = data;
    }
  } catch {
    // No logs yet
  }

  // Calculate totals
  const totalCapacity = 500; // TODO: Get from devices
  const loadKw = latestLog?.total_load_kw || 0;
  const solarKw = latestLog?.solar_output_kw || 0;
  const dgKw = latestLog?.dg_power_kw || 0;

  return (
    <DashboardLayout user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
      }}>
      {/* MOBILE-FRIENDLY: Responsive padding */}
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header - stacks on mobile */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Back button - 44px touch target */}
              <Link
                href="/projects"
                className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </Link>
              <h1 className="text-2xl md:text-3xl font-bold">{project.name}</h1>
              <StatusBadge status={project.controller_status} />
              {/* Sync Status - shows whether config matches controller */}
              <SyncStatus
                projectId={project.id}
                controllerStatus={project.controller_status}
                updatedAt={project.updated_at}
                configSyncedAt={project.config_synced_at}
              />
            </div>
            <p className="text-muted-foreground text-sm md:text-base">
              {project.location || "No location set"}
            </p>
          </div>
          {/* Settings button - full width on mobile */}
          <div className="flex gap-2">
            <Button variant="outline" asChild className="w-full sm:w-auto min-h-[44px]">
              <Link href={`/projects/${id}/settings`}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-2">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Site Settings
              </Link>
            </Button>
          </div>
        </div>

        {/* Live Data Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Load</CardDescription>
              <CardTitle className="text-3xl">
                {loadKw.toFixed(1)} <span className="text-lg font-normal">kW</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PowerGauge label="" value={loadKw} max={totalCapacity} color="bg-blue-500" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Solar Output</CardDescription>
              <CardTitle className="text-3xl">
                {solarKw.toFixed(1)} <span className="text-lg font-normal">kW</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted-foreground">Limit</span>
                <span className="font-medium">{latestLog?.solar_limit_pct || 0}%</span>
              </div>
              <PowerGauge label="" value={solarKw} max={150} color="bg-[#6baf4f]" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>DG Power</CardDescription>
              {/* DG Power color coding:
                  - Red if negative (reverse feeding to DG - critical!)
                  - Orange if below DG reserve (warning)
                  - Default otherwise */}
              <CardTitle className={`text-3xl ${
                dgKw < 0
                  ? "text-red-600"
                  : dgKw < project.dg_reserve_kw
                    ? "text-orange-500"
                    : ""
              }`}>
                {dgKw.toFixed(1)} <span className="text-lg font-normal">kW</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PowerGauge
                label=""
                value={Math.abs(dgKw)}
                max={totalCapacity}
                color={dgKw < 0 ? "bg-red-500" : dgKw < project.dg_reserve_kw ? "bg-orange-500" : "bg-slate-500"}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>DG Reserve</CardDescription>
              <CardTitle className="text-3xl">
                {project.dg_reserve_kw} <span className="text-lg font-normal">kW</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {latestLog?.safe_mode_active ? (
                  <Badge variant="destructive">Safe Mode Active</Badge>
                ) : (
                  <Badge variant="outline">Normal Operation</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="devices" className="space-y-4">
          <TabsList>
            <TabsTrigger value="devices">Devices</TabsTrigger>
            <TabsTrigger value="logs">Control Logs</TabsTrigger>
            <TabsTrigger value="alarms">Alarms</TabsTrigger>
          </TabsList>

          <TabsContent value="devices" className="space-y-4">
            <DeviceList projectId={id} devices={devices} />
          </TabsContent>

          <TabsContent value="logs">
            <ControlLogsViewer projectId={id} />
          </TabsContent>

          <TabsContent value="alarms">
            <AlarmsViewer projectId={id} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
