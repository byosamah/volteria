#!/bin/bash
#
# Volteria SD Card Preparation Script
# Run this AFTER flashing Raspberry Pi OS with Balena Etcher
#
# This script adds first-boot automation files to the SD card
# so the controller sets itself up automatically on first boot
#
# Usage (on macOS):
#   ./prepare-sd-card.sh /Volumes/bootfs
#
# Usage (on Linux):
#   ./prepare-sd-card.sh /media/$USER/bootfs
#
# After running this script:
# 1. Safely eject the SD card
# 2. Insert into Raspberry Pi
# 3. Power on - setup runs automatically (takes ~5-10 minutes)
# 4. Controller appears in Volteria wizard when ready
#

set -e

BOOT_MOUNT="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=========================================="
echo "Volteria SD Card Preparation"
echo -e "==========================================${NC}"
echo ""

# Check if boot mount provided
if [ -z "$BOOT_MOUNT" ]; then
    echo -e "${YELLOW}Usage: $0 <boot-partition-path>${NC}"
    echo ""
    echo "After flashing with Balena Etcher, find the boot partition:"
    echo ""
    echo "  macOS:  /Volumes/bootfs"
    echo "  Linux:  /media/\$USER/bootfs"
    echo ""
    echo "Example:"
    echo "  $0 /Volumes/bootfs"
    echo ""

    # Try to detect common mount points
    if [ -d "/Volumes/bootfs" ]; then
        echo -e "${GREEN}Found: /Volumes/bootfs${NC}"
        BOOT_MOUNT="/Volumes/bootfs"
    elif [ -d "/media/$USER/bootfs" ]; then
        echo -e "${GREEN}Found: /media/$USER/bootfs${NC}"
        BOOT_MOUNT="/media/$USER/bootfs"
    else
        echo -e "${RED}Could not auto-detect boot partition.${NC}"
        echo "Please provide the path as an argument."
        exit 1
    fi
fi

# Verify mount point exists
if [ ! -d "$BOOT_MOUNT" ]; then
    echo -e "${RED}ERROR: Boot partition not found at: $BOOT_MOUNT${NC}"
    echo "Make sure the SD card is inserted and mounted."
    exit 1
fi

# Verify it looks like a Raspberry Pi boot partition
if [ ! -f "$BOOT_MOUNT/config.txt" ] && [ ! -f "$BOOT_MOUNT/cmdline.txt" ]; then
    echo -e "${RED}ERROR: Does not appear to be a Raspberry Pi boot partition${NC}"
    echo "Expected to find config.txt or cmdline.txt"
    exit 1
fi

echo -e "Using boot partition: ${GREEN}$BOOT_MOUNT${NC}"
echo ""

# Create firstrun script directory
FIRSTRUN_DIR="$BOOT_MOUNT"

# Enable SSH by creating empty ssh file
echo "Enabling SSH..."
touch "$FIRSTRUN_DIR/ssh"

# Create userconf file for default user (voltadmin:Solar@1996)
echo "Setting up default user (voltadmin)..."

# Generate password hash (requires openssl)
if command -v openssl &> /dev/null; then
    PASS_HASH=$(echo 'Solar@1996' | openssl passwd -6 -stdin)
    echo "voltadmin:${PASS_HASH}" > "$FIRSTRUN_DIR/userconf.txt"
    echo "User credentials configured via userconf.txt"
else
    echo -e "${YELLOW}Warning: openssl not found, cannot auto-configure user${NC}"
    echo "Please use Raspberry Pi Imager to set username/password:"
    echo "  Username: voltadmin"
    echo "  Password: Solar@1996"
fi

# Create firstrun.sh script that will run on first boot
echo "Creating first-boot setup script..."
cat > "$FIRSTRUN_DIR/firstrun.sh" << 'FIRSTRUN_EOF'
#!/bin/bash
# Volteria First Boot Configuration
# This runs automatically on first Raspberry Pi OS boot

