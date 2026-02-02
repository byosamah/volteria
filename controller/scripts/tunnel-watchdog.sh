#!/bin/bash
# Tunnel health monitor - runs every minute via cron
# If tunnel is broken, restart it
#
# This script ensures the SSH reverse tunnel recovers within 1 minute
# after network connectivity is restored.

TUNNEL_PORT=10000  # Will be replaced during setup with actual port

# Check if tunnel process is running
if ! pgrep -f "ssh.*-R.*${TUNNEL_PORT}" > /dev/null 2>&1; then
    logger -t "volteria-tunnel" "Tunnel process not running, restarting..."
    systemctl restart volteria-tunnel.service
    exit 0
fi

# Optional: Check if local SSH is responding (tunnel might be up but broken)
# Uncomment if needed for more aggressive monitoring
# if ! timeout 5 nc -z localhost 22 > /dev/null 2>&1; then
#     logger -t "volteria-tunnel" "Local SSH not responding, restarting tunnel..."
#     systemctl restart volteria-tunnel.service
# fi
