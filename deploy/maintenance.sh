#!/bin/bash
# =============================================================================
# Volteria Server Maintenance Script
# Run daily via cron: 0 3 * * * /opt/solar-diesel-controller/deploy/maintenance.sh
# =============================================================================

set -e

LOG_FILE="/var/log/volteria-maintenance.log"
COMPOSE_DIR="/opt/solar-diesel-controller"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "=== Starting maintenance ==="

# -----------------------------------------------------------------------------
# Docker Cleanup (safe - keeps running containers and recent images)
# -----------------------------------------------------------------------------
log "Cleaning Docker resources..."

# Remove unused images older than 24h
docker image prune -af --filter "until=24h" 2>/dev/null || true

# Remove unused volumes (not attached to any container)
docker volume prune -f 2>/dev/null || true

# Remove unused networks (not attached to any container)
docker network prune -f 2>/dev/null || true

# Remove build cache older than 7 days
docker builder prune -af --filter "until=168h" 2>/dev/null || true

log "Docker cleanup complete"

# -----------------------------------------------------------------------------
# Journal Cleanup (keep 7 days of systemd logs)
# -----------------------------------------------------------------------------
log "Vacuuming journal logs..."
sudo journalctl --vacuum-time=7d 2>/dev/null || true
log "Journal cleanup complete"

# -----------------------------------------------------------------------------
# APT Cleanup
# -----------------------------------------------------------------------------
log "Cleaning APT cache..."
sudo apt-get autoremove -y 2>/dev/null || true
sudo apt-get clean 2>/dev/null || true
log "APT cleanup complete"

# -----------------------------------------------------------------------------
# Truncate volteria logs if over 10MB
# -----------------------------------------------------------------------------
log "Checking volteria log sizes..."
for logfile in /var/log/volteria-*.log; do
    if [ -f "$logfile" ]; then
        size=$(stat -f%z "$logfile" 2>/dev/null || stat -c%s "$logfile" 2>/dev/null || echo 0)
        if [ "$size" -gt 10485760 ]; then  # 10MB
            log "Truncating $logfile (${size} bytes)"
            sudo truncate -s 0 "$logfile"
        fi
    fi
done

# -----------------------------------------------------------------------------
# Health Report
# -----------------------------------------------------------------------------
log "=== Health Report ==="

# Disk usage
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}')
log "Disk usage: $DISK_USAGE"

# Memory usage
MEM_TOTAL=$(free -h | awk '/^Mem:/ {print $2}')
MEM_USED=$(free -h | awk '/^Mem:/ {print $3}')
log "Memory: $MEM_USED / $MEM_TOTAL"

# Docker disk usage
DOCKER_DISK=$(docker system df --format "{{.Type}}: {{.Size}}" 2>/dev/null | tr '\n' ', ' || echo "N/A")
log "Docker: $DOCKER_DISK"

# Container status
log "Container status:"
docker ps --format "  {{.Names}}: {{.Status}}" 2>/dev/null || echo "  N/A"

# -----------------------------------------------------------------------------
# Alert if disk > 80%
# -----------------------------------------------------------------------------
DISK_PCT=$(df / | awk 'NR==2 {gsub("%",""); print $5}')
if [ "$DISK_PCT" -gt 80 ]; then
    log "WARNING: Disk usage is ${DISK_PCT}% - above 80% threshold!"
fi

log "=== Maintenance complete ==="
