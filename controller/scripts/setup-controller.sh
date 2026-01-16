#!/bin/bash
#
# Volteria Controller Setup Script
# Version: 2.0.0
#
# This script installs the 5-layer Volteria controller architecture on a Raspberry Pi.
# It can be run for fresh installs or updates to existing installations.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/byosamah/volteria/main/controller/scripts/setup-controller.sh | bash
#
# Or download and run:
#   wget https://raw.githubusercontent.com/byosamah/volteria/main/controller/scripts/setup-controller.sh
#   chmod +x setup-controller.sh
#   sudo ./setup-controller.sh
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
VOLTERIA_VERSION="2.0.0"
VOLTERIA_DIR="/opt/volteria"
CONTROLLER_DIR="${VOLTERIA_DIR}/controller"
DATA_DIR="${VOLTERIA_DIR}/data"
CONFIG_DIR="/etc/volteria"
SYSTEMD_DIR="/etc/systemd/system"
GITHUB_REPO="https://github.com/byosamah/volteria.git"
CENTRAL_SERVER="159.223.224.203"

# Logging
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "\n${BLUE}==>${NC} $1"
}

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Get Raspberry Pi serial number
get_serial_number() {
    SERIAL=$(cat /proc/cpuinfo | grep Serial | cut -d ' ' -f 2 | tail -c 17)
    if [[ -z "$SERIAL" ]]; then
        SERIAL="unknown-$(hostname)"
    fi
    echo "$SERIAL"
}

# Detect hardware type
detect_hardware() {
    if [[ -b /dev/nvme0n1 ]]; then
        echo "SOL564-NVME16-128"
    else
        echo "raspberry_pi_5"
    fi
}

# Check system requirements
check_requirements() {
    log_step "Checking system requirements..."

    # Check OS
    if [[ ! -f /etc/os-release ]]; then
        log_error "Cannot determine OS. This script requires Raspberry Pi OS."
        exit 1
    fi

    source /etc/os-release
    if [[ "$ID" != "raspbian" && "$ID" != "debian" ]]; then
        log_warn "This script is designed for Raspberry Pi OS (Debian-based). Detected: $ID"
    fi

    # Check architecture
    ARCH=$(uname -m)
    if [[ "$ARCH" != "aarch64" && "$ARCH" != "armv7l" ]]; then
        log_warn "Expected ARM architecture. Detected: $ARCH"
    fi

    # Check memory
    TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
    if [[ $TOTAL_MEM -lt 1024 ]]; then
        log_warn "Low memory detected: ${TOTAL_MEM}MB. Recommended: 2GB+"
    fi

    log_info "System check passed"
}

# Install system dependencies
install_dependencies() {
    log_step "Installing system dependencies..."

    apt-get update
    apt-get install -y \
        python3 \
        python3-pip \
        python3-venv \
        git \
        sqlite3 \
        autossh \
        sshpass \
        curl \
        jq \
        network-manager

    log_info "System dependencies installed"
}

# Configure network settings (timezone only)
configure_network() {
    log_step "Configuring network settings..."

    # Set timezone to Asia/Dubai (UAE)
    timedatectl set-timezone Asia/Dubai
    log_info "Timezone set to Asia/Dubai"

    # WiFi: Configured via Raspberry Pi Imager (DHCP) - don't touch
    # Ethernet: NOT configured here - each site has different requirements
    #
    # To manually configure ethernet later (example):
    #   sudo nmcli con add type ethernet con-name "Modbus" ifname eth0 \
    #       ipv4.addresses "192.168.1.100/24" ipv4.method manual
    #   sudo nmcli con up "Modbus"
    #
    # Note: Don't set gateway on ethernet if using WiFi for internet

    # Display current IPs
    CURRENT_IPS=$(hostname -I)
    log_info "Current IP addresses: ${CURRENT_IPS}"
    log_info "Ethernet not configured (set up manually per site requirements)"
}

# Create directory structure
create_directories() {
    log_step "Creating directory structure..."

    mkdir -p "${VOLTERIA_DIR}"
    mkdir -p "${DATA_DIR}/config_history"
    mkdir -p "${CONFIG_DIR}"
    mkdir -p "${VOLTERIA_DIR}/updates"
    mkdir -p "${VOLTERIA_DIR}/logs"
    mkdir -p "${VOLTERIA_DIR}/backup"
    mkdir -p /var/log/volteria

    # State directory on tmpfs (RAM) to reduce SSD wear
    # State files are ephemeral and don't need persistence
    mkdir -p /run/volteria/state

    # Create fallback directory on disk (for development/testing)
    mkdir -p "${DATA_DIR}/state"

    log_info "Directory structure created"
}

