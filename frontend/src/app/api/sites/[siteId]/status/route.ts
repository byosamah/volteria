/**
 * API Route: Site Status
 *
 * Returns unified status for a site's header display:
 * - Connection status (online/offline)
 * - Control logic status (running/stopped/error)
 * - Config sync status (synced/sync_needed/never_synced)
 *
 * GET /api/sites/[siteId]/status
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

// Response interface for the unified site status
interface SiteStatusResponse {
  connection: {
    status: "online" | "offline";
    lastSeen: string | null;
    type: "controller" | "gateway" | "none";
  };
  controlLogic: {
    status: "running" | "stopped" | "error" | "unknown";
    lastError: string | null;
    activeAlarms: number;
  } | null; // null for gateway sites (control logic not applicable)
  configSync: {
    status: "synced" | "sync_needed" | "never_synced";
    lastSyncedAt: string | null;
    cloudChangedAt: string | null; // When config changed on web (config_changed_at)
    localPulledAt: string | null;  // When controller last pulled config
    pendingChanges: {
      devices: number;
      settings: number;
    } | null;
  };
  // Logging status for Control Logs viewer
  logging: {
    hasLogs: boolean;
    lastLogTimestamp: string | null;
    totalLogs: number;
  };
}

// 90-second threshold for online detection
// Note: Controllers send heartbeats every 30 seconds
// Using 90 seconds provides buffer for network latency and clock skew
const ONLINE_THRESHOLD_MS = 90 * 1000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await params;
    const supabase = await createClient();

    // Step 1: Get site data (for config sync timestamps)
    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select(`
        id,
        config_changed_at,
        config_synced_at,
        control_method,
        platform_config_version,
        controller_config_version
      `)
      .eq("id", siteId)
      .single();

    if (siteError || !site) {
      return NextResponse.json(
        { error: "Site not found" },
        { status: 404 }
      );
    }

    // Step 2: Get the site's master device (controller or gateway)
    // Note: Gateways are stored inline in site_master_devices (no separate table)
    const { data: masterDevice, error: masterError } = await supabase
      .from("site_master_devices")
      .select(`
        id,
        device_type,
        controller_id,
        is_online,
        name,
        controllers (
          id,
          serial_number
        )
      `)
      .eq("site_id", siteId)
      .maybeSingle();

    if (masterError) {
      return NextResponse.json(
        { error: "Failed to fetch master device" },
        { status: 500 }
      );
    }

    // Initialize response with defaults
    const response: SiteStatusResponse = {
      connection: {
        status: "offline",
        lastSeen: null,
        type: "none",
      },
      controlLogic: null,
      configSync: {
        status: "never_synced",
        lastSyncedAt: site.config_synced_at,
        cloudChangedAt: (site as Record<string, unknown>)?.config_changed_at as string | null,
        localPulledAt: null, // Will be populated from heartbeat
        pendingChanges: null,
      },
      logging: {
        hasLogs: false,
        lastLogTimestamp: null,
        totalLogs: 0,
      },
    };

    // Step 3: Determine connection status based on device type
    if (masterDevice?.device_type === "controller" && masterDevice.controller_id) {
      response.connection.type = "controller";

      // Get latest heartbeat for the controller
      // RLS policy allows anyone to read heartbeats (not sensitive data)
      const { data: heartbeat, error: heartbeatError } = await supabase
        .from("controller_heartbeats")
        .select("*")
        .eq("controller_id", masterDevice.controller_id)
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!heartbeatError && heartbeat) {
        response.connection.lastSeen = heartbeat.timestamp;

        // Check if online (heartbeat within last 1 minute)
        const heartbeatTime = new Date(heartbeat.timestamp).getTime();
        const isOnline = Date.now() - heartbeatTime < ONLINE_THRESHOLD_MS;
        response.connection.status = isOnline ? "online" : "offline";

        // Control logic status (only for controllers)
        response.controlLogic = {
          status: heartbeat.control_loop_status || "unknown",
          lastError: heartbeat.last_error || null,
          activeAlarms: heartbeat.active_alarms_count || 0,
        };

        // Extract config version from heartbeat metadata
        // Controller sends config_version (updated_at of config it's using)
        const metadata = heartbeat.metadata || {};
        if (metadata.config_version) {
          response.configSync.localPulledAt = metadata.config_version;
        } else if (metadata.config_synced_at) {
          response.configSync.localPulledAt = metadata.config_synced_at;
        }
      }
    } else if (masterDevice?.device_type === "gateway") {
      response.connection.type = "gateway";

      // For gateways, use the is_online field from site_master_devices directly
      response.connection.status = masterDevice.is_online ? "online" : "offline";

      // Control logic is not applicable for gateways (stays null)
    }

    // Step 4: Determine config sync status
    // We consider "synced" if config_synced_at exists and is recent (within 5 minutes)
    // OR if the controller_config_version matches what we expect
    // Note: We don't use updated_at because it auto-updates when config_synced_at changes
    if (site.config_synced_at) {
      response.configSync.lastSyncedAt = site.config_synced_at;

      const syncedAt = new Date(site.config_synced_at).getTime();
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

      // Consider synced if:
      // 1. Sync happened in the last 5 minutes (covers the auto-sync case)
      // 2. OR controller has the same config version we sent
      const hasRecentSync = syncedAt > fiveMinutesAgo;
      const controllerVersion = site.controller_config_version;
      const platformVersion = site.platform_config_version;

      // If versions exist and match, consider synced
      // If versions don't exist but sync is recent, consider synced
      const versionsMatch = controllerVersion && platformVersion &&
        controllerVersion === platformVersion;

      if (hasRecentSync || versionsMatch) {
        response.configSync.status = "synced";
      } else {
        // Sync is old and versions don't match
        response.configSync.status = "sync_needed";
        response.configSync.pendingChanges = await calculatePendingChanges(
          supabase,
          siteId
        );
      }
    } else {
      response.configSync.status = "never_synced";
    }

    // Step 5: Get logging status (for Control Logs viewer)
    const { data: lastLog, count: logCount } = await supabase
      .from("control_logs")
      .select("timestamp", { count: "exact" })
      .eq("site_id", siteId)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastLog) {
      response.logging = {
        hasLogs: true,
        lastLogTimestamp: lastLog.timestamp,
        totalLogs: logCount || 0,
      };
    }

    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Calculate pending changes between platform and controller config.
 * Returns category-level counts for display.
 */
async function calculatePendingChanges(
  supabase: SupabaseClient,
  siteId: string
): Promise<{ devices: number; settings: number } | null> {
  try {
    // Count devices that may need syncing
    // For a simple implementation, we can count total devices
    // A more sophisticated approach would track sync status per device
    const { count: deviceCount } = await supabase
      .from("site_devices")
      .select("*", { count: "exact", head: true })
      .eq("site_id", siteId);

    // For now, we return a simple count
    // In a full implementation, we'd compare platform config with controller-reported config
    return {
      devices: deviceCount || 0,
      settings: 1, // Placeholder - would compare actual settings
    };
  } catch {
    return null;
  }
}
