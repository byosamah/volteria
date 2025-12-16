"use client";

/**
 * Icon Widget
 *
 * Displays an icon representing a piece of equipment with optional live data.
 * Can show up to 2 register values below the icon.
 */

import { memo } from "react";
import { getIconById } from "@/lib/dashboard-icons";
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

interface IconWidgetProps {
  widget: Widget;
  liveData: LiveData | null;
  isEditMode: boolean;
  onSelect: () => void;
}

export const IconWidget = memo(function IconWidget({ widget, liveData, isEditMode, onSelect }: IconWidgetProps) {
  const config = widget.config as {
    icon_id?: string;
    label?: string;
    linked_device_id?: string;
    linked_registers?: Array<{ register_name: string; unit?: string; decimals?: number }>;
    color?: string;
  };

  const iconDef = getIconById(config.icon_id || "load_generic");
  const Icon = iconDef?.icon;

  // Get device status
  const deviceId = config.linked_device_id;
  const deviceStatus = deviceId ? liveData?.device_status[deviceId] : null;
  const isOnline = deviceStatus?.is_online ?? null;

  // Get register values
  const registerValues = (config.linked_registers || []).map((reg) => {
    if (!deviceId || !liveData?.registers[deviceId]) {
      return { name: reg.register_name, value: null, unit: reg.unit || "" };
    }

    const regData = liveData.registers[deviceId][reg.register_name];
    if (!regData) {
      return { name: reg.register_name, value: null, unit: reg.unit || "" };
    }

    const value = regData.value;
    const decimals = reg.decimals ?? 1;
    const formatted = value !== null ? value.toFixed(decimals) : "--";

    return {
      name: reg.register_name,
      value: formatted,
      unit: reg.unit || regData.unit || "",
    };
  });

  const accentColor = config.color || "#22c55e";

  return (
    <div
      className={cn(
        "h-full flex flex-col items-center justify-center p-3 text-center",
        isEditMode && "cursor-pointer"
      )}
      onClick={isEditMode ? onSelect : undefined}
    >
      {/* Status indicator dot */}
      {deviceId && isOnline !== null && (
        <div
          className={cn(
            "absolute top-2 right-2 w-2.5 h-2.5 rounded-full",
            isOnline ? "bg-green-500" : "bg-red-500"
          )}
          title={isOnline ? "Online" : "Offline"}
        />
      )}

      {/* Icon */}
      {Icon && (
        <div
          className="mb-1"
          style={{ color: accentColor }}
        >
          <Icon className="h-8 w-8" />
        </div>
      )}

      {/* Label */}
      {config.label && (
        <p className="text-xs font-medium truncate max-w-full">
          {config.label}
        </p>
      )}

      {/* Values */}
      {registerValues.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {registerValues.slice(0, 2).map((reg, idx) => (
            <p
              key={idx}
              className="text-sm font-semibold"
              style={{ color: reg.value !== null ? accentColor : undefined }}
            >
              {reg.value !== null ? (
                <>
                  {reg.value} <span className="text-xs font-normal text-muted-foreground">{reg.unit}</span>
                </>
              ) : (
                <span className="text-muted-foreground">--</span>
              )}
            </p>
          ))}
        </div>
      )}

      {/* Empty state in edit mode */}
      {isEditMode && !config.icon_id && (
        <p className="text-xs text-muted-foreground">Click to configure</p>
      )}
    </div>
  );
});