# Configure tmpfs for state directory (reduces SSD writes by ~95%)
configure_tmpfs_state() {
    log_step "Configuring tmpfs for state directory..."

    # Create tmpfiles.d config for persistence across reboots
    cat > /etc/tmpfiles.d/volteria.conf << 'EOF'
# Volteria state directory on tmpfs
# Reduces SSD wear by keeping ephemeral state files in RAM
d /run/volteria 0755 volteria volteria -
d /run/volteria/state 0755 volteria volteria -
EOF

    # Create the directory now (tmpfiles.d runs on boot)
    mkdir -p /run/volteria/state
    chown -R volteria:volteria /run/volteria

    log_info "State directory configured on tmpfs (/run/volteria/state)"
}

# Clone or update controller code
setup_controller_code() {
    log_step "Setting up controller code..."

    if [[ -d "${CONTROLLER_DIR}/.git" ]]; then
        log_info "Updating existing installation..."
        cd "${CONTROLLER_DIR}"
        git fetch origin
        git reset --hard origin/main
        git pull origin main
    else
        log_info "Fresh installation - cloning repository..."
        rm -rf "${CONTROLLER_DIR}"

        # Clone full repo then extract controller
        TEMP_DIR=$(mktemp -d)
        git clone --depth 1 "${GITHUB_REPO}" "${TEMP_DIR}"
        mv "${TEMP_DIR}/controller" "${CONTROLLER_DIR}"
        rm -rf "${TEMP_DIR}"
    fi

    log_info "Controller code ready"
}

# Setup Python virtual environment
setup_python_env() {
    log_step "Setting up Python environment..."

    VENV_DIR="${VOLTERIA_DIR}/venv"

    # Create virtual environment if it doesn't exist
    if [[ ! -d "${VENV_DIR}" ]]; then
        python3 -m venv "${VENV_DIR}"
    fi

    # Activate and install dependencies
    source "${VENV_DIR}/bin/activate"
    pip install --upgrade pip
    pip install -r "${CONTROLLER_DIR}/requirements.txt"

    deactivate

    log_info "Python environment ready at ${VENV_DIR}"
}

# Create environment file for systemd services
create_env_file() {
    log_step "Creating environment file..."

    ENV_FILE="${CONFIG_DIR}/env"

    # Create env file with placeholder values
    cat > "${ENV_FILE}" << EOF
# Volteria Controller Environment Variables
# Generated by setup script on $(date)

# Supabase Configuration (will be populated during registration)
SUPABASE_URL=https://usgxhzdctzthcqxyxfxl.supabase.co
SUPABASE_SERVICE_KEY=

# Controller Identity (populated after cloud registration)
CONTROLLER_ID=
SITE_ID=

# Paths
VOLTERIA_CONFIG_PATH=${CONFIG_DIR}/config.yaml
VOLTERIA_DATA_PATH=${DATA_DIR}
EOF

    chmod 600 "${ENV_FILE}"
    chown volteria:volteria "${ENV_FILE}"

    log_info "Environment file created at ${ENV_FILE}"
}

# Create volteria user
create_volteria_user() {
    log_step "Creating volteria user..."

    if id "volteria" &>/dev/null; then
        log_info "User 'volteria' already exists"
    else
        useradd -r -s /bin/false -d "${VOLTERIA_DIR}" volteria
        log_info "User 'volteria' created"
    fi

    # Set ownership
    chown -R volteria:volteria "${VOLTERIA_DIR}"
    chown -R volteria:volteria "${DATA_DIR}"
    chown -R volteria:volteria "${VOLTERIA_DIR}/backup"
    chown -R volteria:volteria /var/log/volteria

    # Add volteria to dialout group for serial access
    usermod -a -G dialout volteria || true
}

