"use client";

/**
 * Shape Widget
 *
 * Renders basic SVG shapes (rectangle, circle, line, arrow) for visual
 * dashboard decoration. Shapes have no card background — they're
 * transparent, making them useful as frames around other widgets.
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

interface ShapeWidgetProps {
  widget: Widget;
  liveData: LiveData | null;
  isEditMode: boolean;
  onSelect: () => void;
}

export interface ShapeWidgetConfig {
  shape_type?: "rectangle" | "circle" | "line" | "arrow";
  fill_mode?: "none" | "solid";
  fill_color?: string;
  fill_opacity?: number;
  stroke_color?: string;
  stroke_width?: number;
  stroke_style?: "solid" | "dashed" | "dotted";
  border_radius?: number;
  line_direction?: "horizontal" | "vertical" | "diagonal-down" | "diagonal-up";
  arrow_end?: "end" | "start" | "both";
  send_to_back?: boolean;
}

const STROKE_DASHARRAY: Record<string, string | undefined> = {
  solid: undefined,
  dashed: "8 4",
  dotted: "2 2",
};

function getLineEndpoints(direction: string) {
  switch (direction) {
    case "vertical":
      return { x1: 50, y1: 5, x2: 50, y2: 95 };
    case "diagonal-down":
      return { x1: 5, y1: 5, x2: 95, y2: 95 };
    case "diagonal-up":
      return { x1: 5, y1: 95, x2: 95, y2: 5 };
    case "horizontal":
    default:
      return { x1: 5, y1: 50, x2: 95, y2: 50 };
  }
}

export const ShapeWidget = memo(function ShapeWidget({
  widget,
  isEditMode,
  onSelect,
}: ShapeWidgetProps) {
  const config = widget.config as ShapeWidgetConfig;

  const shapeType = config.shape_type || "rectangle";
  const fillMode = config.fill_mode || "none";
  const fillColor = config.fill_color || "#3b82f6";
  const fillOpacity = (config.fill_opacity ?? 20) / 100;
  const strokeColor = config.stroke_color || "#3b82f6";
  const strokeWidth = config.stroke_width || 2;
  const strokeStyle = config.stroke_style || "solid";
  const borderRadius = config.border_radius || 0;
  const lineDirection = config.line_direction || "horizontal";
  const arrowEnd = config.arrow_end || "end";

  const dashArray = STROKE_DASHARRAY[strokeStyle];
  const fill = fillMode === "solid" ? fillColor : "none";
  const opacity = fillMode === "solid" ? fillOpacity : undefined;
  const halfSw = strokeWidth / 2;
  const markerId = `arrow-marker-${widget.id}`;

  const renderShape = () => {
    switch (shapeType) {
      case "rectangle":
        return (
          <rect
            x={halfSw}
            y={halfSw}
            width={100 - strokeWidth}
            height={100 - strokeWidth}
            rx={borderRadius}
            ry={borderRadius}
            fill={fill}
            fillOpacity={opacity}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={dashArray}
            vectorEffect="non-scaling-stroke"
          />
        );

      case "circle":
        return (
          <ellipse
            cx={50}
            cy={50}
            rx={50 - halfSw}
            ry={50 - halfSw}
            fill={fill}
            fillOpacity={opacity}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={dashArray}
            vectorEffect="non-scaling-stroke"
          />
        );

      case "line":
      case "arrow": {
        const endpoints = getLineEndpoints(lineDirection);
        return (
          <line
            x1={endpoints.x1}
            y1={endpoints.y1}
            x2={endpoints.x2}
            y2={endpoints.y2}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={dashArray}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            markerEnd={
              shapeType === "arrow" && (arrowEnd === "end" || arrowEnd === "both")
                ? `url(#${markerId})`
                : undefined
            }
            markerStart={
              shapeType === "arrow" && (arrowEnd === "start" || arrowEnd === "both")
                ? `url(#${markerId})`
                : undefined
            }
          />
        );
      }

      default:
        return null;
    }
  };

  return (
    <div
      className={cn("h-full w-full relative", isEditMode && "cursor-pointer")}
      onClick={isEditMode ? onSelect : undefined}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0"
        style={{ pointerEvents: "none" }}
      >
        {/* Arrow marker definition */}
        {shapeType === "arrow" && (
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={strokeColor} />
            </marker>
          </defs>
        )}
        {renderShape()}
      </svg>

      {/* Edit mode placeholder when unconfigured */}
      {isEditMode && !config.shape_type && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Click to configure shape</p>
        </div>
      )}
    </div>
  );
});
