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
  rotation?: number;
  arrow_end?: "end" | "start" | "both";
  // Legacy — mapped to rotation on read
  line_direction?: "horizontal" | "vertical" | "diagonal-down" | "diagonal-up";
}

const STROKE_DASHARRAY: Record<string, string | undefined> = {
  solid: undefined,
  dashed: "8 4",
  dotted: "2 2",
};

/** Map legacy line_direction values to rotation degrees */
const DIRECTION_TO_ROTATION: Record<string, number> = {
  horizontal: 0,
  "diagonal-down": 45,
  vertical: 90,
  "diagonal-up": 315,
};

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
  const arrowEnd = config.arrow_end || "end";

  // Rotation: use explicit rotation, or migrate from legacy line_direction
  const rotation = config.rotation ?? (config.line_direction ? DIRECTION_TO_ROTATION[config.line_direction] ?? 0 : 0);

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
      case "arrow":
        return (
          <line
            x1={5}
            y1={50}
            x2={95}
            y2={50}
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

      default:
        return null;
    }
  };

  return (
    <div
      className={cn("h-full w-full relative", isEditMode && "cursor-pointer")}
      onClick={isEditMode ? onSelect : undefined}
      style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
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