# Setup sudoers for volteria service operations
setup_sudoers() {
    log_step "Setting up sudoers..."

    cat > /etc/sudoers.d/volteria << 'EOF'
# Volteria controller permissions - service user
volteria ALL=(ALL) NOPASSWD: /sbin/reboot
volteria ALL=(ALL) NOPASSWD: /bin/systemctl restart volteria-*
volteria ALL=(ALL) NOPASSWD: /bin/systemctl stop volteria-*
volteria ALL=(ALL) NOPASSWD: /bin/systemctl start volteria-*
volteria ALL=(ALL) NOPASSWD: /bin/systemctl status volteria-*
volteria ALL=(ALL) NOPASSWD: /bin/systemctl daemon-reload

# Volteria admin user (SSH access) - for remote management
voltadmin ALL=(ALL) NOPASSWD: /sbin/reboot
voltadmin ALL=(ALL) NOPASSWD: /bin/systemctl restart volteria-*
voltadmin ALL=(ALL) NOPASSWD: /bin/systemctl stop volteria-*
voltadmin ALL=(ALL) NOPASSWD: /bin/systemctl start volteria-*
voltadmin ALL=(ALL) NOPASSWD: /bin/systemctl status volteria-*
voltadmin ALL=(ALL) NOPASSWD: /bin/systemctl daemon-reload
EOF

    chmod 440 /etc/sudoers.d/volteria

    log_info "Sudoers configured"
}

# Install systemd services
install_systemd_services() {
    log_step "Installing systemd services..."

    # Copy service files
    cp "${CONTROLLER_DIR}/systemd/"*.service "${SYSTEMD_DIR}/"

    # Reload systemd
    systemctl daemon-reload

    # Enable services (but don't start yet)
    # The supervisor manages the other services, so it must be enabled
    systemctl enable volteria-supervisor.service
    systemctl enable volteria-system.service
    systemctl enable volteria-config.service
    systemctl enable volteria-device.service
    systemctl enable volteria-control.service
    systemctl enable volteria-logging.service

    log_info "Systemd services installed and enabled"
}

# Disable cloud-init (causes shutdown issues, not needed for controller)
disable_cloud_init() {
    log_step "Disabling cloud-init..."

    # Cloud-init interferes with clean shutdown/reboot and isn't needed
    # This prevents kernel panic during reboot
    touch /etc/cloud/cloud-init.disabled 2>/dev/null || true
    systemctl mask cloud-init cloud-init-local cloud-config cloud-final 2>/dev/null || true
    systemctl disable cloud-init cloud-init-local cloud-config cloud-final 2>/dev/null || true

    log_info "Cloud-init disabled"
}

# Generate configuration file
generate_config() {
    log_step "Generating configuration..."

    SERIAL=$(get_serial_number)
    HARDWARE=$(detect_hardware)

    # Check if config already exists
    if [[ -f "${CONFIG_DIR}/config.yaml" ]]; then
        log_info "Configuration file already exists, preserving..."
        return
    fi

    # Generate new config
    cat > "${CONFIG_DIR}/config.yaml" << EOF
# Volteria Controller Configuration
# Auto-generated by setup script v${VOLTERIA_VERSION}
# Serial: ${SERIAL}
# Hardware: ${HARDWARE}

controller:
  id: ""
  serial_number: "${SERIAL}"
  hardware_type: "${HARDWARE}"
  firmware_version: "${VOLTERIA_VERSION}"

cloud:
  url: "https://usgxhzdctzthcqxyxfxl.supabase.co"
  # Key will be set during registration
  key: ""
  sync_interval_s: 300

services:
  system:
    heartbeat_interval_s: 30
    health_check_interval_s: 10
  control:
    interval_ms: 1000
  logging:
    local_write_interval_s: 10
    cloud_sync_interval_s: 120
    local_retention_days: 7

# Site configuration will be synced from cloud after registration
EOF

    chmod 600 "${CONFIG_DIR}/config.yaml"
    chown volteria:volteria "${CONFIG_DIR}/config.yaml"

    log_info "Configuration generated at ${CONFIG_DIR}/config.yaml"
}

# Setup SSH tunnel service
# Note: SSH tunnel is set up AFTER registration, when we have the assigned port
setup_ssh_tunnel() {
    log_step "Setting up SSH tunnel service..."

    # SSH user and password for central server (standard password for all controllers)
    SSH_USER="volteria"
    SSH_PASSWORD="VoltTunnel@2026"

    # Create SSH tunnel service template using sshpass for password auth
    # Port will be set to SSH_TUNNEL_PORT (set during registration)
    cat > "${SYSTEMD_DIR}/volteria-tunnel.service" << EOF
[Unit]
Description=Volteria SSH Reverse Tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/sshpass -p '${SSH_PASSWORD}' /usr/bin/ssh -N -o "ServerAliveInterval 30" -o "ServerAliveCountMax 3" -o "ExitOnForwardFailure yes" -o "StrictHostKeyChecking no" -o "UserKnownHostsFile=/dev/null" -R SSH_TUNNEL_PORT:localhost:22 ${SSH_USER}@${CENTRAL_SERVER}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    # Don't enable yet - will be enabled after registration sets the port
    log_info "SSH tunnel service template created (will be configured during registration)"
}

