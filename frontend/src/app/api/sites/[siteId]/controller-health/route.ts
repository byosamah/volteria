/**
 * API Route: Controller Health
 *
 * Returns the latest heartbeat data for a site's controller.
 * Used by the ControllerHealthCard to display live health metrics.
 *
 * GET /api/sites/[siteId]/controller-health
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Define the heartbeat data structure
interface ControllerHealthData {
  controllerId: string;
  serialNumber: string;
  hardwareType: string | null;
  firmwareVersion: string;
  uptimeSeconds: number;
  cpuUsagePct: number;
  memoryUsagePct: number;
  diskUsagePct: number;
  cpuTempCelsius: number | null;
  timestamp: string;
  isOnline: boolean;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await params;
    const supabase = await createClient();

    // Step 1: Get the site's controller (master device)
    // Find the controller assigned to this site
    const { data: masterDevice, error: masterError } = await supabase
      .from("site_master_devices")
      .select(`
        id,
        controller_id,
        is_active,
        controllers (
          id,
          serial_number,
          firmware_version,
          approved_hardware (
            hardware_type
          )
        )
      `)
      .eq("site_id", siteId)
      .eq("device_type", "controller")
      .eq("is_active", true)
      .maybeSingle();

    if (masterError) {
      console.error("Failed to fetch master device:", masterError);
      return NextResponse.json({ error: "Failed to fetch controller" }, { status: 500 });
    }

    // No controller assigned to this site
    if (!masterDevice || !masterDevice.controller_id) {
      return NextResponse.json({ error: "No controller assigned to this site" }, { status: 404 });
    }

    const controllerId = masterDevice.controller_id;
    // Supabase returns nested relations - extract controller data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const controllerData = masterDevice.controllers as any;
    const controller = controllerData ? {
      id: controllerData.id as string,
      serial_number: controllerData.serial_number as string,
      firmware_version: controllerData.firmware_version as string | null,
      // approved_hardware can be an array or single object from Supabase
      hardware_type: Array.isArray(controllerData.approved_hardware)
        ? controllerData.approved_hardware[0]?.hardware_type ?? null
        : controllerData.approved_hardware?.hardware_type ?? null,
    } : null;

    // Step 2: Get the latest heartbeat for this controller
    // RLS policy allows anyone to read heartbeats (not sensitive data)
    const { data: heartbeat, error: heartbeatError } = await supabase
      .from("controller_heartbeats")
      .select("*")
      .eq("controller_id", controllerId)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (heartbeatError) {
      console.error("Failed to fetch heartbeat:", heartbeatError);
      return NextResponse.json({ error: "Failed to fetch heartbeat" }, { status: 500 });
    }

    // No heartbeat data yet
    if (!heartbeat) {
      return NextResponse.json({ error: "No heartbeat data available" }, { status: 404 });
    }

    // Step 3: Determine if online (heartbeat within last 90 seconds)
    // Note: Controllers send heartbeats every 30 seconds
    // Using 90 seconds provides buffer for network latency and clock skew
    const thresholdMs = 90 * 1000;
    const isOnline = Date.now() - new Date(heartbeat.timestamp).getTime() < thresholdMs;

    // Step 4: Extract CPU temperature from metadata if available
    const metadata = heartbeat.metadata as { cpu_temp_celsius?: number } | null;
    const cpuTempCelsius = metadata?.cpu_temp_celsius ?? null;

    // Step 5: Build response
    const healthData: ControllerHealthData = {
      controllerId,
      serialNumber: controller?.serial_number ?? "Unknown",
      hardwareType: controller?.hardware_type ?? null,
      firmwareVersion: heartbeat.firmware_version ?? "1.0.0",
      uptimeSeconds: heartbeat.uptime_seconds ?? 0,
      cpuUsagePct: heartbeat.cpu_usage_pct ?? 0,
      memoryUsagePct: heartbeat.memory_usage_pct ?? 0,
      diskUsagePct: heartbeat.disk_usage_pct ?? 0,
      cpuTempCelsius,
      timestamp: heartbeat.timestamp,
      isOnline,
    };

    return NextResponse.json(healthData);
  } catch (error) {
    console.error("Error in controller health API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
