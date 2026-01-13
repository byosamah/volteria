#!/bin/bash
#
# Volteria First Boot Setup
# This script runs automatically on first boot to configure the controller
#
# It downloads and runs the main setup script, then disables itself
#

set -e

MARKER_FILE="/opt/volteria/.first-boot-complete"
LOG_FILE="/var/log/volteria-first-boot.log"
SETUP_URL="https://raw.githubusercontent.com/byosamah/volteria/main/controller/scripts/setup-controller.sh"

# Redirect output to log file
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=========================================="
echo "Volteria First Boot Setup"
echo "Started: $(date)"
echo "=========================================="

# Check if already completed
if [ -f "$MARKER_FILE" ]; then
    echo "First boot setup already completed. Exiting."
    exit 0
fi

# Wait for network (up to 2 minutes)
echo "Waiting for network connection..."
for i in {1..24}; do
    if ping -c 1 google.com &> /dev/null; then
        echo "Network is available"
        break
    fi
    if [ $i -eq 24 ]; then
        echo "ERROR: Network not available after 2 minutes"
        exit 1
    fi
    sleep 5
done

# Create volteria directory
mkdir -p /opt/volteria

# Download setup script
echo "Downloading setup script..."
curl -fsSL "$SETUP_URL" -o /tmp/setup-controller.sh
chmod +x /tmp/setup-controller.sh

# Run setup script in non-interactive mode
echo "Running setup script..."
export VOLTERIA_NONINTERACTIVE=1
/tmp/setup-controller.sh

# Mark as complete
touch "$MARKER_FILE"
echo "First boot setup completed successfully at $(date)"

# Disable the first-boot service
systemctl disable volteria-first-boot.service 2>/dev/null || true

echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
