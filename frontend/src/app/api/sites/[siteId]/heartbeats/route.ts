/**
 * API Route: Historical Heartbeats
 *
 * Returns historical heartbeat data for a site's controller.
 * Used by the PowerFlowChart component for:
 * - Connection Status view: Derive online/offline status from heartbeat gaps
 * - System Health view: Display CPU, memory, disk, and temperature metrics
 *
 * GET /api/sites/[siteId]/heartbeats?hours=24
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Heartbeat data point for the chart
interface HeartbeatDataPoint {
  timestamp: string;
  cpu_usage_pct: number;
  memory_usage_pct: number;
  disk_usage_pct: number;
  metadata: {
    cpu_temp_celsius?: number;
  } | null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await params;
    const supabase = await createClient();

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const hours = parseInt(searchParams.get("hours") || "24", 10);

    // Validate hours parameter (max 7 days = 168 hours)
    const clampedHours = Math.min(Math.max(1, hours), 168);

    // Step 1: Get the site's controller (master device)
    const { data: masterDevice, error: masterError } = await supabase
      .from("site_master_devices")
      .select(`
        id,
        controller_id
      `)
      .eq("site_id", siteId)
      .eq("device_type", "controller")
      .maybeSingle();

    if (masterError) {
      console.error("Failed to fetch master device:", masterError);
      return NextResponse.json({ error: "Failed to fetch controller" }, { status: 500 });
    }

    // No controller assigned to this site
    if (!masterDevice || !masterDevice.controller_id) {
      return NextResponse.json({
        data: [],
        metadata: {
          message: "No controller assigned to this site",
          totalPoints: 0,
        },
      });
    }

    const controllerId = masterDevice.controller_id;

    // Step 2: Calculate time range
    const startTime = new Date();
    startTime.setHours(startTime.getHours() - clampedHours);

    // Step 3: Fetch heartbeats for the time range
    // Heartbeats are typically every 30 seconds, so:
    // - 1 hour = ~120 points
    // - 6 hours = ~720 points
    // - 24 hours = ~2880 points
    // - 7 days = ~20160 points
    // Scale the limit based on requested hours to ensure we get enough data
    // Formula: hours * 150 (allows for ~2.5 heartbeats/min with some buffer)
    // Cap at 25000 to prevent excessive data transfer
    const dataLimit = Math.min(clampedHours * 150, 25000);

    // We fetch in descending order (newest first) to get the most recent data,
    // then reverse on the client side.
    const { data: heartbeats, error: heartbeatError } = await supabase
      .from("controller_heartbeats")
      .select("timestamp, cpu_usage_pct, memory_usage_pct, disk_usage_pct, metadata")
      .eq("controller_id", controllerId)
      .gte("timestamp", startTime.toISOString())
      .order("timestamp", { ascending: false })
      .limit(dataLimit);

    if (heartbeatError) {
      console.error("Failed to fetch heartbeats:", heartbeatError);
      return NextResponse.json({ error: "Failed to fetch heartbeats" }, { status: 500 });
    }

    // Step 4: Transform data for the chart
    const dataPoints: HeartbeatDataPoint[] = (heartbeats || []).map((hb) => ({
      timestamp: hb.timestamp,
      cpu_usage_pct: hb.cpu_usage_pct ?? 0,
      memory_usage_pct: hb.memory_usage_pct ?? 0,
      disk_usage_pct: hb.disk_usage_pct ?? 0,
      metadata: hb.metadata as { cpu_temp_celsius?: number } | null,
    }));

    return NextResponse.json({
      data: dataPoints,
      metadata: {
        controllerId,
        totalPoints: dataPoints.length,
        hours: clampedHours,
        startTime: startTime.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error in heartbeats API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
