/**
 * API Route: Manual Config Sync
 *
 * Triggers a full config sync to the controller and waits for response.
 * This is an alternative to automatic sync when you need immediate confirmation.
 *
 * Flow:
 * 1. Insert sync_config command into control_commands table
 * 2. Poll for controller response (with 30s timeout)
 * 3. Return success/failure based on actual controller response
 *
 * POST /api/sites/[siteId]/sync-templates
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const SYNC_TIMEOUT_MS = 30000; // 30 seconds timeout
const POLL_INTERVAL_MS = 1000; // Poll every 1 second

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

    // Get site and its master device (controller)
    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select(`
        id,
        name,
        project_id,
        site_master_devices (
          id,
          controller_id,
          device_type
        )
      `)
      .eq("id", siteId)
      .single();

    if (siteError || !site) {
      return NextResponse.json(
        { error: "Site not found" },
        { status: 404 }
      );
    }

    // Get master device info - must have a controller
    const masterDevices = site.site_master_devices as Array<{
      id: string;
      controller_id: string | null;
      device_type: string;
    }> | null;

    const controller = masterDevices?.find(d => d.device_type === "controller");

    if (!controller) {
      return NextResponse.json(
        { error: "Site does not have a controller assigned" },
        { status: 400 }
      );
    }

    // Get count of enabled devices to sync
    const { data: devices, error: devicesError } = await supabase
      .from("site_devices")
      .select("id")
      .eq("site_id", siteId)
      .eq("enabled", true);

    if (devicesError) {
      return NextResponse.json(
        { error: "Failed to fetch devices" },
        { status: 500 }
      );
    }

    const deviceCount = devices?.length || 0;

    // Insert sync command into control_commands table
    const { data: command, error: commandError } = await supabase
      .from("control_commands")
      .insert({
        site_id: siteId,
        command_type: "sync_config",
        parameters: {
          triggered_by: user.email,
          device_count: deviceCount,
          manual_sync: true,
        },
        status: "pending",
        created_by: user.id,
      })
      .select()
      .single();

    if (commandError || !command) {
      console.error("Error inserting sync command:", commandError);
      return NextResponse.json(
        { error: "Failed to create sync command" },
        { status: 500 }
      );
    }

    // Poll for controller response with timeout
    const startTime = Date.now();
    let lastStatus = "pending";

    while (Date.now() - startTime < SYNC_TIMEOUT_MS) {
      // Wait before polling
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

      // Check command status
      const { data: updatedCommand, error: pollError } = await supabase
        .from("control_commands")
        .select("status, result, error_message, executed_at")
        .eq("id", command.id)
        .single();

      if (pollError) {
        console.error("Error polling command status:", pollError);
        continue;
      }

      lastStatus = updatedCommand?.status || "pending";

      // Check if controller has responded
      if (lastStatus === "completed") {
        // Update site's config_synced_at since controller confirmed
        await supabase
          .from("sites")
          .update({ config_synced_at: new Date().toISOString() })
          .eq("id", siteId);

        return NextResponse.json({
          success: true,
          synced_devices: deviceCount,
          message: `Successfully synced ${deviceCount} device(s) to controller`,
          executed_at: updatedCommand?.executed_at,
        });
      }

      if (lastStatus === "failed") {
        return NextResponse.json({
          success: false,
          error: updatedCommand?.error_message || "Sync failed on controller",
          synced_devices: 0,
        }, { status: 500 });
      }

      // If status is "acknowledged" or "in_progress", keep waiting
    }

    // Timeout - controller didn't respond in time
    // Update command status to indicate timeout
    await supabase
      .from("control_commands")
      .update({
        status: "timeout",
        error_message: "Controller did not respond within 30 seconds",
      })
      .eq("id", command.id);

    return NextResponse.json({
      success: false,
      error: "Controller not responding - sync timed out after 30 seconds",
      synced_devices: 0,
      hint: "Check if the controller is online and connected",
    }, { status: 504 }); // 504 Gateway Timeout

  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
