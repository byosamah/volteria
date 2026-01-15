/**
 * Site Detail Page
 *
 * Shows site details with:
 * - Live power data
 * - Device list
 * - Control settings
 * - Recent logs
 *
 * Sites are physical locations with one controller each.
 * Projects group multiple sites together.
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ControlLogsViewer } from "@/components/logs/control-logs-viewer";
import { ControlLogsTabTrigger } from "@/components/logs/control-logs-tab-trigger";
import { AlarmsViewer } from "@/components/alarms/alarms-viewer";
import { DeviceList } from "@/components/devices/device-list";
import { MasterDeviceList } from "@/components/devices/master-device-list";
import { SiteStatusHeader } from "@/components/sites/site-status-header";
import { SafeModeStatus } from "@/components/sites/safe-mode-status";
import { DeviceHealthCard } from "@/components/sites/device-health-card";
import { ControllerHealthCard } from "@/components/sites/controller-health-card";
import { SiteTestButton } from "@/components/sites/site-test-button";
import { TemplateSyncStatus } from "@/components/sites/template-sync-status";
import type { ModbusRegister } from "@/components/devices/register-form";
import Link from "next/link";
import { notFound } from "next/navigation";
import dynamic from "next/dynamic";

// Dynamic import for heavy chart component (recharts ~200KB)
// This reduces initial bundle size and improves page load time
// Note: The PowerFlowChart is a Client Component ("use client"), so Next.js
// automatically handles SSR/CSR boundaries - no ssr:false needed
const PowerFlowChart = dynamic(
  () => import("@/components/charts/power-flow-chart").then((mod) => mod.PowerFlowChart),
  {
    loading: () => (
      <Card>
        <CardHeader>
          <CardTitle>Connection Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 animate-pulse bg-muted rounded-lg flex items-center justify-center">
            <span className="text-sm text-muted-foreground">Loading chart...</span>
          </div>
        </CardContent>
      </Card>
    ),
  }
);

// Minimum firmware version required for full functionality
const MINIMUM_FIRMWARE_VERSION = "1.0.0";

// Helper to compare semantic versions (e.g., "1.2.3" vs "1.0.0")
function isVersionOutdated(current: string | null, minimum: string): boolean {
  if (!current) return false; // Don't warn if no version set yet

  const currentParts = current.split(".").map(Number);
  const minimumParts = minimum.split(".").map(Number);

  for (let i = 0; i < Math.max(currentParts.length, minimumParts.length); i++) {
    const curr = currentParts[i] || 0;
    const min = minimumParts[i] || 0;
    if (curr < min) return true;
    if (curr > min) return false;
  }
  return false; // Equal versions
}

// Helper to format operation mode for display
// Converts database values like "zero_dg_reverse" to readable text
function formatOperationMode(mode: string | null): string {
  switch (mode) {
    case "zero_dg_reverse":
      return "Zero Generator Feed";
    case "peak_shaving":
      return "Peak Shaving";
    case "manual":
      return "Manual Control";
    default:
      return mode || "Not set";
  }
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

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string; siteId: string }>;
}) {
  const { id: projectId, siteId } = await params;
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

  // Fetch site details from sites table
  const { data: site, error } = await supabase
    .from("sites")
    .select("*")
    .eq("id", siteId)
    .single();

  if (error || !site) {
    notFound();
  }

  // Fetch project name for breadcrumb
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();

  // Fetch site devices (using site_id)
  // Include registers and logging_interval_ms for device-level editing
  let devices: Array<{
    id: string;
    name: string;
    device_type: string | null;  // What the device measures for control logic
    protocol: string;
    slave_id: number;
    ip_address: string | null;
    port: number | null;
    gateway_ip: string | null;
    gateway_port: number | null;
    serial_port: string | null;  // RTU Direct fields
    baudrate: number | null;
    is_online: boolean;
    last_seen: string | null;
    registers: ModbusRegister[] | null;
    visualization_registers: ModbusRegister[] | null;
    alarm_registers: ModbusRegister[] | null;
    calculated_fields: Array<{ field_id: string; name: string; storage_mode: "log" | "viz_only" }> | null;
    template_id: string | null;
    template_synced_at: string | null;
    logging_interval_ms: number | null;
    device_templates: {
      name: string;
      device_type: string;
      brand: string;
      model: string;
    } | null;
  }> = [];

  try {
    const { data } = await supabase
      .from("site_devices")
      .select(`
        id,
        name,
        device_type,
        protocol,
        slave_id,
        ip_address,
        port,
        gateway_ip,
        gateway_port,
        serial_port,
        baudrate,
        is_online,
        last_seen,
        registers,
        visualization_registers,
        alarm_registers,
        calculated_fields,
        template_id,
        template_synced_at,
        logging_interval_ms,
        device_templates (
          name,
          device_type,
          brand,
          model
        )
      `)
      .eq("site_id", siteId)
      .eq("enabled", true)
      .order("name");

    if (data) {
      devices = data as unknown as typeof devices;
    }
  } catch {
    // Ignore errors
  }

  // Fetch latest control log (using site_id)
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
      .eq("site_id", siteId)
      .order("timestamp", { ascending: false })
      .limit(1)
      .single();

    if (data) {
      latestLog = data;
    }
  } catch {
    // No logs yet
  }

  // Fetch master devices (controllers and gateways)
  let masterDevices: {
    id: string;
    site_id: string;
    device_type: "controller" | "gateway";
    name: string;
    ip_address: string | null;
    port: number | null;
    controller_id: string | null;
    controller_template_id: string | null;
    controllers: {
      serial_number: string;
      firmware_version: string | null;
      approved_hardware: {
        name: string;
        manufacturer: string;
      } | null;
    } | null;
    modbus_physical: string | null;
    modbus_baud_rate: number | null;
    modbus_parity: string | null;
    modbus_stop_bits: number | null;
    modbus_frame_type: string | null;
    modbus_extra_delay: number | null;
    modbus_slave_timeout: number | null;
    modbus_write_function: string | null;
    calculated_fields: { field_id: string; enabled: boolean; storage_mode: string }[] | null;
    gateway_type: "netbiter" | "other" | null;
    netbiter_account_id: string | null;
    netbiter_username: string | null;
    netbiter_system_id: string | null;
    gateway_api_url: string | null;
    is_online: boolean;
    last_seen: string | null;
    last_error: string | null;
  }[] = [];

  try {
    const { data } = await supabase
      .from("site_master_devices")
      .select(`
        id,
        site_id,
        device_type,
        name,
        ip_address,
        port,
        controller_id,
        controller_template_id,
        controllers (
          serial_number,
          firmware_version,
          approved_hardware (
            name,
            manufacturer
          )
        ),
        modbus_physical,
        modbus_baud_rate,
        modbus_parity,
        modbus_stop_bits,
        modbus_frame_type,
        modbus_extra_delay,
        modbus_slave_timeout,
        modbus_write_function,
        calculated_fields,
        gateway_type,
        netbiter_account_id,
        netbiter_username,
        netbiter_system_id,
        gateway_api_url,
        is_online,
        last_seen,
        last_error
      `)
      .eq("site_id", siteId)
      .eq("is_active", true)
      .order("device_type")
      .order("name");

    if (data) {
      masterDevices = data as unknown as typeof masterDevices;
    }
  } catch {
    // Table may not exist yet
  }

  // Calculate totals
  const totalCapacity = 500; // TODO: Get from devices
  const loadKw = latestLog?.total_load_kw || 0;
  const solarKw = latestLog?.solar_output_kw || 0;
  const dgKw = latestLog?.dg_power_kw || 0;

  // Calculate device health stats
  const totalDevices = devices.length;
  const onlineDevices = devices.filter((d) => d.is_online).length;
  const offlineDevices = totalDevices - onlineDevices;

  // Check if site has a controller (for showing controller health card)
  const hasController = masterDevices.some((d) => d.device_type === "controller");

  return (
    <DashboardLayout user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}>
      {/* MOBILE-FRIENDLY: Responsive padding */}
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header - stacks on mobile */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Back button - goes to project */}
              <Link
                href={`/projects/${projectId}`}
                className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </Link>
              <h1 className="text-2xl md:text-3xl font-bold">{site.name}</h1>
              {/* Site Status Header - unified connection, control logic, and sync status */}
              <SiteStatusHeader siteId={siteId} controlMethod={site.control_method} />
            </div>
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link href="/projects" className="hover:text-foreground">Projects</Link>
              <span>/</span>
              <Link href={`/projects/${projectId}`} className="hover:text-foreground">
                {project?.name || "Project"}
              </Link>
              <span>/</span>
              <span>{site.name}</span>
            </div>
            <p className="text-muted-foreground text-sm md:text-base">
              {site.location || "No location set"}
            </p>
          </div>
          {/* Action buttons: Dashboard, Run Test, Remote Control, and Settings */}
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Dashboard button - opens interactive site dashboard builder */}
            <Button variant="outline" asChild className="w-full sm:w-auto min-h-[44px]">
              <Link href={`/projects/${projectId}/sites/${siteId}/dashboard`}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-2">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
                Dashboard
              </Link>
            </Button>
            {/* Run Test button - quick diagnostic test */}
            <SiteTestButton siteId={siteId} siteName={site.name} />
            {/* Remote Control button - for users with control permission */}
            <Button variant="default" asChild className="w-full sm:w-auto min-h-[44px]">
              <Link href={`/projects/${projectId}/sites/${siteId}/control`}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="12" x2="15" y2="15" />
                </svg>
                Remote Control
              </Link>
            </Button>
            {/* Settings button */}
            <Button variant="outline" asChild className="w-full sm:w-auto min-h-[44px]">
              <Link href={`/projects/${projectId}/sites/${siteId}/settings`}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-2">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Site Settings
              </Link>
            </Button>
          </div>
        </div>

        {/* Firmware Warning Banner - shows if controller firmware is outdated */}
        {isVersionOutdated(site.controller_firmware_version, MINIMUM_FIRMWARE_VERSION) && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-900 dark:bg-orange-950">
            <div className="flex items-start gap-3">
              {/* Warning icon */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5 flex-shrink-0"
              >
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              <div className="flex-1">
                <h4 className="font-semibold text-orange-800 dark:text-orange-200">
                  Outdated Controller Firmware
                </h4>
                <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                  This controller is running firmware v{site.controller_firmware_version},
                  which is below the recommended version {MINIMUM_FIRMWARE_VERSION}.
                  Some features may not work correctly. Please update the controller firmware.
                </p>
              </div>
            </div>
          </div>
        )}

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
              <CardDescription>Generator Power</CardDescription>
              {/* Generator Power color coding */}
              <CardTitle className={`text-3xl ${
                dgKw < 0
                  ? "text-red-600"
                  : dgKw < site.dg_reserve_kw
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
                color={dgKw < 0 ? "bg-red-500" : dgKw < site.dg_reserve_kw ? "bg-orange-500" : "bg-slate-500"}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Generator Reserve</CardDescription>
              <CardTitle className="text-3xl">
                {site.dg_reserve_kw} <span className="text-lg font-normal">kW</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {latestLog?.safe_mode_active ? (
                  <Badge variant="destructive">Safe Mode Active</Badge>
                ) : (
                  // Show the actual operation mode instead of "Normal Operation"
                  <Badge variant="outline">{formatOperationMode(site.operation_mode)}</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Connection Status & System Charts - Historical Data Visualization */}
        <PowerFlowChart projectId={projectId} siteId={siteId} />

        {/* Status Cards Row - Safe Mode, Device Health, and Controller Health */}
        <div className={`grid gap-4 md:grid-cols-2 ${hasController ? "lg:grid-cols-3" : ""}`}>
          {/* Safe Mode Status Panel */}
          <SafeModeStatus
            isActive={latestLog?.safe_mode_active || false}
            safeModeEnabled={site.safe_mode_enabled || false}
            safeModeType={site.safe_mode_type}
            safeModeTimeout={site.safe_mode_timeout_s}
            safeModeThreshold={site.safe_mode_threshold_kw}
            safeModePowerLimit={site.safe_mode_power_limit_pct}
          />

          {/* Device Health Summary */}
          <DeviceHealthCard
            totalDevices={totalDevices}
            onlineDevices={onlineDevices}
            offlineDevices={offlineDevices}
          />

          {/* Controller Health - Only shown when site has a controller */}
          {hasController && <ControllerHealthCard siteId={siteId} />}
        </div>

        {/* Site Configuration Sync Status */}
        <TemplateSyncStatus siteId={siteId} />

        {/* Tabs */}
        <Tabs defaultValue="devices" className="space-y-4">
          <TabsList>
            <TabsTrigger value="devices">Devices</TabsTrigger>
            <ControlLogsTabTrigger value="logs" siteId={siteId} />
            <TabsTrigger value="alarms">Alarms</TabsTrigger>
          </TabsList>

          <TabsContent value="devices" className="space-y-4">
            {/* Master Devices (Controllers and Gateways) */}
            <MasterDeviceList
              projectId={projectId}
              siteId={siteId}
              masterDevices={masterDevices}
              userRole={userProfile?.role || undefined}
            />

            {/* Regular Devices (Load Meters, Inverters, Generator Controllers) */}
            <DeviceList
              projectId={projectId}
              siteId={siteId}
              devices={devices}
              latestReadings={latestLog ? {
                total_load_kw: latestLog.total_load_kw,
                solar_output_kw: latestLog.solar_output_kw,
                solar_limit_pct: latestLog.solar_limit_pct,
                dg_power_kw: latestLog.dg_power_kw,
                timestamp: latestLog.timestamp,
              } : null}
              userRole={userProfile?.role || undefined}
            />
          </TabsContent>

          <TabsContent value="logs">
            {/* Pass siteId for site-specific logs */}
            <ControlLogsViewer projectId={projectId} siteId={siteId} />
          </TabsContent>

          <TabsContent value="alarms">
            {/* Pass siteId for site-specific alarms */}
            <AlarmsViewer projectId={projectId} siteId={siteId} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
