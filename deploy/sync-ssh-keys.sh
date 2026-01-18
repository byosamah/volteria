#!/bin/bash
#
# Volteria SSH Key Sync Script
# Syncs controller SSH public keys from Supabase to authorized_keys
#
# Install: Add to cron (runs every minute)
#   echo "* * * * * /opt/solar-diesel-controller/deploy/sync-ssh-keys.sh >> /var/log/volteria-ssh-sync.log 2>&1" | crontab -
#
# Or run once manually:
#   ./sync-ssh-keys.sh
#

set -e

# Configuration
SUPABASE_URL="https://usgxhzdctzthcqxyxfxl.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzZ3hoemRjdHp0aGNxeHl4ZnhsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTAwOTQ2MywiZXhwIjoyMDgwNTg1NDYzfQ.4iKrB2pv7OVaKv_VY7QoyWQzSPuALcNPNJnD5S3Z74I"
SSH_USER="volteria"
SSH_HOME="/home/${SSH_USER}"
AUTHORIZED_KEYS="${SSH_HOME}/.ssh/authorized_keys"
TEMP_KEYS="/tmp/volteria_authorized_keys_$$"
LOCK_FILE="/tmp/volteria-ssh-sync.lock"

# Prevent concurrent runs
if [ -f "$LOCK_FILE" ]; then
    # Check if lock is stale (older than 5 minutes)
    if [ "$(find "$LOCK_FILE" -mmin +5 2>/dev/null)" ]; then
        rm -f "$LOCK_FILE"
    else
        exit 0
    fi
fi
touch "$LOCK_FILE"
trap "rm -f $LOCK_FILE $TEMP_KEYS" EXIT

# Ensure SSH directory exists
mkdir -p "${SSH_HOME}/.ssh"
chmod 700 "${SSH_HOME}/.ssh"
chown "${SSH_USER}:${SSH_USER}" "${SSH_HOME}/.ssh"

# Create authorized_keys if it doesn't exist
touch "$AUTHORIZED_KEYS"
chmod 600 "$AUTHORIZED_KEYS"
chown "${SSH_USER}:${SSH_USER}" "$AUTHORIZED_KEYS"

# Fetch SSH keys from database
# Query controllers table for ssh_public_key where not null
RESPONSE=$(curl -s "${SUPABASE_URL}/rest/v1/controllers?select=id,serial_number,ssh_public_key&ssh_public_key=not.is.null" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}")

# Check if curl succeeded
if [ $? -ne 0 ] || [ -z "$RESPONSE" ]; then
    echo "[$(date)] ERROR: Failed to fetch keys from database"
    exit 1
fi

# Check for error in response
if echo "$RESPONSE" | grep -q '"error"'; then
    echo "[$(date)] ERROR: Database query failed: $RESPONSE"
    exit 1
fi

# Parse JSON and extract keys
# Using jq if available, otherwise basic parsing
if command -v jq &> /dev/null; then
    # Extract keys with comments
    echo "$RESPONSE" | jq -r '.[] | select(.ssh_public_key != null) | .ssh_public_key + " volteria-" + .serial_number' > "$TEMP_KEYS"
else
    # Basic parsing without jq (less reliable but works)
    echo "$RESPONSE" | grep -oP '"ssh_public_key"\s*:\s*"\K[^"]+' > "$TEMP_KEYS"
fi

# Count keys
KEY_COUNT=$(wc -l < "$TEMP_KEYS" | tr -d ' ')

# Only update if we have keys and content changed
if [ "$KEY_COUNT" -gt 0 ]; then
    # Check if content changed
    if ! diff -q "$TEMP_KEYS" "$AUTHORIZED_KEYS" > /dev/null 2>&1; then
        # Backup existing keys
        cp "$AUTHORIZED_KEYS" "${AUTHORIZED_KEYS}.bak" 2>/dev/null || true

        # Update authorized_keys
        mv "$TEMP_KEYS" "$AUTHORIZED_KEYS"
        chmod 600 "$AUTHORIZED_KEYS"
        chown "${SSH_USER}:${SSH_USER}" "$AUTHORIZED_KEYS"

        echo "[$(date)] Updated authorized_keys with ${KEY_COUNT} controller keys"
    fi
else
    echo "[$(date)] No SSH keys found in database"
fi
