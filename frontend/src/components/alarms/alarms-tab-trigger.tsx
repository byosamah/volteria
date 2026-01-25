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
  highestSeverity: "critical" | "major" | "minor" | "warning" | "info" | null;
}

export function AlarmsTabTrigger({ siteId, value }: AlarmsTabTriggerProps) {
  const [summary, setSummary] = useState<AlarmSummary>({
    highestSeverity: null,
  });
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchAlarms = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("alarms")
        .select("severity")
        .eq("site_id", siteId)
        .eq("acknowledged", false);

      if (error || !data) return;

      let highestSeverity: "critical" | "major" | "minor" | "warning" | "info" | null = null;

      // Severity hierarchy: critical > major > minor > warning > info
      const severityRank: Record<string, number> = {
        critical: 5,
        major: 4,
        minor: 3,
        warning: 2,
        info: 1,
      };

      let highestRank = 0;
      for (const alarm of data) {
        const rank = severityRank[alarm.severity] || 0;
        if (rank > highestRank) {
          highestRank = rank;
          highestSeverity = alarm.severity as typeof highestSeverity;
        }
        if (highestRank === 5) break; // Critical is max, stop early
      }

      setSummary({ highestSeverity });
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
      case "major":
        return "bg-orange-500";
      case "minor":
        return "bg-amber-500";
      case "warning":
        return "bg-yellow-500";
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
      case "major":
        return "Major alarms";
      case "minor":
        return "Minor alarms";
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
    <TabsTrigger value={value} className="relative">
      Alarms
      {dotColor && (
        <span
          className={`ml-2 h-2 w-2 rounded-full ${dotColor}`}
          title={getDotTitle()}
        />
      )}
    </TabsTrigger>
  );
}
