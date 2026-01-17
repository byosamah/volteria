"use client";

import { useMemo } from "react";
import type { AxisParameter, ChartDataPoint } from "./types";

interface OverlayTooltipProps {
  x: number;
  y: number;
  dataPoint: ChartDataPoint;
  parameters: AxisParameter[];
  containerWidth: number;
  containerHeight: number;
}

export function OverlayTooltip({
  x,
  y,
  dataPoint,
  parameters,
  containerWidth,
  containerHeight,
}: OverlayTooltipProps) {
  // Extract values for each parameter from the data point
  const entries = useMemo(() => {
    return parameters.map((param) => {
      const dataKey = `${param.deviceId}:${param.registerName}`;
      const value = dataPoint[dataKey];
      return {
        name: param.registerName,
        siteName: param.siteName,
        deviceName: param.deviceName,
        unit: param.unit,
        value: typeof value === "number" ? value : null,
        color: param.color,
      };
    }).filter((entry) => entry.value !== null);
  }, [parameters, dataPoint]);

  // Calculate tooltip position (avoid overflow)
  const tooltipWidth = 200;
  const tooltipHeight = 40 + entries.length * 36;
  const padding = 12;

  // Position to the right of cursor by default
  let tooltipX = x + padding;
  let tooltipY = y - tooltipHeight / 2;

  // Flip to left if would overflow right edge
  if (tooltipX + tooltipWidth > containerWidth - padding) {
    tooltipX = x - tooltipWidth - padding;
  }

  // Clamp vertical position
  if (tooltipY < padding) {
    tooltipY = padding;
  } else if (tooltipY + tooltipHeight > containerHeight - padding) {
    tooltipY = containerHeight - tooltipHeight - padding;
  }

  if (entries.length === 0) return null;

  return (
    <div
      className="absolute pointer-events-none z-20 bg-popover/95 backdrop-blur-sm border border-border rounded-xl shadow-lg p-3"
      style={{
        left: tooltipX,
        top: tooltipY,
        minWidth: tooltipWidth,
        willChange: "transform",
      }}
    >
      {/* Timestamp - show full date and time */}
      <p className="text-[11px] text-muted-foreground mb-2.5 pb-2 border-b border-border/50 font-medium">
        {new Date(dataPoint.timestamp).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>

      {/* Values */}
      <div className="space-y-2.5">
        {entries.map((entry, index) => (
          <div key={index} className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full ring-2 ring-background shadow-sm flex-shrink-0 mt-0.5"
                style={{ backgroundColor: entry.color }}
              />
              <div className="flex flex-col min-w-0">
                <span className="text-xs text-foreground/80 truncate max-w-[120px] leading-tight">
                  {entry.name}
                </span>
                {(entry.siteName || entry.deviceName) && (
                  <span className="text-[10px] text-muted-foreground truncate max-w-[120px] leading-tight">
                    {entry.siteName}{entry.siteName && entry.deviceName && " › "}{entry.deviceName}
                  </span>
                )}
              </div>
            </div>
            <span className="text-xs font-semibold text-foreground tabular-nums whitespace-nowrap">
              {entry.value !== null ? entry.value.toFixed(2) : "—"}
              {entry.unit && <span className="text-muted-foreground font-normal ml-0.5">{entry.unit}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
