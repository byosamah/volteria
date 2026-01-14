/**
 * API Route: Template Sync Status
 *
 * Returns the sync status between device templates and devices in a site:
 * - Last configuration update (when templates were last modified)
 * - Last synchronization (when devices were last synced from templates)
 * - Count of devices needing sync
 *
 * GET /api/sites/[siteId]/template-sync-status
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

    // Get site's config_changed_at for config sync tracking (tracks actual config changes)
    const { data: site } = await supabase
      .from("sites")
      .select("config_changed_at, config_synced_at, config_sync_interval_s")
      .eq("id", siteId)
      .single();

    // Sync interval in seconds (default 300 = 5 minutes)
    const syncIntervalSeconds = (site as Record<string, unknown>)?.config_sync_interval_s as number | null ?? 300;

    // Get all ENABLED devices in site (exclude disabled/deleted devices)
    const { data: devices, error: devicesError } = await supabase
      .from("site_devices")
      .select(`
        id,
        template_id,
        template_synced_at,
        updated_at,
        device_templates (
          id,
          updated_at
        )
      `)
      .eq("site_id", siteId)
      .eq("enabled", true);

    if (devicesError) {
      console.error("Failed to fetch devices:", devicesError);
      return NextResponse.json(
        { error: "Failed to fetch devices" },
        { status: 500 }
      );
    }

    // Calculate last_config_update from multiple sources:
    // 1. Site config_changed_at (when site settings changed)
    // 2. Device updated_at (when device connection settings changed)
    // 3. Template updated_at (when templates were modified)
    let lastConfigUpdate: Date | null = null;
    let lastSync: Date | null = null;
    let devicesNeedingSync = 0;

    // Include site config change time (config_changed_at only updates on actual config changes)
    const siteConfigChangedAt = (site as Record<string, unknown>)?.config_changed_at as string | null;
    if (siteConfigChangedAt) {
      lastConfigUpdate = new Date(siteConfigChangedAt);
    }

    // Use site's config_synced_at as the sync baseline
    if (site?.config_synced_at) {
      lastSync = new Date(site.config_synced_at);
    }

    if (!devices || devices.length === 0) {
      // Even with no devices, check if site config changed
      const needsSync = siteConfigChangedAt && site?.config_synced_at
        ? new Date(siteConfigChangedAt) > new Date(site.config_synced_at)
        : siteConfigChangedAt ? true : false;

      return NextResponse.json({
        last_config_update: lastConfigUpdate?.toISOString() || null,
        last_sync: lastSync?.toISOString() || null,
        needs_sync: needsSync,
        total_devices: 0,
        devices_needing_sync: 0,
        sync_interval_seconds: syncIntervalSeconds,
      });
    }

    for (const device of devices) {
      // Check device's own updated_at (connection settings like IP, port)
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

      // Check if device needs sync (device or template updated after last sync)
      if (lastSync) {
        // Check device settings changed
        if (device.updated_at && new Date(device.updated_at) > lastSync) {
          devicesNeedingSync++;
          continue;
        }
        // Check template changed
        if (template?.updated_at && new Date(template.updated_at) > lastSync) {
          devicesNeedingSync++;
        }
      } else {
        // No sync has ever happened
        devicesNeedingSync++;
      }
    }

    // Also check site-level config change
    const siteNeedsSync = siteConfigChangedAt && lastSync
      ? new Date(siteConfigChangedAt) > lastSync
      : siteConfigChangedAt ? true : false;

    const needsSync = devicesNeedingSync > 0 || siteNeedsSync;

    return NextResponse.json({
      last_config_update: lastConfigUpdate?.toISOString() || null,
      last_sync: lastSync?.toISOString() || null,
      needs_sync: needsSync,
      total_devices: devices.length,
      devices_needing_sync: devicesNeedingSync,
      sync_interval_seconds: syncIntervalSeconds,
    });
  } catch (error) {
    console.error("Template sync status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
