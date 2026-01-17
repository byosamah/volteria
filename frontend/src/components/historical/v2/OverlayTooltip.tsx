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
        value: typeof value === "number" ? value : null,
        color: param.color,
      };
    }).filter((entry) => entry.value !== null);
  }, [parameters, dataPoint]);

  // Calculate tooltip position (avoid overflow)
  const tooltipWidth = 180;
  const tooltipHeight = 30 + entries.length * 28;
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
      <div className="space-y-2">
        {entries.map((entry, index) => (
          <div key={index} className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full ring-2 ring-background shadow-sm flex-shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-xs text-foreground/70 truncate max-w-[100px]">
                {entry.name}
              </span>
            </div>
            <span className="text-xs font-semibold text-foreground tabular-nums">
              {entry.value !== null ? entry.value.toFixed(2) : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