# Generate SSH key for remote access
generate_ssh_key() {
    log_step "Generating SSH key for remote access..."

    SSH_KEY_PATH="/root/.ssh/volteria_tunnel"

    # Generate key if it doesn't exist
    if [[ ! -f "${SSH_KEY_PATH}" ]]; then
        mkdir -p /root/.ssh
        chmod 700 /root/.ssh
        ssh-keygen -t ed25519 -f "${SSH_KEY_PATH}" -N "" -C "volteria-$(get_serial_number)"
        log_info "SSH key generated: ${SSH_KEY_PATH}"
    else
        log_info "SSH key already exists: ${SSH_KEY_PATH}"
    fi

    # Read public key (trim whitespace/newlines)
    SSH_PUBLIC_KEY=$(cat "${SSH_KEY_PATH}.pub" 2>/dev/null | tr -d '\n\r' || echo "")
    echo "$SSH_PUBLIC_KEY"
}

# Register controller with cloud and set up SSH tunnel
register_controller() {
    log_step "Registering controller with cloud..."

    SERIAL=$(get_serial_number)
    HARDWARE=$(detect_hardware)

    log_info "Serial Number: ${SERIAL}"
    log_info "Hardware Type: ${HARDWARE}"

    # Try to register with cloud API
    REGISTER_URL="https://volteria.org/api/controllers/register"

    RESPONSE=$(curl -s -X POST "${REGISTER_URL}" \
        -H "Content-Type: application/json" \
        -d "{
            \"serial_number\": \"${SERIAL}\",
            \"hardware_type\": \"${HARDWARE}\",
            \"firmware_version\": \"${VOLTERIA_VERSION}\"
        }" 2>/dev/null || echo '{"error": "Connection failed"}')

    if echo "$RESPONSE" | jq -e '.controller_id' > /dev/null 2>&1; then
        CONTROLLER_ID=$(echo "$RESPONSE" | jq -r '.controller_id')
        SSH_PORT=$(echo "$RESPONSE" | jq -r '.ssh_tunnel_port // empty')
        SUPABASE_KEY=$(echo "$RESPONSE" | jq -r '.supabase_key // empty')
        SUPABASE_URL=$(echo "$RESPONSE" | jq -r '.supabase_url // empty')

        log_info "Controller registered: ${CONTROLLER_ID}"

        # Update config with controller ID
        if [[ -n "$CONTROLLER_ID" ]]; then
            # Update the config.yaml with controller ID (under controller: section)
            sed -i "s/^  id: \"\"$/  id: \"${CONTROLLER_ID}\"/" "${CONFIG_DIR}/config.yaml" 2>/dev/null || true
            log_info "Controller ID set in config: ${CONTROLLER_ID}"
        fi

        # Update env file with registration info
        if [[ -n "$CONTROLLER_ID" ]]; then
            sed -i "s/^CONTROLLER_ID=$/CONTROLLER_ID=${CONTROLLER_ID}/" "${CONFIG_DIR}/env"
            log_info "Controller ID set in env file"
        fi
        if [[ -n "$SUPABASE_KEY" ]]; then
            sed -i "s/^SUPABASE_SERVICE_KEY=$/SUPABASE_SERVICE_KEY=${SUPABASE_KEY}/" "${CONFIG_DIR}/env"
            log_info "Supabase key set in env file"
        fi

        # Configure and start SSH tunnel if port assigned
        if [[ -n "$SSH_PORT" && "$SSH_PORT" != "null" && "$SSH_PORT" != "0" ]]; then
            log_info "SSH tunnel port assigned: ${SSH_PORT}"

            # Update the tunnel service with the actual port
            sed -i "s/SSH_TUNNEL_PORT/${SSH_PORT}/" "${SYSTEMD_DIR}/volteria-tunnel.service"
            systemctl daemon-reload

            # Enable and start the tunnel
            systemctl enable volteria-tunnel.service
            log_info "Starting SSH tunnel on port ${SSH_PORT}..."
            systemctl start volteria-tunnel.service

            # Wait a moment and check if tunnel started
            sleep 3
            if systemctl is-active --quiet volteria-tunnel.service; then
                log_info "SSH tunnel started successfully"
                log_info "Remote access: ssh -p ${SSH_PORT} voltadmin@${CENTRAL_SERVER}"
            else
                log_warn "SSH tunnel failed to start - check journalctl -u volteria-tunnel for details"
            fi
        else
            log_warn "No SSH port assigned - tunnel not configured"
        fi
    else
        log_warn "Could not register with cloud automatically"
        log_warn "Response: ${RESPONSE}"
        log_warn "Controller will need to be registered manually via the admin wizard"
    fi
}

