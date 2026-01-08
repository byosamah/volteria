/**
 * API Route: Project Status
 *
 * Returns aggregated connection status for all sites in a project.
 * Uses the same 1-minute heartbeat threshold as the site status endpoint.
 *
 * GET /api/projects/[projectId]/status
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Response interface for aggregated project status
interface ProjectStatusResponse {
  online: number;   // Count of sites with online connection
  offline: number;  // Count of sites with offline connection
  total: number;    // Total number of sites
}

// 1-minute threshold for online detection
// Note: Controllers send heartbeats every 30 seconds
const ONLINE_THRESHOLD_MS = 60 * 1000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const supabase = await createClient();

    // Step 1: Get all active sites for this project
    // Note: Must filter by is_active to match projects/page.tsx site count
    const { data: sites, error: sitesError } = await supabase
      .from("sites")
      .select("id")
      .eq("project_id", projectId)
      .eq("is_active", true);

    if (sitesError) {
      return NextResponse.json(
        { error: "Failed to fetch sites" },
        { status: 500 }
      );
    }

    // If no sites, return zeros
    if (!sites || sites.length === 0) {
      return NextResponse.json({
        online: 0,
        offline: 0,
        total: 0,
      });
    }

    const siteIds = sites.map((s) => s.id);

    // Step 2: Get all master devices for these sites
    // Note: Only select fields that exist - gateways table may not be implemented
    const { data: masterDevices, error: masterError } = await supabase
      .from("site_master_devices")
      .select(`
        id,
        site_id,
        device_type,
        controller_id
      `)
      .in("site_id", siteIds);

    if (masterError) {
      console.error("Master devices query error:", masterError);
      return NextResponse.json(
        { error: "Failed to fetch master devices" },
        { status: 500 }
      );
    }

    // Step 3: Get controller IDs that need heartbeat checks
    const controllerIds = masterDevices
      ?.filter((d) => d.device_type === "controller" && d.controller_id)
      .map((d) => d.controller_id) || [];

    // Step 4: Get latest heartbeats for all controllers in one query
    let heartbeatMap: Record<string, Date> = {};

    if (controllerIds.length > 0) {
      // Get the latest heartbeat for each controller
      // Using a subquery pattern to get latest per controller
      const { data: heartbeats, error: heartbeatError } = await supabase
        .from("controller_heartbeats")
        .select("controller_id, timestamp")
        .in("controller_id", controllerIds)
        .order("timestamp", { ascending: false });

      if (!heartbeatError && heartbeats) {
        // Build a map of controller_id -> latest timestamp
        // Only keep the first (latest) entry for each controller
        heartbeatMap = heartbeats.reduce((acc, hb) => {
          if (!acc[hb.controller_id]) {
            acc[hb.controller_id] = new Date(hb.timestamp);
          }
          return acc;
        }, {} as Record<string, Date>);
      }
    }

    // Step 5: Calculate status for each site
    let onlineCount = 0;
    let offlineCount = 0;

    // Create a map of site_id -> master device for quick lookup
    const masterDeviceMap = new Map(
      masterDevices?.map((d) => [d.site_id, d]) || []
    );

    const now = Date.now();

    for (const site of sites) {
      const masterDevice = masterDeviceMap.get(site.id);

      if (!masterDevice) {
        // Site has no master device - count as offline
        offlineCount++;
        continue;
      }

      if (masterDevice.device_type === "controller" && masterDevice.controller_id) {
        // Check heartbeat for controller
        const lastHeartbeat = heartbeatMap[masterDevice.controller_id];
        if (lastHeartbeat) {
          const isOnline = now - lastHeartbeat.getTime() < ONLINE_THRESHOLD_MS;
          if (isOnline) {
            onlineCount++;
          } else {
            offlineCount++;
          }
        } else {
          // No heartbeat ever - offline
          offlineCount++;
        }
      } else {
        // Gateway or unknown device type - count as offline for now
        // Gateway support can be added when gateways table is implemented
        offlineCount++;
      }
    }

    const response: ProjectStatusResponse = {
      online: onlineCount,
      offline: offlineCount,
      total: sites.length,
    };

    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
