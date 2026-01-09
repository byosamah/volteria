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

    // Get all devices in site that have a template_id
    const { data: devices, error: devicesError } = await supabase
      .from("project_devices")
      .select(`
        id,
        template_id,
        template_synced_at,
        device_templates (
          id,
          updated_at
        )
      `)
      .eq("site_id", siteId)
      .not("template_id", "is", null);

    if (devicesError) {
      console.error("Failed to fetch devices:", devicesError);
      return NextResponse.json(
        { error: "Failed to fetch devices" },
        { status: 500 }
      );
    }

    if (!devices || devices.length === 0) {
      return NextResponse.json({
        last_config_update: null,
        last_sync: null,
        needs_sync: false,
        total_devices: 0,
        devices_needing_sync: 0,
      });
    }

    // Calculate last_config_update (max template updated_at)
    let lastConfigUpdate: Date | null = null;
    let lastSync: Date | null = null;
    let devicesNeedingSync = 0;

    for (const device of devices) {
      const template = device.device_templates as { id: string; updated_at: string } | null;

      if (template?.updated_at) {
        const templateUpdated = new Date(template.updated_at);
        if (!lastConfigUpdate || templateUpdated > lastConfigUpdate) {
          lastConfigUpdate = templateUpdated;
        }
      }

      if (device.template_synced_at) {
        const synced = new Date(device.template_synced_at);
        if (!lastSync || synced < lastSync) {
          // Use the oldest sync time (min)
          lastSync = synced;
        }

        // Check if device needs sync
        if (template?.updated_at) {
          const templateUpdated = new Date(template.updated_at);
          if (templateUpdated > synced) {
            devicesNeedingSync++;
          }
        }
      } else {
        // Device was never synced
        devicesNeedingSync++;
      }
    }

    const needsSync = devicesNeedingSync > 0;

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
