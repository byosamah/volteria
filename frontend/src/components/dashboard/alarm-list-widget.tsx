"use client";

/**
 * Alarm List Widget
 *
 * Displays recent alarms for the site.
 * Configurable: max items, severity filter, show resolved.
 */

import { useState, useEffect, useRef, useCallback, memo } from "react";
import { AlertTriangle, AlertCircle, Info, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

interface LiveData {
  timestamp: string;
  registers: Record<string, Record<string, { value: number | null; unit: string | null; timestamp: string | null }>>;
  device_status: Record<string, { is_online: boolean; last_seen: string | null }>;
}

interface Widget {
  id: string;
  widget_type: string;
  grid_row: number;
  grid_col: number;
  grid_width: number;
  grid_height: number;
  config: Record<string, unknown>;
  z_index: number;
}

interface Alarm {
  id: string;
  alarm_type: string;
  severity: "info" | "warning" | "major" | "critical";
  message: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

interface AlarmListWidgetProps {
  widget: Widget;
  liveData: LiveData | null;
  isEditMode: boolean;
  onSelect: () => void;
  siteId: string;
}

const SEVERITY_CONFIG = {
  critical: { icon: AlertTriangle, color: "text-red-500", bg: "bg-red-50 dark:bg-red-950/30" },
  major: { icon: AlertCircle, color: "text-orange-500", bg: "bg-orange-50 dark:bg-orange-950/30" },
  minor: { icon: AlertCircle, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/30" },
  warning: { icon: AlertTriangle, color: "text-yellow-500", bg: "bg-yellow-50 dark:bg-yellow-950/30" },
  info: { icon: Info, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-950/30" },
};

export const AlarmListWidget = memo(function AlarmListWidget({ widget, liveData, isEditMode, onSelect, siteId }: AlarmListWidgetProps) {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const config = widget.config as {
    max_items?: number;
    severities?: string[];
    show_resolved?: boolean;
  };

  const maxItems = config.max_items || 5;
  const severities = config.severities || ["critical", "major", "warning"];
  const showResolved = config.show_resolved || false;

  // Memoize fetchAlarms to use in visibility handler
  const fetchAlarms = useCallback(async () => {
    setIsLoading(true);
    try {
      const supabase = createClient();

      // Get site's project_id first
      const { data: site } = await supabase
        .from("sites")
        .select("project_id")
        .eq("id", siteId)
        .single();

      if (!site) return;

      let query = supabase
        .from("alarms")
        .select("id, alarm_type, severity, message, status, created_at, resolved_at")
        .eq("project_id", site.project_id)
        .in("severity", severities)
        .order("created_at", { ascending: false })
        .limit(maxItems);

      if (!showResolved) {
        query = query.eq("status", "active");
      }

      const { data } = await query;
      setAlarms(data || []);
    } finally {
      setIsLoading(false);
    }
  }, [siteId, severities, showResolved, maxItems]);

  // Fetch alarms and set up polling with Page Visibility API
  useEffect(() => {
    if (isEditMode) return;

    // Initial fetch
    fetchAlarms();

    // Start polling interval
    intervalRef.current = setInterval(fetchAlarms, 30000);

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
  }, [fetchAlarms, isEditMode]);

  // Format relative time
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
  };

  return (
    <div
      className={cn(
        "h-full flex flex-col p-3",
        isEditMode && "cursor-pointer"
      )}
      onClick={isEditMode ? onSelect : undefined}
    >
      {/* Title */}
      <p className="text-xs font-medium mb-2">Recent Alarms</p>

      {/* Alarm list */}
      <div className="flex-1 overflow-auto space-y-1.5">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
          </div>
        ) : alarms.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <CheckCircle2 className="h-6 w-6 mb-1 text-green-500" />
            <p className="text-xs">No active alarms</p>
          </div>
        ) : (
          alarms.map((alarm) => {
            const severity = SEVERITY_CONFIG[alarm.severity] || SEVERITY_CONFIG.info;
            const Icon = severity.icon;

            return (
              <div
                key={alarm.id}
                className={cn(
                  "flex items-start gap-2 p-2 rounded text-xs",
                  severity.bg
                )}
              >
                <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", severity.color)} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{alarm.message || alarm.alarm_type}</p>
                  <p className="text-muted-foreground">
                    {formatTime(alarm.created_at)}
                    {alarm.status === "resolved" && (
                      <span className="ml-1 text-green-600">(Resolved)</span>
                    )}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Empty config state in edit mode */}
      {isEditMode && (
        <p className="text-xs text-muted-foreground mt-1">Click to configure filters</p>
      )}
    </div>
  );
});
