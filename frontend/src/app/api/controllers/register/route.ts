import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Central server for SSH tunnels
const CENTRAL_SERVER_IP = "159.223.224.203";
const CENTRAL_SERVER_USER = "root";

// Port range for SSH tunnels
const SSH_PORT_MIN = 10000;
const SSH_PORT_MAX = 20000;

// Supabase service client (no auth required for controller registration)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || "";

/**
 * POST /api/controllers/register
 *
 * Called by setup script on Raspberry Pi to register the controller.
 * This endpoint does NOT require authentication - it uses the serial number
 * as the identity and matches it to an existing controller record (created via wizard).
 *
 * Request body:
 * - serial_number: string (required) - Pi's serial number from /proc/cpuinfo
 * - hardware_type: string (optional) - detected hardware type
 * - firmware_version: string (optional) - volteria software version
 * - ssh_public_key: string (optional) - Pi's SSH public key for tunnel auth
 *
 * Response:
 * - controller_id: string - UUID of the controller
 * - ssh_tunnel_port: number - assigned SSH tunnel port
 * - supabase_key: string - anon key for heartbeat API calls
 * - central_server: string - SSH tunnel target server
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { serial_number, hardware_type, firmware_version, ssh_public_key } = body;

    if (!serial_number) {
      return NextResponse.json(
        { error: "serial_number is required" },
        { status: 400 }
      );
    }

    // Create Supabase client with service key
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // First, try to find an existing controller with this serial number
    let { data: controller, error: findError } = await supabase
      .from("controllers")
      .select("id, serial_number, ssh_port, status, wizard_step")
      .eq("serial_number", serial_number)
      .single();

    // If not found by serial, look for a controller in wizard without serial
    // (created via wizard Step 1 but not yet registered by setup script)
    if (!controller) {
      // Find controllers in draft status with wizard_step set (in wizard flow)
      const { data: draftControllers } = await supabase
        .from("controllers")
        .select("id, serial_number, ssh_port, status, wizard_step")
        .is("serial_number", null)
        .eq("status", "draft")
        .not("wizard_step", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);

      if (draftControllers && draftControllers.length > 0) {
        controller = draftControllers[0];

        // Update the controller with the serial number
        await supabase
          .from("controllers")
          .update({ serial_number })
          .eq("id", controller.id);

        controller.serial_number = serial_number;
      }
    }

    if (!controller) {
      // No matching controller found - create a new one
      // This handles the case where setup script runs before wizard
      const { data: newController, error: createError } = await supabase
        .from("controllers")
        .insert({
          serial_number,
          status: "draft",
        })
        .select("id, serial_number, ssh_port, status, wizard_step")
        .single();

      if (createError || !newController) {
        console.error("Failed to create controller:", createError);
        return NextResponse.json(
          { error: "Failed to register controller" },
          { status: 500 }
        );
      }
      controller = newController;
    }

    // Assign SSH port if not already assigned
    let sshPort = controller.ssh_port;
    if (!sshPort) {
      // Find an available port
      const { data: usedPorts } = await supabase
        .from("controllers")
        .select("ssh_port")
        .not("ssh_port", "is", null);

      const usedPortNumbers = new Set(
        (usedPorts || []).map((p) => p.ssh_port)
      );

      for (let port = SSH_PORT_MIN; port <= SSH_PORT_MAX; port++) {
        if (!usedPortNumbers.has(port)) {
          sshPort = port;
          break;
        }
      }

      if (!sshPort) {
        return NextResponse.json(
          { error: "No available SSH ports" },
          { status: 503 }
        );
      }

      // Update controller with SSH port and public key
      const updateData: Record<string, unknown> = {
        ssh_port: sshPort,
      };

      if (firmware_version) {
        updateData.firmware_version = firmware_version;
      }

      if (ssh_public_key) {
        updateData.ssh_public_key = ssh_public_key;
      }

      await supabase
        .from("controllers")
        .update(updateData)
        .eq("id", controller.id);
    }

    // If we have a public key, try to authorize it on the central server
    if (ssh_public_key) {
      try {
        await authorizeSSHKey(ssh_public_key, serial_number);
      } catch (authError) {
        console.error("Failed to authorize SSH key (non-fatal):", authError);
        // Don't fail registration if key auth fails - can be done manually
      }
    }

    // Return registration info
    return NextResponse.json({
      success: true,
      controller_id: controller.id,
      ssh_tunnel_port: sshPort,
      central_server: CENTRAL_SERVER_IP,
      central_server_user: CENTRAL_SERVER_USER,
      supabase_url: supabaseUrl,
      supabase_key: supabaseServiceKey,  // Service key needed for heartbeat insertion
    });

  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Authorize SSH key on the central server
 * This adds the public key to /root/.ssh/authorized_keys on the central server
 */
async function authorizeSSHKey(publicKey: string, comment: string): Promise<void> {
  // The key should be in format: ssh-rsa AAAA... comment
  // We'll add our own comment to identify it
  const keyWithComment = publicKey.trim().includes(" ")
    ? publicKey.trim()
    : `${publicKey.trim()} volteria-controller-${comment}`;

  // For now, we'll store the key and rely on a cron job to sync
  // In production, this would SSH to the central server and add the key
  // OR use a webhook/API on the central server

  // Log for manual sync if needed
  console.log(`SSH key to authorize for ${comment}:`, keyWithComment);

  // TODO: Implement automatic key authorization
  // Options:
  // 1. SSH from Docker to host (requires SSH access)
  // 2. Shared volume with authorized_keys
  // 3. API endpoint on host that adds keys
  // 4. Cron job that syncs keys from database
}
