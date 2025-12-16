"use client";

/**
 * Value Display Widget
 *
 * Shows a single metric value with optional threshold coloring.
 * Displays: label, value, unit, and status indicator.
 */

import { memo } from "react";
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

interface ValueDisplayWidgetProps {
  widget: Widget;
  liveData: LiveData | null;
  isEditMode: boolean;
  onSelect: () => void;
}

export const ValueDisplayWidget = memo(function ValueDisplayWidget({ widget, liveData, isEditMode, onSelect }: ValueDisplayWidgetProps) {
  const config = widget.config as {
    device_id?: string;
    register_name?: string;
    label?: string;
    unit?: string;
    decimals?: number;
    thresholds?: {
      warning?: number;
      critical?: number;
    };
  };

  // Get value from live data
  let value: number | null = null;
  let unit = config.unit || "";

  if (config.device_id && config.register_name && liveData?.registers[config.device_id]) {
    const regData = liveData.registers[config.device_id][config.register_name];
    if (regData) {
      value = regData.value;
      unit = config.unit || regData.unit || "";
    }
  }

  // Also check for site aggregate values
  if (!value && config.register_name && liveData?.registers["_site_aggregate"]) {
    const regData = liveData.registers["_site_aggregate"][config.register_name];
    if (regData) {
      value = regData.value;
      unit = config.unit || regData.unit || "";
    }
  }

  // Format value
  const decimals = config.decimals ?? 1;
  const displayValue = value !== null ? value.toFixed(decimals) : "--";

  // Determine color based on thresholds
  let valueColor = "text-foreground";
  if (value !== null && config.thresholds) {
    if (config.thresholds.critical !== undefined && value >= config.thresholds.critical) {
      valueColor = "text-red-500";
    } else if (config.thresholds.warning !== undefined && value >= config.thresholds.warning) {
      valueColor = "text-amber-500";
    } else {
      valueColor = "text-green-500";
    }
  }

  return (
    <div
      className={cn(
        "h-full flex flex-col justify-center p-3",
        isEditMode && "cursor-pointer"
      )}
      onClick={isEditMode ? onSelect : undefined}
    >
      {/* Label */}
      {config.label && (
        <p className="text-xs text-muted-foreground truncate mb-1">
          {config.label}
        </p>
      )}

      {/* Value */}
      <div className="flex items-baseline gap-1">
        <span className={cn("text-2xl font-bold", valueColor)}>
          {displayValue}
        </span>
        {unit && (
          <span className="text-sm text-muted-foreground">{unit}</span>
        )}
      </div>

      {/* Empty state in edit mode */}
      {isEditMode && !config.register_name && (
        <p className="text-xs text-muted-foreground mt-1">Click to configure</p>
      )}
    </div>
  );
});
