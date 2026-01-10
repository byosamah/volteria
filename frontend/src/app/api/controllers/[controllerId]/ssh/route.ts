import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/controllers/[controllerId]/ssh
 *
 * Returns SSH connection details for a controller.
 * Used by Claude Code to connect to controllers via reverse SSH tunnel.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ controllerId: string }> }
) {
  const { controllerId } = await params;

  try {
    const supabase = await createClient();

    // Verify user is authenticated and has admin access
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get the controller with SSH details
    const { data: controller, error } = await supabase
      .from("controllers")
      .select(`
        id,
        serial_number,
        ssh_tunnel_port,
        ssh_username,
        ssh_password,
        ssh_tunnel_active,
        ssh_host_key_fingerprint,
        ssh_last_connected_at
      `)
      .eq("id", controllerId)
      .single();

    if (error || !controller) {
      return NextResponse.json(
        { error: "Controller not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      controller_id: controller.id,
      serial_number: controller.serial_number,
      ssh: {
        tunnel_port: controller.ssh_tunnel_port,
        username: controller.ssh_username,
        password: controller.ssh_password,
        tunnel_active: controller.ssh_tunnel_active,
        host_key_fingerprint: controller.ssh_host_key_fingerprint,
        last_connected_at: controller.ssh_last_connected_at,
      },
      connection_command: controller.ssh_tunnel_port
        ? `ssh -p ${controller.ssh_tunnel_port} ${controller.ssh_username}@159.223.224.203`
        : null,
    });
  } catch (error) {
    console.error("SSH API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/controllers/[controllerId]/ssh
 *
 * Updates SSH connection details for a controller.
 * Called during controller setup wizard or manual configuration.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ controllerId: string }> }
) {
  const { controllerId } = await params;

  try {
    const supabase = await createClient();

    // Verify user is authenticated and has admin access
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      ssh_tunnel_port,
      ssh_username,
      ssh_password,
      ssh_tunnel_active,
      ssh_host_key_fingerprint,
    } = body;

    // Validate required fields
    if (ssh_tunnel_port && (ssh_tunnel_port < 1024 || ssh_tunnel_port > 65535)) {
      return NextResponse.json(
        { error: "Invalid port number (must be between 1024 and 65535)" },
        { status: 400 }
      );
    }

    // Update the controller's SSH settings
    const { data: controller, error } = await supabase
      .from("controllers")
      .update({
        ssh_tunnel_port,
        ssh_username,
        ssh_password,
        ssh_tunnel_active: ssh_tunnel_active ?? true,
        ssh_host_key_fingerprint,
        ssh_last_connected_at: new Date().toISOString(),
      })
      .eq("id", controllerId)
      .select()
      .single();

    if (error) {
      console.error("Failed to update SSH settings:", error);
      return NextResponse.json(
        { error: "Failed to update SSH settings", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      controller_id: controller.id,
      ssh_tunnel_port: controller.ssh_tunnel_port,
    });
  } catch (error) {
    console.error("SSH API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
