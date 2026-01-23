#!/bin/bash
#
# Volteria DNS Watchdog
# Runs via cron every 5 minutes. Fixes DNS if resolution is broken.
# Zero impact when DNS is healthy — only touches resolv.conf if dead.
#

if ! host google.com > /dev/null 2>&1; then
    echo "nameserver 8.8.8.8" > /etc/resolv.conf
    echo "nameserver 8.8.4.4" >> /etc/resolv.conf
    systemctl restart NetworkManager
    logger "DNS watchdog: fixed DNS resolution"
fi
