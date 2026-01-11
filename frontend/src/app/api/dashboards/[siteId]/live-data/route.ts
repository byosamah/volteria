/**
 * API Route: Dashboard Live Data
 *
 * GET /api/dashboards/[siteId]/live-data - Get current values for all linked registers
 *
 * Returns the latest register values for all devices linked to widgets,
 * plus device online/offline status.
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await params;
    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get the site to find its project
    const { data: site } = await supabase
      .from("sites")
      .select("id, project_id")
      .eq("id", siteId)
      .single();

    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    // Get dashboard and widgets
    const { data: dashboard } = await supabase
      .from("site_dashboards")
      .select("id")
      .eq("site_id", siteId)
      .single();

    if (!dashboard) {
      return NextResponse.json({
        timestamp: new Date().toISOString(),
        registers: {},
        device_status: {},
        site_aggregates: {}
      });
    }

    // Get all widgets to find linked devices
    const { data: widgets } = await supabase
      .from("dashboard_widgets")
      .select("config")
      .eq("dashboard_id", dashboard.id);

    // Extract unique device IDs from widget configs
    const deviceIds = new Set<string>();
    widgets?.forEach((w) => {
      const config = w.config as Record<string, unknown>;
      if (config.device_id) deviceIds.add(config.device_id as string);
      if (config.linked_device_id) deviceIds.add(config.linked_device_id as string);
    });

    // Get device status
    const { data: devices } = await supabase
      .from("site_devices")
      .select("id, name, device_type, is_online, last_seen")
      .eq("site_id", siteId);

    // Build device status map
    const deviceStatus: Record<string, { is_online: boolean; last_seen: string | null; name: string }> = {};
    devices?.forEach((d) => {
      deviceStatus[d.id] = {
        is_online: d.is_online ?? false,
        last_seen: d.last_seen,
        name: d.name
      };
    });

    // Get latest control logs for aggregate site data
    const { data: latestLog } = await supabase
      .from("control_logs")
      .select("*")
      .eq("site_id", siteId)
      .order("timestamp", { ascending: false })
      .limit(1)
      .single();

    // Build site aggregates from control logs
    const siteAggregates: Record<string, { value: number; unit: string; timestamp: string }> = {};
    if (latestLog) {
      if (latestLog.total_load_kw !== null) {
        siteAggregates.total_load_kw = {
          value: latestLog.total_load_kw,
          unit: "kW",
          timestamp: latestLog.timestamp
        };
      }
      if (latestLog.solar_output_kw !== null) {
        siteAggregates.solar_output_kw = {
          value: latestLog.solar_output_kw,
          unit: "kW",
          timestamp: latestLog.timestamp
        };
      }
      if (latestLog.dg_power_kw !== null) {
        siteAggregates.dg_power_kw = {
          value: latestLog.dg_power_kw,
          unit: "kW",
          timestamp: latestLog.timestamp
        };
      }
      if (latestLog.solar_limit_pct !== null) {
        siteAggregates.solar_limit_pct = {
          value: latestLog.solar_limit_pct,
          unit: "%",
          timestamp: latestLog.timestamp
        };
      }
    }

    // Get device readings for specific register values
    // This uses the device_readings table which stores individual register values
    const registers: Record<string, Record<string, { value: number; unit: string; timestamp: string }>> = {};

    if (deviceIds.size > 0) {
      const { data: readings } = await supabase
        .from("device_readings")
        .select("device_id, register_name, value, unit, timestamp")
        .in("device_id", Array.from(deviceIds))
        .order("timestamp", { ascending: false });

      // Group readings by device, keeping only the latest per register
      const latestReadings: Record<string, Record<string, { value: number; unit: string; timestamp: string }>> = {};

      readings?.forEach((r) => {
        if (!latestReadings[r.device_id]) {
          latestReadings[r.device_id] = {};
        }
        // Only keep the first (most recent) reading for each register
        if (!latestReadings[r.device_id][r.register_name]) {
          latestReadings[r.device_id][r.register_name] = {
            value: r.value,
            unit: r.unit || "",
            timestamp: r.timestamp
          };
        }
      });

      Object.assign(registers, latestReadings);
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      registers,
      device_status: deviceStatus,
      site_aggregates: siteAggregates
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
