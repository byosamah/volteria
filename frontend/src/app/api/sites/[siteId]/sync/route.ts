/**
 * API Route: Site Config Sync
 *
 * POST /api/sites/[siteId]/sync
 * Triggers a config sync to the controller.
 *
 * The controller polls for config changes every 5 minutes automatically.
 * This endpoint allows users to trigger an immediate sync by:
 * 1. Updating the site's updated_at timestamp (forces version mismatch)
 * 2. Inserting a sync command into control_commands table
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

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get site and its master device
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

    // Check user has access to the project
    const { data: userProject, error: accessError } = await supabase
      .from("user_projects")
      .select("can_edit")
      .eq("user_id", user.id)
      .eq("project_id", site.project_id)
      .maybeSingle();

    // Allow if user is admin or has project access
    const { data: userData } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const isAdmin = ["super_admin", "backend_admin", "admin"].includes(userData?.role || "");

    if (!isAdmin && (!userProject || accessError)) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    // Get master device info
    const masterDevice = site.site_master_devices?.[0];
    if (!masterDevice || masterDevice.device_type !== "controller") {
      return NextResponse.json(
        { error: "Site does not have a controller" },
        { status: 400 }
      );
    }

    // Insert sync command into control_commands table
    // The controller polls this table and will pick up the command
    const { error: commandError } = await supabase
      .from("control_commands")
      .insert({
        site_id: siteId,
        command_type: "sync_config",
        parameters: { triggered_by: user.email },
        status: "pending",
        created_by: user.id,
      });

    if (commandError) {
      console.error("Error inserting sync command:", commandError);
      return NextResponse.json(
        { error: "Failed to create sync command" },
        { status: 500 }
      );
    }

    // Note: We no longer update site.updated_at here because:
    // 1. The command queue (polled every 5 seconds) triggers the sync
    // 2. Updating updated_at would make the status show "Not Synced" immediately
    // 3. The controller updates config_synced_at after successful sync

    return NextResponse.json({
      success: true,
      message: "Sync command sent. Controller will sync within 5 seconds.",
      triggered_at: new Date().toISOString(),
    });

  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
