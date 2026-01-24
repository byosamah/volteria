"use client";

/**
 * Alarms Tab Trigger with Status Indicator
 *
 * Shows a colored dot based on highest unresolved alarm severity:
 * - Red dot: critical alarms
 * - Amber dot: warning alarms
 * - Blue dot: info alarms
 * - No dot: no unresolved alarms
 *
 * Also shows unacknowledged count badge when > 0.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { TabsTrigger } from "@/components/ui/tabs";

interface AlarmsTabTriggerProps {
  siteId: string;
  value: string;
}

interface AlarmSummary {
  highestSeverity: "critical" | "warning" | "info" | null;
  unacknowledgedCount: number;
}

export function AlarmsTabTrigger({ siteId, value }: AlarmsTabTriggerProps) {
  const [summary, setSummary] = useState<AlarmSummary>({
    highestSeverity: null,
    unacknowledgedCount: 0,
  });
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchAlarms = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("alarms")
        .select("severity, acknowledged")
        .eq("site_id", siteId)
        .eq("resolved", false);

      if (error || !data) return;

      let highestSeverity: "critical" | "warning" | "info" | null = null;
      let unacknowledgedCount = 0;

      for (const alarm of data) {
        if (!alarm.acknowledged) unacknowledgedCount++;

        if (alarm.severity === "critical") {
          highestSeverity = "critical";
        } else if (alarm.severity === "warning" && highestSeverity !== "critical") {
          highestSeverity = "warning";
        } else if (alarm.severity === "info" && !highestSeverity) {
          highestSeverity = "info";
        }
      }

      setSummary({ highestSeverity, unacknowledgedCount });
    } catch {
      // Silently fail
    }
  }, [siteId]);

  useEffect(() => {
    fetchAlarms();
    intervalRef.current = setInterval(fetchAlarms, 30000);

    const handleVisibility = () => {
      if (document.hidden) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        fetchAlarms();
        intervalRef.current = setInterval(fetchAlarms, 30000);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchAlarms]);

  const getDotColor = () => {
    switch (summary.highestSeverity) {
      case "critical":
        return "bg-destructive";
      case "warning":
        return "bg-amber-500";
      case "info":
        return "bg-blue-400";
      default:
        return null;
    }
  };

  const getDotTitle = () => {
    switch (summary.highestSeverity) {
      case "critical":
        return "Critical alarms";
      case "warning":
        return "Warning alarms";
      case "info":
        return "Info alarms";
      default:
        return "";
    }
  };

  const dotColor = getDotColor();

  return (
    <TabsTrigger value={value} className="relative gap-1.5">
      Alarms
      {dotColor && (
        <span
          className={`h-2 w-2 rounded-full ${dotColor}`}
          title={getDotTitle()}
        />
      )}
      {summary.unacknowledgedCount > 0 && (
        <span className="inline-flex items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-medium leading-none text-destructive-foreground">
          {summary.unacknowledgedCount}
        </span>
      )}
    </TabsTrigger>
  );
}