# Start services
start_services() {
    log_step "Starting Volteria services..."

    # Start services in order (layer by layer)
    log_info "Starting system service (Layer 1)..."
    systemctl start volteria-system.service
    sleep 3

    log_info "Starting config service (Layer 2)..."
    systemctl start volteria-config.service
    sleep 2

    log_info "Starting device service (Layer 3)..."
    systemctl start volteria-device.service
    sleep 2

    log_info "Starting control service (Layer 4)..."
    systemctl start volteria-control.service
    sleep 2

    log_info "Starting logging service (Layer 5)..."
    systemctl start volteria-logging.service
    sleep 2

    # SSH tunnel is started during registration (register_controller function)
    # Check if it's running
    if systemctl is-active --quiet volteria-tunnel.service; then
        log_info "SSH tunnel: Running"
    else
        log_info "SSH tunnel: Not running (will be configured after registration)"
    fi

    log_info "All services started"
}

# Verify installation
verify_installation() {
    log_step "Verifying installation..."

    ERRORS=0

    # Check services
    for service in system config device control logging; do
        if systemctl is-active --quiet "volteria-${service}.service"; then
            log_info "volteria-${service}: Running"
        else
            log_error "volteria-${service}: Not running"
            ERRORS=$((ERRORS + 1))
        fi
    done

    # Wait for services to initialize
    sleep 5

    # Check health endpoints
    for port in 8081 8082 8083 8084 8085; do
        STATUS=$(curl -s "http://127.0.0.1:${port}/health" 2>/dev/null | jq -r '.status // "error"')
        if [[ "$STATUS" == "healthy" ]]; then
            log_info "Health check port ${port}: OK"
        else
            log_warn "Health check port ${port}: ${STATUS} (may still be initializing)"
        fi
    done

    if [[ $ERRORS -eq 0 ]]; then
        log_info "Installation verified successfully"
    else
        log_error "Installation completed with ${ERRORS} errors"
        log_error "Check logs: journalctl -u volteria-system -n 50"
    fi
}

# Print summary
print_summary() {
    SERIAL=$(get_serial_number)
    HARDWARE=$(detect_hardware)

    echo ""
    echo "=============================================="
    echo -e "${GREEN}  Volteria Controller Setup Complete${NC}"
    echo "=============================================="
    echo ""
    echo "  Version:      ${VOLTERIA_VERSION}"
    echo "  Serial:       ${SERIAL}"
    echo "  Hardware:     ${HARDWARE}"
    echo ""
    echo "  Installation: ${VOLTERIA_DIR}"
    echo "  Config:       ${CONFIG_DIR}/config.yaml"
    echo "  Data:         ${DATA_DIR}"
    echo ""
    echo "  5-Layer Service Architecture:"
    echo "    Layer 1: volteria-system   (8081) - Heartbeat, OTA, Health"
    echo "    Layer 2: volteria-config   (8082) - Cloud config sync"
    echo "    Layer 3: volteria-device   (8083) - Modbus I/O"
    echo "    Layer 4: volteria-control  (8084) - Zero-feeding algorithm"
    echo "    Layer 5: volteria-logging  (8085) - Data logging & sync"
    echo "    Tunnel:  volteria-tunnel          - SSH remote access"
    echo ""
    echo "  Useful commands:"
    echo "    sudo systemctl status volteria-*"
    echo "    sudo journalctl -u volteria-control -f"
    echo "    cat ${DATA_DIR}/state/readings.json | jq"
    echo "    curl http://127.0.0.1:8081/health | jq"
    echo ""
    echo "  The controller will appear in the Volteria platform"
    echo "  once it sends its first heartbeat (within 30 seconds)."
    echo ""
    echo "=============================================="
}

# Main installation flow
main() {
    echo ""
    echo "=============================================="
    echo "   Volteria Controller Setup v${VOLTERIA_VERSION}"
    echo "   5-Layer Service Architecture"
    echo "=============================================="
    echo ""

    check_root
    check_requirements
    install_dependencies
    configure_network
    create_directories
    setup_controller_code
    setup_python_env
    create_volteria_user
    configure_tmpfs_state
    setup_sudoers
    generate_config
    create_env_file
    install_systemd_services
    disable_cloud_init
    setup_ssh_tunnel
    register_controller
    start_services
    verify_installation
    print_summary
}

# Run main
main "$@"
