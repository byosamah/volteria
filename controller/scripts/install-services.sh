#!/bin/bash
#
# Volteria Controller Service Installation Script
# This script installs and configures the systemd services
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTROLLER_DIR="$(dirname "$SCRIPT_DIR")"
SYSTEMD_DIR="$CONTROLLER_DIR/systemd"
INSTALL_DIR="/opt/volteria"
CONFIG_DIR="/etc/volteria"
DATA_DIR="/opt/volteria/data"
LOG_DIR="/var/log/volteria"

echo -e "${GREEN}Volteria Controller Service Installation${NC}"
echo "========================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run as root${NC}"
    exit 1
fi

# Step 1: Create volteria user if not exists
echo -e "${YELLOW}Step 1: Creating volteria user...${NC}"
if ! id -u volteria > /dev/null 2>&1; then
    useradd -r -s /bin/false -d /opt/volteria volteria
    echo "Created user 'volteria'"
else
    echo "User 'volteria' already exists"
fi

# Step 2: Create directories
echo -e "${YELLOW}Step 2: Creating directories...${NC}"
mkdir -p "$INSTALL_DIR"
mkdir -p "$CONFIG_DIR"
mkdir -p "$DATA_DIR/state"
mkdir -p "$DATA_DIR/config_history"
mkdir -p "$LOG_DIR"

# Step 3: Copy controller files
echo -e "${YELLOW}Step 3: Copying controller files...${NC}"
cp -r "$CONTROLLER_DIR"/* "$INSTALL_DIR/controller/"

# Step 4: Create virtual environment
echo -e "${YELLOW}Step 4: Setting up Python virtual environment...${NC}"
if [ ! -d "$INSTALL_DIR/venv" ]; then
    python3 -m venv "$INSTALL_DIR/venv"
    "$INSTALL_DIR/venv/bin/pip" install --upgrade pip
fi
"$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/controller/requirements.txt"

# Step 5: Install systemd services
echo -e "${YELLOW}Step 5: Installing systemd services...${NC}"
for service in volteria-supervisor volteria-system volteria-config volteria-device volteria-control volteria-logging; do
    cp "$SYSTEMD_DIR/${service}.service" /etc/systemd/system/
    echo "Installed ${service}.service"
done

# Step 6: Install sudoers configuration
echo -e "${YELLOW}Step 6: Installing sudoers configuration...${NC}"
cp "$SYSTEMD_DIR/volteria-sudoers" /etc/sudoers.d/volteria
chmod 440 /etc/sudoers.d/volteria
visudo -c # Validate sudoers file
echo "Installed sudoers configuration"

# Step 7: Create environment file if not exists
echo -e "${YELLOW}Step 7: Setting up environment file...${NC}"
if [ ! -f "$CONFIG_DIR/env" ]; then
    cp "$SYSTEMD_DIR/volteria.env.template" "$CONFIG_DIR/env"
    chmod 600 "$CONFIG_DIR/env"
    echo -e "${YELLOW}WARNING: Please edit $CONFIG_DIR/env with your configuration${NC}"
else
    echo "Environment file already exists"
fi

# Step 8: Set permissions
echo -e "${YELLOW}Step 8: Setting permissions...${NC}"
chown -R volteria:volteria "$INSTALL_DIR"
chown -R volteria:volteria "$CONFIG_DIR"
chown -R volteria:volteria "$DATA_DIR"
chown -R volteria:volteria "$LOG_DIR"
chmod 700 "$CONFIG_DIR"
chmod 600 "$CONFIG_DIR/env"

# Step 9: Reload systemd
echo -e "${YELLOW}Step 9: Reloading systemd...${NC}"
systemctl daemon-reload

# Step 10: Enable services
echo -e "${YELLOW}Step 10: Enabling services...${NC}"
systemctl enable volteria-supervisor
echo "Services enabled"

echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Edit $CONFIG_DIR/env with your Supabase credentials"
echo "2. Edit $CONFIG_DIR/config.yaml with your site configuration"
echo "3. Start the supervisor: systemctl start volteria-supervisor"
echo "4. Check status: systemctl status volteria-supervisor"
echo ""
echo "Useful commands:"
echo "  systemctl start volteria-supervisor   # Start all services"
echo "  systemctl stop volteria-supervisor    # Stop all services"
echo "  journalctl -u volteria-supervisor -f  # View logs"
echo ""
