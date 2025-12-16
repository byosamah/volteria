"use client";

/**
 * Status Indicator Widget
 *
 * Shows device online/offline status with last seen time.
 * Compact indicator for quick status overview.
 */

import { memo } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

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

interface StatusIndicatorWidgetProps {
  widget: Widget;
  liveData: LiveData | null;
  isEditMode: boolean;
  onSelect: () => void;
}

export const StatusIndicatorWidget = memo(function StatusIndicatorWidget({ widget, liveData, isEditMode, onSelect }: StatusIndicatorWidgetProps) {
  const config = widget.config as {
    device_id?: string;
    label?: string;
    show_online_status?: boolean;
    show_last_seen?: boolean;
  };

  const deviceId = config.device_id;
  const showOnlineStatus = config.show_online_status ?? true;
  const showLastSeen = config.show_last_seen ?? true;

  // Get device status from live data
  const deviceStatus = deviceId ? liveData?.device_status[deviceId] : null;
  const isOnline = deviceStatus?.is_online ?? null;
  const lastSeen = deviceStatus?.last_seen;

  // Format last seen
  const formatLastSeen = (timestamp: string | null | undefined) => {
    if (!timestamp) return "Never";

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div
      className={cn(
        "h-full flex items-center gap-3 p-3",
        isEditMode && "cursor-pointer"
      )}
      onClick={isEditMode ? onSelect : undefined}
    >
      {/* Status icon */}
      {showOnlineStatus && (
        <div
          className={cn(
            "p-2 rounded-full",
            isOnline === true && "bg-green-100 dark:bg-green-950",
            isOnline === false && "bg-red-100 dark:bg-red-950",
            isOnline === null && "bg-muted"
          )}
        >
          {isOnline === true ? (
            <Wifi className="h-4 w-4 text-green-600" />
          ) : isOnline === false ? (
            <WifiOff className="h-4 w-4 text-red-500" />
          ) : (
            <WifiOff className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      )}

      {/* Text */}
      <div className="flex-1 min-w-0">
        {config.label && (
          <p className="text-sm font-medium truncate">{config.label}</p>
        )}
        <div className="flex items-center gap-2 text-xs">
          {showOnlineStatus && (
            <span
              className={cn(
                "font-medium",
                isOnline === true && "text-green-600",
                isOnline === false && "text-red-500",
                isOnline === null && "text-muted-foreground"
              )}
            >
              {isOnline === true ? "Online" : isOnline === false ? "Offline" : "Unknown"}
            </span>
          )}
          {showLastSeen && lastSeen && (
            <span className="text-muted-foreground">
              {formatLastSeen(lastSeen)}
            </span>
          )}
        </div>
      </div>

      {/* Empty state in edit mode */}
      {isEditMode && !deviceId && (
        <p className="text-xs text-muted-foreground">Click to configure</p>
      )}
    </div>
  );
});
