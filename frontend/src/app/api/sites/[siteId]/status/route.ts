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
    lastConfigUpdate: string | null; // Max of site/device/template updated_at
    syncIntervalSeconds: number; // Auto-sync interval
    totalDevices: number;
    devicesNeedingSync: number;
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
        config_sync_interval_s,
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

    // Get sync interval (default 60 minutes = 3600 seconds)
    const syncIntervalSeconds = (site as Record<string, unknown>)?.config_sync_interval_s as number | null ?? 3600;

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
        lastConfigUpdate: null, // Will be calculated from devices/templates
        syncIntervalSeconds,
        totalDevices: 0,
        devicesNeedingSync: 0,
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

    // Step 4: Determine config sync status using strict timestamp comparison
    // This matches the logic in template-sync-status for consistency
    const configSyncResult = await calculateConfigSyncStatus(supabase, siteId, site);
    response.configSync.status = configSyncResult.status;
    response.configSync.lastConfigUpdate = configSyncResult.lastConfigUpdate;
    response.configSync.totalDevices = configSyncResult.totalDevices;
    response.configSync.devicesNeedingSync = configSyncResult.devicesNeedingSync;

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
 * Calculate config sync status using strict timestamp comparison.
 * Checks site config, device settings, and template updates against last sync time.
 * This is the single source of truth for sync status (used by both header and widget).
 */
async function calculateConfigSyncStatus(
  supabase: SupabaseClient,
  siteId: string,
  site: { config_changed_at?: string | null; config_synced_at?: string | null }
): Promise<{
  status: "synced" | "sync_needed" | "never_synced";
  lastConfigUpdate: string | null;
  totalDevices: number;
  devicesNeedingSync: number;
}> {
  try {
    const configChangedAt = (site as Record<string, unknown>)?.config_changed_at as string | null;
    const configSyncedAt = site.config_synced_at;
    const lastSync = configSyncedAt ? new Date(configSyncedAt) : null;

    // Get all ENABLED devices in site with their templates
    const { data: devices } = await supabase
      .from("site_devices")
      .select(`
        id,
        template_id,
        updated_at,
        device_templates (
          id,
          updated_at
        )
      `)
      .eq("site_id", siteId)
      .eq("enabled", true);

    // Calculate last_config_update from multiple sources
    let lastConfigUpdate: Date | null = null;
    let devicesNeedingSync = 0;

    // Include site config change time
    if (configChangedAt) {
      lastConfigUpdate = new Date(configChangedAt);
    }

    const totalDevices = devices?.length || 0;

    if (devices && devices.length > 0) {
      for (const device of devices) {
        // Check device's own updated_at
        if (device.updated_at) {
          const deviceUpdated = new Date(device.updated_at);
          if (!lastConfigUpdate || deviceUpdated > lastConfigUpdate) {
            lastConfigUpdate = deviceUpdated;
          }
        }

        // Handle Supabase join which can return array or single object
        const templateData = device.device_templates;
        const template = Array.isArray(templateData)
          ? (templateData[0] as { id: string; updated_at: string } | undefined)
          : (templateData as { id: string; updated_at: string } | null);

        if (template?.updated_at) {
          const templateUpdated = new Date(template.updated_at);
          if (!lastConfigUpdate || templateUpdated > lastConfigUpdate) {
            lastConfigUpdate = templateUpdated;
          }
        }

        // Check if device needs sync
        if (lastSync) {
          if (device.updated_at && new Date(device.updated_at) > lastSync) {
            devicesNeedingSync++;
            continue;
          }
          if (template?.updated_at && new Date(template.updated_at) > lastSync) {
            devicesNeedingSync++;
          }
        } else {
          // No sync has ever happened - all devices need sync
          devicesNeedingSync++;
        }
      }
    }

    // Determine status using strict timestamp comparison
    if (!configSyncedAt) {
      return {
        status: "never_synced",
        lastConfigUpdate: lastConfigUpdate?.toISOString() || null,
        totalDevices,
        devicesNeedingSync,
      };
    }

    // Check if site-level config changed after last sync
    const siteNeedsSync = configChangedAt && lastSync
      ? new Date(configChangedAt) > lastSync
      : false;

    const needsSync = devicesNeedingSync > 0 || siteNeedsSync;

    return {
      status: needsSync ? "sync_needed" : "synced",
      lastConfigUpdate: lastConfigUpdate?.toISOString() || null,
      totalDevices,
      devicesNeedingSync,
    };
  } catch (error) {
    console.error("Error calculating config sync status:", error);
    return {
      status: "never_synced",
      lastConfigUpdate: null,
      totalDevices: 0,
      devicesNeedingSync: 0,
    };
  }
}
