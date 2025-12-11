#!/bin/bash
# =============================================================================
# Volteria Controller Setup Script
# =============================================================================
#
# This script installs and configures the Volteria controller software on a
# fresh Raspberry Pi OS Lite (64-bit) installation.
#
# Usage:
#   curl -sSL https://github.com/byosamah/volteria/releases/download/v1.0.0-controller/setup-controller.sh | bash
#
# Or download and run:
#   chmod +x setup-controller.sh
#   ./setup-controller.sh
#
# Requirements:
#   - Raspberry Pi 5 (recommended) or Pi 4
#   - Raspberry Pi OS Lite (64-bit)
#   - Network connection (Ethernet recommended)
#   - 16GB+ SD card
#
# =============================================================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "=============================================="
echo "   Volteria Controller Setup v1.0.0"
echo "=============================================="
echo ""

# Check if running on Raspberry Pi
if [ ! -f /proc/device-tree/model ]; then
    echo -e "${YELLOW}Warning: This doesn't appear to be a Raspberry Pi${NC}"
    echo "Continuing anyway..."
fi

# Check if running as root or with sudo
if [ "$EUID" -eq 0 ]; then
    echo -e "${RED}Error: Do not run this script as root!${NC}"
    echo "Run it as a normal user (pi). The script will use sudo when needed."
    exit 1
fi

echo -e "${GREEN}Step 1/9:${NC} Updating system packages..."
sudo apt update
sudo apt upgrade -y

echo ""
echo -e "${GREEN}Step 2/9:${NC} Installing system dependencies..."
# Note: python3.11 may be named python3 on newer Raspberry Pi OS versions
if command -v python3.11 &> /dev/null; then
    PYTHON_CMD="python3.11"
elif command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version | cut -d' ' -f2 | cut -d'.' -f1,2)
    if [ "$(echo "$PYTHON_VERSION >= 3.11" | bc)" -eq 1 ] 2>/dev/null || [ "$PYTHON_VERSION" = "3.11" ] || [ "$PYTHON_VERSION" = "3.12" ]; then
        PYTHON_CMD="python3"
    else
        echo -e "${YELLOW}Installing Python 3.11...${NC}"
        sudo apt install -y python3.11 python3.11-venv
        PYTHON_CMD="python3.11"
    fi
else
    sudo apt install -y python3.11 python3.11-venv
    PYTHON_CMD="python3.11"
fi

sudo apt install -y python3-pip python3-venv git sqlite3

echo ""
echo -e "${GREEN}Step 3/9:${NC} Creating volteria system user..."
if id "volteria" &>/dev/null; then
    echo "User 'volteria' already exists"
else
    sudo useradd -m -s /bin/bash volteria
    echo "Created user 'volteria'"
fi

echo ""
echo -e "${GREEN}Step 4/9:${NC} Creating directory structure..."
sudo mkdir -p /opt/volteria /etc/volteria /data
sudo chown volteria:volteria /opt/volteria /data
echo "Created: /opt/volteria, /etc/volteria, /data"

echo ""
echo -e "${GREEN}Step 5/9:${NC} Cloning Volteria repository..."
if [ -d "/opt/volteria/repo" ]; then
    echo "Repository already exists, updating..."
    sudo -u volteria git -C /opt/volteria/repo pull
else
    sudo -u volteria git clone https://github.com/byosamah/volteria.git /opt/volteria/repo
fi

# Create symlink to controller directory
if [ ! -L "/opt/volteria/controller" ]; then
    sudo -u volteria ln -s /opt/volteria/repo/controller /opt/volteria/controller
fi

echo ""
echo -e "${GREEN}Step 6/9:${NC} Setting up Python virtual environment..."
if [ ! -d "/opt/volteria/venv" ]; then
    sudo -u volteria $PYTHON_CMD -m venv /opt/volteria/venv
fi

echo "Installing Python dependencies..."
sudo -u volteria /opt/volteria/venv/bin/pip install --upgrade pip
sudo -u volteria /opt/volteria/venv/bin/pip install -r /opt/volteria/controller/requirements.txt

echo ""
echo -e "${GREEN}Step 7/9:${NC} Installing configuration template..."
if [ ! -f "/etc/volteria/config.yaml" ]; then
    sudo cp /opt/volteria/controller/config.yaml /etc/volteria/config.yaml
    sudo chown volteria:volteria /etc/volteria/config.yaml
    echo "Configuration template installed"
else
    echo "Configuration already exists, not overwriting"
fi

echo ""
echo -e "${GREEN}Step 8/9:${NC} Installing systemd service..."
sudo tee /etc/systemd/system/volteria-controller.service > /dev/null <<EOF
[Unit]
Description=Volteria Solar Diesel Controller
Documentation=https://github.com/byosamah/volteria
After=network.target

[Service]
Type=simple
User=volteria
Group=volteria
WorkingDirectory=/opt/volteria/controller
Environment="PATH=/opt/volteria/venv/bin"
ExecStart=/opt/volteria/venv/bin/python main.py --config /etc/volteria/config.yaml
Restart=always
RestartSec=10

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/data /etc/volteria

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=volteria

[Install]
WantedBy=multi-user.target
EOF

echo ""
echo -e "${GREEN}Step 9/9:${NC} Enabling service..."
sudo systemctl daemon-reload
sudo systemctl enable volteria-controller
echo "Service enabled (will start on boot)"

echo ""
echo "=============================================="
echo -e "${GREEN}   Setup Complete!${NC}"
echo "=============================================="
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit the configuration file:"
echo -e "     ${YELLOW}sudo nano /etc/volteria/config.yaml${NC}"
echo ""
echo "  2. Update the config.yaml with:"
echo "     - Your controller ID (from Volteria dashboard)"
echo "     - Your site settings"
echo "     - Your device addresses (Modbus)"
echo "     - Your Supabase credentials"
echo ""
echo "  3. Start the controller service:"
echo -e "     ${YELLOW}sudo systemctl start volteria-controller${NC}"
echo ""
echo "  4. Check service status:"
echo -e "     ${YELLOW}sudo systemctl status volteria-controller${NC}"
echo ""
echo "  5. View logs:"
echo -e "     ${YELLOW}journalctl -u volteria-controller -f${NC}"
echo ""
echo "Documentation: https://github.com/byosamah/volteria"
echo ""
