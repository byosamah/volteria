#!/bin/bash
# Tunnel health monitor - runs every minute via cron
# Enhanced: Cleans up stale server port before restart
#
# When WiFi drops and reconnects, the DO server may still have a stale
# connection holding the port, causing "remote port forwarding failed".
# This script detects that condition and cleans up the stale port.

TUNNEL_PORT=10000  # Will be replaced during setup with actual port
DO_SERVER="159.223.224.203"
LOG_TAG="volteria-tunnel"
TUNNEL_USER="volteria"
TUNNEL_PASS="VoltTunnel@2026"

# Check 1: Is tunnel process running?
if ! pgrep -f "ssh.*-R.*${TUNNEL_PORT}" > /dev/null 2>&1; then
    logger -t "$LOG_TAG" "Tunnel process not running, restarting..."
    systemctl restart volteria-tunnel.service
    exit 0
fi

# Check 2: Port forwarding failed? (process running but tunnel broken)
if journalctl -u volteria-tunnel.service --since "2 minutes ago" --no-pager 2>/dev/null | grep -q "remote port forwarding failed"; then
    logger -t "$LOG_TAG" "Port forwarding failed detected, cleaning up stale server connection..."

    # Kill stale port on DO server using tunnel credentials
    # Requires volteria user on DO server to have: NOPASSWD: /usr/bin/fuser
    sshpass -p "$TUNNEL_PASS" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
        ${TUNNEL_USER}@${DO_SERVER} \
        "sudo fuser -k ${TUNNEL_PORT}/tcp 2>/dev/null || true" 2>/dev/null

    result=$?
    if [ $result -eq 0 ]; then
        logger -t "$LOG_TAG" "Server port cleanup attempted"
    else
        logger -t "$LOG_TAG" "Server cleanup connection failed (code: $result)"
    fi

    sleep 2
    logger -t "$LOG_TAG" "Restarting tunnel service..."
    systemctl restart volteria-tunnel.service
fi