set -e

LOG="/var/log/volteria-firstrun.log"
exec > >(tee -a "$LOG") 2>&1

echo "=== Volteria First Boot Setup ==="
echo "Started: $(date)"

# Wait for network
echo "Waiting for network..."
for i in {1..30}; do
    if ping -c 1 8.8.8.8 &>/dev/null; then
        echo "Network available"
        break
    fi
    sleep 2
done

# Update system
echo "Updating system packages..."
apt-get update
apt-get upgrade -y

# Install required packages
echo "Installing dependencies..."
apt-get install -y python3 python3-pip python3-venv git curl jq sshpass

# Download and run Volteria setup
echo "Downloading Volteria setup script..."
SETUP_URL="https://raw.githubusercontent.com/byosamah/volteria/main/controller/scripts/setup-controller.sh"
curl -fsSL "$SETUP_URL" -o /tmp/setup-controller.sh
chmod +x /tmp/setup-controller.sh

# Run setup in non-interactive mode
echo "Running Volteria setup..."
export VOLTERIA_NONINTERACTIVE=1
/tmp/setup-controller.sh || {
    echo "Setup script failed, will retry on next boot"
    exit 1
}

# Mark setup complete
echo "Setup completed successfully at $(date)"
rm -f /boot/firmware/firstrun.sh 2>/dev/null || rm -f /boot/firstrun.sh 2>/dev/null

# Reboot to apply changes
echo "Rebooting..."
reboot
FIRSTRUN_EOF

chmod +x "$FIRSTRUN_DIR/firstrun.sh"

# Enable firstrun in cmdline.txt
echo "Enabling first-run script in boot config..."
CMDLINE_FILE="$BOOT_MOUNT/cmdline.txt"
if [ -f "$CMDLINE_FILE" ]; then
    # Check if systemd.run is already present
    if ! grep -q "systemd.run=" "$CMDLINE_FILE"; then
        # Add systemd.run to run our script on first boot
        # Use sed to append to the single line
        FIRSTRUN_PATH="/boot/firmware/firstrun.sh"
        [ -d "$BOOT_MOUNT/../rootfs/boot/firmware" ] || FIRSTRUN_PATH="/boot/firstrun.sh"

        sed -i.bak "s|$| systemd.run=${FIRSTRUN_PATH} systemd.run_success_action=reboot systemd.unit=kernel-command-line.target|" "$CMDLINE_FILE"
        echo "Updated cmdline.txt"
    else
        echo "cmdline.txt already has systemd.run configured"
    fi
fi

# Configure WiFi if credentials provided
if [ -n "$WIFI_SSID" ] && [ -n "$WIFI_PASSWORD" ]; then
    echo "Configuring WiFi..."
    cat > "$FIRSTRUN_DIR/wpa_supplicant.conf" << WIFI_EOF
country=AE
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
    ssid="$WIFI_SSID"
    psk="$WIFI_PASSWORD"
    key_mgmt=WPA-PSK
}
WIFI_EOF
    echo "WiFi configured for: $WIFI_SSID"
fi

echo ""
echo -e "${GREEN}=========================================="
echo "SD Card Preparation Complete!"
echo -e "==========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Safely eject the SD card"
echo "  2. Insert into Raspberry Pi"
echo "  3. Connect Ethernet cable (recommended) or configure WiFi"
echo "  4. Power on the Raspberry Pi"
echo "  5. Wait ~10 minutes for automatic setup"
echo "  6. Controller will appear in Volteria wizard"
echo ""
echo "The Pi will:"
echo "  - Boot and connect to network"
echo "  - Download and run Volteria setup"
echo "  - Register with cloud automatically"
echo "  - Establish SSH tunnel for remote access"
echo ""
echo -e "${YELLOW}Default SSH credentials:${NC}"
echo "  User: voltadmin"
echo "  Pass: Solar@1996"
echo ""
