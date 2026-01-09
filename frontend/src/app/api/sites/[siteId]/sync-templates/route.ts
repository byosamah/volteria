/**
 * API Route: Sync Templates
 *
 * Synchronizes all devices in a site from their templates.
 * Copies registers, visualization_registers, alarm_registers, and calculated_fields
 * from each device's template to the device.
 *
 * POST /api/sites/[siteId]/sync-templates
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await params;
    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get all devices in site that have a template_id
    const { data: devices, error: devicesError } = await supabase
      .from("project_devices")
      .select(`
        id,
        template_id
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
        synced_devices: 0,
        synced_at: new Date().toISOString(),
        message: "No devices with templates found",
      });
    }

    // Get unique template IDs
    const templateIds = [...new Set(devices.map(d => d.template_id).filter(Boolean))];

    // Fetch all templates
    const { data: templates, error: templatesError } = await supabase
      .from("device_templates")
      .select(`
        id,
        registers,
        logging_registers,
        visualization_registers,
        alarm_registers,
        calculated_fields
      `)
      .in("id", templateIds);

    if (templatesError) {
      console.error("Failed to fetch templates:", templatesError);
      return NextResponse.json(
        { error: "Failed to fetch templates" },
        { status: 500 }
      );
    }

    // Create a map of template ID to template data
    const templateMap = new Map(templates?.map(t => [t.id, t]) || []);

    // Sync each device from its template
    let syncedCount = 0;
    const now = new Date().toISOString();

    for (const device of devices) {
      const template = templateMap.get(device.template_id);
      if (!template) continue;

      // Build update data from template
      // Use logging_registers if available, otherwise fall back to registers
      const loggingRegisters = template.logging_registers || template.registers || [];

      const updateData: Record<string, unknown> = {
        registers: loggingRegisters,
        visualization_registers: template.visualization_registers || [],
        alarm_registers: template.alarm_registers || [],
        calculated_fields: template.calculated_fields || [],
        template_synced_at: now,
      };

      const { error: updateError } = await supabase
        .from("project_devices")
        .update(updateData)
        .eq("id", device.id);

      if (updateError) {
        console.error(`Failed to sync device ${device.id}:`, updateError);
        continue;
      }

      syncedCount++;
    }

    return NextResponse.json({
      synced_devices: syncedCount,
      synced_at: now,
      message: `Successfully synchronized ${syncedCount} device(s)`,
    });
  } catch (error) {
    console.error("Sync templates error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
