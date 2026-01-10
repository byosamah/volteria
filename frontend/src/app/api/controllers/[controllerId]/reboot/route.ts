import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/controllers/[controllerId]/reboot
 *
 * Send reboot command to a controller via control_commands table.
 * The controller polls this table and executes the reboot command.
 *
 * Requires:
 * - User to be authenticated
 * - User to have access to the site where the controller is assigned
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ controllerId: string }> }
) {
  const { controllerId } = await params;

  try {
    const supabase = await createClient();

    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get the controller and verify it exists
    const { data: controller, error: controllerError } = await supabase
      .from("controllers")
      .select("id, serial_number")
      .eq("id", controllerId)
      .single();

    if (controllerError || !controller) {
      return NextResponse.json({ error: "Controller not found" }, { status: 404 });
    }

    // Get the site where this controller is assigned
    const { data: masterDevice, error: masterError } = await supabase
      .from("site_master_devices")
      .select("site_id, sites!inner(id, project_id)")
      .eq("controller_id", controllerId)
      .single();

    if (masterError || !masterDevice) {
      return NextResponse.json(
        { error: "Controller is not assigned to any site" },
        { status: 400 }
      );
    }

    const siteId = masterDevice.site_id;

    // Check user has access to this site (via project access)
    const { data: userProject, error: accessError } = await supabase
      .from("user_projects")
      .select("can_control")
      .eq("user_id", user.id)
      .eq("project_id", (masterDevice.sites as { project_id: string }).project_id)
      .single();

    // Also check if user is super_admin or backend_admin (they have access to everything)
    const { data: userData } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const isAdmin = userData?.role && ["super_admin", "backend_admin", "admin"].includes(userData.role);

    if (!isAdmin && (!userProject || !userProject.can_control)) {
      return NextResponse.json(
        { error: "You don't have permission to control this site" },
        { status: 403 }
      );
    }

    // Insert reboot command into control_commands table
    const { data: command, error: insertError } = await supabase
      .from("control_commands")
      .insert({
        site_id: siteId,
        controller_id: controllerId,
        command_type: "reboot",
        parameters: { graceful: true },
        status: "pending",
        priority: 1, // High priority
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to insert reboot command:", insertError);
      return NextResponse.json(
        { error: "Failed to send reboot command" },
        { status: 500 }
      );
    }

    // Log the action to audit_logs
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      action: "controller.reboot",
      category: "control",
      resource_type: "controller",
      resource_id: controllerId,
      description: `Sent reboot command to controller ${controller.serial_number}`,
      metadata: {
        command_id: command.id,
        site_id: siteId,
      },
      status: "success",
    });

    return NextResponse.json({
      success: true,
      command_id: command.id,
      message: "Reboot command sent successfully",
    });
  } catch (error) {
    console.error("Reboot API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
