import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Central server for SSH tunnels
const CENTRAL_SERVER_IP = "159.223.224.203";

/**
 * POST /api/controllers/[controllerId]/ssh-setup
 *
 * Returns the SSH port configuration. The port is assigned during
 * controller registration (setup script), not here. This endpoint
 * just reads the existing configuration.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ controllerId: string }> }
) {
  const { controllerId } = await params;

  try {
    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get the controller - use ssh_port (set by registration API)
    const { data: controller, error: controllerError } = await supabase
      .from("controllers")
      .select("id, serial_number, ssh_port")
      .eq("id", controllerId)
      .single();

    if (controllerError || !controller) {
      return NextResponse.json(
        { error: "Controller not found" },
        { status: 404 }
      );
    }

    // SSH port is assigned during registration (setup script)
    // Just return the existing configuration
    if (controller.ssh_port) {
      return NextResponse.json({
        success: true,
        already_configured: true,
        ssh_tunnel_port: controller.ssh_port,
        central_server: CENTRAL_SERVER_IP,
        message: "SSH tunnel configured during registration",
      });
    }

    // No SSH port assigned yet - registration hasn't completed
    return NextResponse.json({
      success: false,
      already_configured: false,
      ssh_tunnel_port: null,
      message: "SSH port not yet assigned - complete controller registration first",
    });
  } catch (error) {
    console.error("SSH setup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
