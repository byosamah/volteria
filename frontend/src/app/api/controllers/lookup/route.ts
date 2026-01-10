import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/controllers/lookup?serial=<serial_number>
 *
 * Looks up a controller by serial number and returns SSH connection details.
 * Used by Claude Code to connect to controllers.
 *
 * Returns connection command if SSH is configured:
 *   ssh -p <tunnel_port> <username>@159.223.224.203
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const serialNumber = searchParams.get("serial");

    if (!serialNumber) {
      return NextResponse.json(
        { error: "Serial number is required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Look up controller by serial number
    const { data: controller, error } = await supabase
      .from("controllers")
      .select(`
        id,
        serial_number,
        status,
        firmware_version,
        ssh_tunnel_port,
        ssh_username,
        ssh_password,
        ssh_tunnel_active,
        ssh_last_connected_at,
        site_master_devices (
          site_id,
          sites (
            id,
            name,
            project_id
          )
        )
      `)
      .eq("serial_number", serialNumber)
      .single();

    if (error || !controller) {
      return NextResponse.json(
        { error: "Controller not found", serial_number: serialNumber },
        { status: 404 }
      );
    }

    // Build response
    const sshConfigured = !!(controller.ssh_tunnel_port && controller.ssh_username);
    const masterDevice = controller.site_master_devices?.[0] as {
      site_id: string;
      sites: { id: string; name: string; project_id: string } | null
    } | undefined;
    const siteInfo = masterDevice?.sites;

    return NextResponse.json({
      controller_id: controller.id,
      serial_number: controller.serial_number,
      status: controller.status,
      firmware_version: controller.firmware_version,
      site: siteInfo ? {
        id: siteInfo.id,
        name: siteInfo.name,
        project_id: siteInfo.project_id,
      } : null,
      ssh: {
        configured: sshConfigured,
        tunnel_active: controller.ssh_tunnel_active,
        last_connected_at: controller.ssh_last_connected_at,
        connection_command: sshConfigured
          ? `sshpass -p '${controller.ssh_password}' ssh -p ${controller.ssh_tunnel_port} ${controller.ssh_username}@localhost`
          : null,
        server_command: sshConfigured
          ? `ssh root@159.223.224.203 "sshpass -p '${controller.ssh_password}' ssh -p ${controller.ssh_tunnel_port} ${controller.ssh_username}@localhost '<command>'"`
          : null,
      },
    });
  } catch (error) {
    console.error("Controller lookup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
