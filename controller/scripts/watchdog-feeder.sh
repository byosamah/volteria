#!/bin/bash
# Volteria Hardware Watchdog Feeder (SOL532-E16)
#
# Writes to /dev/watchdog every 30s to prevent hardware reset.
# If this script dies (system hang), watchdog triggers reboot after 60s.
#
# The hardware watchdog timeout is configured to 60s in the kernel,
# and we feed it every 30s for a 2x safety margin.

exec 3>/dev/watchdog
while true; do
    echo -n "V" >&3
    sleep 30
done
