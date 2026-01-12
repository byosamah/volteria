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

# Configure network settings (timezone, static IP option)
configure_network() {
    log_step "Configuring network settings..."

    # Set timezone to Asia/Dubai (UAE)
    timedatectl set-timezone Asia/Dubai
    log_info "Timezone set to Asia/Dubai"

    # Enable NetworkManager if not already enabled
    systemctl enable NetworkManager 2>/dev/null || true
    systemctl start NetworkManager 2>/dev/null || true

    # Check if static IP is requested via environment variable
    # Usage: STATIC_IP=192.168.1.100 GATEWAY=192.168.1.1 ./setup-controller.sh
    if [[ -n "${STATIC_IP}" ]]; then
        log_info "Configuring static IP: ${STATIC_IP}"

        # Get the active connection name
        CONN_NAME=$(nmcli -t -f NAME,DEVICE con show --active | head -1 | cut -d: -f1)

        if [[ -n "$CONN_NAME" ]]; then
            GATEWAY=${GATEWAY:-$(echo $STATIC_IP | cut -d. -f1-3).1}
            DNS=${DNS:-8.8.8.8,8.8.4.4}

            nmcli con mod "$CONN_NAME" ipv4.addresses "${STATIC_IP}/24"
            nmcli con mod "$CONN_NAME" ipv4.gateway "$GATEWAY"
            nmcli con mod "$CONN_NAME" ipv4.dns "$DNS"
            nmcli con mod "$CONN_NAME" ipv4.method manual
            nmcli con up "$CONN_NAME"

            log_info "Static IP configured: ${STATIC_IP}, Gateway: ${GATEWAY}"
        else
            log_warn "No active connection found. Static IP not configured."
        fi
    else
        log_info "Using DHCP (set STATIC_IP env var for static IP)"
    fi

    # Display current IP
    CURRENT_IP=$(hostname -I | awk '{print $1}')
    log_info "Current IP address: ${CURRENT_IP}"
}

# Create directory structure
create_directories() {
    log_step "Creating directory structure..."

    mkdir -p "${VOLTERIA_DIR}"
    mkdir -p "${DATA_DIR}/state"
    mkdir -p "${DATA_DIR}/config_history"
    mkdir -p "${CONFIG_DIR}"
    mkdir -p "${VOLTERIA_DIR}/updates"
    mkdir -p "${VOLTERIA_DIR}/logs"
    mkdir -p /var/log/volteria

    log_info "Directory structure created"
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
    chown -R volteria:volteria /var/log/volteria

    # Add volteria to dialout group for serial access
    usermod -a -G dialout volteria || true
}

# Setup sudoers for volteria service operations
setup_sudoers() {
    log_step "Setting up sudoers..."

    cat > /etc/sudoers.d/volteria << 'EOF'
# Volteria controller permissions
volteria ALL=(ALL) NOPASSWD: /sbin/reboot
volteria ALL=(ALL) NOPASSWD: /bin/systemctl restart volteria-*
volteria ALL=(ALL) NOPASSWD: /bin/systemctl stop volteria-*
volteria ALL=(ALL) NOPASSWD: /bin/systemctl start volteria-*
volteria ALL=(ALL) NOPASSWD: /bin/systemctl status volteria-*
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
    systemctl enable volteria-system.service
    systemctl enable volteria-config.service
    systemctl enable volteria-device.service
    systemctl enable volteria-control.service
    systemctl enable volteria-logging.service

    log_info "Systemd services installed and enabled"
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
setup_ssh_tunnel() {
    log_step "Setting up SSH tunnel service..."

    # Get current user (the one who ran sudo)
    REAL_USER="${SUDO_USER:-pi}"

    # Generate SSH key if not exists
    if [[ ! -f "/home/${REAL_USER}/.ssh/id_rsa" ]]; then
        log_info "Generating SSH key..."
        sudo -u "${REAL_USER}" mkdir -p "/home/${REAL_USER}/.ssh"
        sudo -u "${REAL_USER}" ssh-keygen -t rsa -b 4096 -N "" -f "/home/${REAL_USER}/.ssh/id_rsa"
    fi

    # Create SSH tunnel service template (port will be updated during registration)
    cat > "${SYSTEMD_DIR}/volteria-tunnel.service" << EOF
[Unit]
Description=Volteria SSH Reverse Tunnel
After=network-online.target
Wants=network-online.target

[Service]
User=${REAL_USER}
Type=simple
ExecStart=/usr/bin/autossh -M 0 -N -o "ServerAliveInterval 30" -o "ServerAliveCountMax 3" -o "ExitOnForwardFailure yes" -o "StrictHostKeyChecking no" -R 0:localhost:22 root@${CENTRAL_SERVER}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable volteria-tunnel.service

    log_info "SSH tunnel service configured"

    # Display public key for adding to central server
    echo ""
    echo "=============================================="
    echo "SSH Public Key (add to central server):"
    echo "=============================================="
    cat "/home/${REAL_USER}/.ssh/id_rsa.pub"
    echo ""
    echo "Run on central server (${CENTRAL_SERVER}):"
    echo "  echo '<key>' >> ~/.ssh/authorized_keys"
    echo "=============================================="
    echo ""
}

# Register controller with cloud
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

        log_info "Controller registered: ${CONTROLLER_ID}"

        # Update config with controller ID
        if [[ -n "$CONTROLLER_ID" ]]; then
            sed -i "/serial_number:/a\\  id: \"${CONTROLLER_ID}\"" "${CONFIG_DIR}/config.yaml"
        fi

        # Update Supabase key if provided
        if [[ -n "$SUPABASE_KEY" && "$SUPABASE_KEY" != "null" ]]; then
            sed -i "s/key: \"\"/key: \"${SUPABASE_KEY}\"/" "${CONFIG_DIR}/config.yaml"
        fi

        # Update SSH tunnel port if assigned
        if [[ -n "$SSH_PORT" && "$SSH_PORT" != "null" ]]; then
            log_info "SSH tunnel port assigned: ${SSH_PORT}"
            sed -i "s/-R 0:localhost:22/-R ${SSH_PORT}:localhost:22/" "${SYSTEMD_DIR}/volteria-tunnel.service"
            systemctl daemon-reload
        fi
    else
        log_warn "Could not register with cloud automatically"
        log_warn "Controller will register on first heartbeat"
        log_warn "Or complete registration in the admin wizard"
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

    # Start SSH tunnel (may fail if key not added to central server)
    log_info "Starting SSH tunnel..."
    systemctl start volteria-tunnel.service 2>/dev/null || log_warn "SSH tunnel not started (key may not be on central server yet)"

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
    setup_sudoers
    generate_config
    create_env_file
    install_systemd_services
    setup_ssh_tunnel
    register_controller
    start_services
    verify_installation
    print_summary
}

# Run main
main "$@"
