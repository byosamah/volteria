"use client";

/**
 * Control Logs Tab Trigger with Status Indicator
 *
 * A custom tab trigger that shows a status dot indicating:
 * - Green dot: Controller online, logs flowing
 * - Yellow dot: Controller online, no recent logs
 * - Red dot: Controller offline
 * - Gray dot: No controller assigned
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { TabsTrigger } from "@/components/ui/tabs";

interface ControlLogsTabTriggerProps {
  siteId: string;
  value: string;
}

// Site status interface (matches API response)
interface SiteStatus {
  connection: {
    status: "online" | "offline";
    lastSeen: string | null;
    type: "controller" | "gateway" | "none";
  };
  logging: {
    hasLogs: boolean;
    lastLogTimestamp: string | null;
    totalLogs: number;
  };
}

export function ControlLogsTabTrigger({ siteId, value }: ControlLogsTabTriggerProps) {
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch site status
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/sites/${siteId}/status`);
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch {
      // Silently fail - status dot just won't update
    }
  }, [siteId]);

  useEffect(() => {
    fetchStatus();
    // Start polling interval
    intervalRef.current = setInterval(fetchStatus, 30000);

    // Handle tab visibility changes - pause polling when hidden
    const handleVisibility = () => {
      if (document.hidden) {
        // Tab hidden - clear interval to save bandwidth
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        // Tab visible - refetch and restart polling
        fetchStatus();
        intervalRef.current = setInterval(fetchStatus, 30000);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchStatus]);

  // Determine status dot color and tooltip
  const getStatusIndicator = () => {
    if (!status) {
      // Loading state - no indicator
      return null;
    }

    const { connection, logging } = status;

    // No controller assigned
    if (connection.type === "none") {
      return {
        color: "bg-muted-foreground/30",
        title: "No controller assigned",
      };
    }

    // Controller offline
    if (connection.status === "offline") {
      return {
        color: "bg-destructive",
        title: "Controller offline",
      };
    }

    // Controller online - check logging status
    if (logging.hasLogs) {
      // Check if logs are recent (within last 5 minutes)
      if (logging.lastLogTimestamp) {
        const lastLogTime = new Date(logging.lastLogTimestamp).getTime();
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        if (lastLogTime > fiveMinutesAgo) {
          return {
            color: "bg-green-500",
            title: "Logging active",
          };
        }
      }
      // Has logs but not recent
      return {
        color: "bg-yellow-500",
        title: "No recent logs",
      };
    }

    // Online but no logs yet
    return {
      color: "bg-yellow-500",
      title: "Waiting for data",
    };
  };

  const indicator = getStatusIndicator();

  return (
    <TabsTrigger value={value} className="relative">
      Control Logs
      {indicator && (
        <span
          className={`ml-2 h-2 w-2 rounded-full ${indicator.color}`}
          title={indicator.title}
        />
      )}
    </TabsTrigger>
  );
}
