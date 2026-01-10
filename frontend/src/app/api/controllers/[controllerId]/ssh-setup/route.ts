import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Central server for SSH tunnels
const CENTRAL_SERVER_IP = "159.223.224.203";

// Port range for SSH tunnels (to avoid conflicts with common services)
const SSH_PORT_MIN = 2230;
const SSH_PORT_MAX = 2299;

/**
 * POST /api/controllers/[controllerId]/ssh-setup
 *
 * Allocates a unique SSH port and returns the setup script/commands
 * for configuring the reverse SSH tunnel on the controller.
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

    // Get the controller
    const { data: controller, error: controllerError } = await supabase
      .from("controllers")
      .select("id, serial_number, ssh_tunnel_port")
      .eq("id", controllerId)
      .single();

    if (controllerError || !controller) {
      return NextResponse.json(
        { error: "Controller not found" },
        { status: 404 }
      );
    }

    // Check if SSH is already configured
    if (controller.ssh_tunnel_port) {
      return NextResponse.json({
        success: true,
        already_configured: true,
        ssh_tunnel_port: controller.ssh_tunnel_port,
        message: "SSH tunnel already configured",
      });
    }

    // Find an available port
    const { data: usedPorts, error: portsError } = await supabase
      .from("controllers")
      .select("ssh_tunnel_port")
      .not("ssh_tunnel_port", "is", null);

    if (portsError) {
      console.error("Error fetching used ports:", portsError);
      return NextResponse.json(
        { error: "Failed to allocate port" },
        { status: 500 }
      );
    }

    const usedPortNumbers = new Set(
      (usedPorts || []).map((p) => p.ssh_tunnel_port)
    );

    let allocatedPort: number | null = null;
    for (let port = SSH_PORT_MIN; port <= SSH_PORT_MAX; port++) {
      if (!usedPortNumbers.has(port)) {
        allocatedPort = port;
        break;
      }
    }

    if (!allocatedPort) {
      return NextResponse.json(
        { error: "No available SSH ports. Contact administrator." },
        { status: 503 }
      );
    }

    // Generate SSH credentials
    // Note: In production, you'd use key-based auth, but for now use password
    const sshUsername = "mohkof1106";  // Standard user on all controllers
    const sshPassword = "Solar@1996";  // Standard password (should be per-controller in production)

    // Update controller with SSH settings
    const { error: updateError } = await supabase
      .from("controllers")
      .update({
        ssh_tunnel_port: allocatedPort,
        ssh_username: sshUsername,
        ssh_password: sshPassword,
        ssh_tunnel_active: false,  // Will be set to true after setup
      })
      .eq("id", controllerId);

    if (updateError) {
      console.error("Error updating controller:", updateError);
      return NextResponse.json(
        { error: "Failed to save SSH configuration" },
        { status: 500 }
      );
    }

    // Generate the setup script
    const setupScript = generateSSHSetupScript(
      allocatedPort,
      sshUsername,
      controller.serial_number
    );

    return NextResponse.json({
      success: true,
      ssh_tunnel_port: allocatedPort,
      ssh_username: sshUsername,
      central_server: CENTRAL_SERVER_IP,
      setup_script: setupScript,
      connection_command: `ssh -p ${allocatedPort} ${sshUsername}@localhost`,
      full_command: `ssh root@${CENTRAL_SERVER_IP} "sshpass -p '${sshPassword}' ssh -p ${allocatedPort} ${sshUsername}@localhost '<command>'"`,
    });
  } catch (error) {
    console.error("SSH setup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Generate the SSH setup script to run on the controller
 */
function generateSSHSetupScript(
  tunnelPort: number,
  username: string,
  serialNumber: string
): string {
  return `#!/bin/bash
# Volteria SSH Tunnel Setup Script
# Controller: ${serialNumber}
# Port: ${tunnelPort}

set -e

echo "=== Setting up persistent SSH tunnel for Volteria ==="

# Install autossh if not present
if ! command -v autossh &> /dev/null; then
    echo "Installing autossh..."
    sudo apt-get update && sudo apt-get install -y autossh
fi

# Generate SSH key if not exists
if [ ! -f ~/.ssh/id_rsa ]; then
    echo "Generating SSH key..."
    ssh-keygen -t rsa -b 4096 -N "" -f ~/.ssh/id_rsa
fi

# Create the systemd service file
echo "Creating systemd service..."
sudo tee /etc/systemd/system/volteria-tunnel.service > /dev/null << 'EOF'
[Unit]
Description=Volteria SSH Reverse Tunnel
After=network-online.target
Wants=network-online.target

[Service]
User=${username}
Type=simple
ExecStart=/usr/bin/autossh -M 0 -N -o "ServerAliveInterval 30" -o "ServerAliveCountMax 3" -o "ExitOnForwardFailure yes" -o "StrictHostKeyChecking no" -R ${tunnelPort}:localhost:22 root@${CENTRAL_SERVER_IP}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable volteria-tunnel.service
sudo systemctl start volteria-tunnel.service

echo ""
echo "=== SSH Tunnel Setup Complete ==="
echo "Port: ${tunnelPort}"
echo "Username: ${username}"
echo ""
echo "IMPORTANT: Add this public key to the central server:"
echo "---"
cat ~/.ssh/id_rsa.pub
echo "---"
echo ""
echo "Run this on the central server (159.223.224.203):"
echo "  echo '<paste-key-here>' >> ~/.ssh/authorized_keys"
echo ""
`;
}
