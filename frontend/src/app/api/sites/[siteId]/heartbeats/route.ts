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
  uptime_seconds: number;
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
    // RLS policy allows anyone to read heartbeats (not sensitive data)
    // Heartbeats are typically every 30 seconds, so:
    // - 1 hour = ~120 points
    // - 6 hours = ~720 points
    // - 24 hours = ~2880 points
    // - 7 days = ~20160 points
    //
    // Supabase has a default 1000-row limit per request. For longer time ranges,
    // we need to use pagination to fetch all data.
    const PAGE_SIZE = 1000;
    const maxPages = Math.ceil((clampedHours * 150) / PAGE_SIZE); // ~2.5 heartbeats/min

    // Fetch heartbeats in pages to bypass Supabase's 1000-row limit
    // We fetch in ascending order (oldest first) and paginate forward
    let allHeartbeats: {
      timestamp: string;
      uptime_seconds: number | null;
      cpu_usage_pct: number | null;
      memory_usage_pct: number | null;
      disk_usage_pct: number | null;
      metadata: unknown;
    }[] = [];

    for (let page = 0; page < maxPages; page++) {
      // Supabase range() is inclusive on both ends in JS client
      // Use a range that will definitely hit the 1000-row server limit
      // This ensures we get exactly 1000 rows per page until the last page
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE; // Request PAGE_SIZE+1 rows, server caps at 1000

      const { data: pageData, error: pageError } = await supabase
        .from("controller_heartbeats")
        .select("timestamp, uptime_seconds, cpu_usage_pct, memory_usage_pct, disk_usage_pct, metadata")
        .eq("controller_id", controllerId)
        .gte("timestamp", startTime.toISOString())
        .order("timestamp", { ascending: true })
        .range(from, to);

      if (pageError) {
        console.error(`Failed to fetch heartbeats page ${page}:`, pageError);
        return NextResponse.json({ error: "Failed to fetch heartbeats" }, { status: 500 });
      }

      if (!pageData || pageData.length === 0) {
        // No more data
        break;
      }

      allHeartbeats = allHeartbeats.concat(pageData);

      // If we got less than 1000 rows, we've reached the end
      // (Supabase caps at 1000 rows per request regardless of range)
      if (pageData.length < PAGE_SIZE) {
        break;
      }
    }

    // Reverse to get newest first (for consistency with previous behavior)
    const heartbeats = allHeartbeats.reverse();

    // Step 4: Transform data for the chart
    const dataPoints: HeartbeatDataPoint[] = (heartbeats || []).map((hb) => ({
      timestamp: hb.timestamp,
      uptime_seconds: hb.uptime_seconds ?? 0,
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
