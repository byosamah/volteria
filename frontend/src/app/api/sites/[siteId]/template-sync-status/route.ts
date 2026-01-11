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

    // Get site's updated_at for config sync tracking
    const { data: site } = await supabase
      .from("sites")
      .select("updated_at, config_synced_at")
      .eq("id", siteId)
      .single();

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
    // 1. Site updated_at (when site settings changed)
    // 2. Device updated_at (when device connection settings changed)
    // 3. Template updated_at (when templates were modified)
    let lastConfigUpdate: Date | null = null;
    let lastSync: Date | null = null;
    let devicesNeedingSync = 0;

    // Include site config update time
    if (site?.updated_at) {
      lastConfigUpdate = new Date(site.updated_at);
    }

    // Use site's config_synced_at as the sync baseline
    if (site?.config_synced_at) {
      lastSync = new Date(site.config_synced_at);
    }

    if (!devices || devices.length === 0) {
      // Even with no devices, check if site config changed
      const needsSync = site?.updated_at && site?.config_synced_at
        ? new Date(site.updated_at) > new Date(site.config_synced_at)
        : site?.updated_at ? true : false;

      return NextResponse.json({
        last_config_update: lastConfigUpdate?.toISOString() || null,
        last_sync: lastSync?.toISOString() || null,
        needs_sync: needsSync,
        total_devices: 0,
        devices_needing_sync: 0,
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
    const siteNeedsSync = site?.updated_at && lastSync
      ? new Date(site.updated_at) > lastSync
      : site?.updated_at ? true : false;

    const needsSync = devicesNeedingSync > 0 || siteNeedsSync;

    return NextResponse.json({
      last_config_update: lastConfigUpdate?.toISOString() || null,
      last_sync: lastSync?.toISOString() || null,
      needs_sync: needsSync,
      total_devices: devices.length,
      devices_needing_sync: devicesNeedingSync,
    });
  } catch (error) {
    console.error("Template sync status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
