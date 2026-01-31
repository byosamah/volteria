"use client";

/**
 * Cable Widget
 *
 * SVG-based cable/connector that visually links elements on the dashboard.
 * Supports straight, curved, and orthogonal (right-angle) paths.
 * Optional animated current flow with direction based on data values.
 */

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export interface CableConfig {
  // Connection points (grid-based coordinates)
  startX: number;
  startY: number;
  endX: number;
  endY: number;

  // Style
  pathStyle: "straight" | "curved" | "orthogonal";
  color: string;
  thickness: number;

  // Animation
  animated: boolean;
  animationSpeed: "slow" | "medium" | "fast";
  animationSource?: {
    deviceId: string;
    registerName: string;
  };
}

interface CableWidgetProps {
  config: CableConfig;
  gridColumns: number;
  gridRows: number;
  containerWidth: number;
  containerHeight: number;
  liveValue?: number | null;
  isEditMode?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  onStartDrag?: (e: React.MouseEvent) => void;
  onEndDrag?: (e: React.MouseEvent) => void;
  onCableDrag?: (e: React.MouseEvent) => void;
}

// Convert grid coordinates to pixel coordinates with clamping
function gridToPixel(
  gridX: number,
  gridY: number,
  gridColumns: number,
  gridRows: number,
  containerWidth: number,
  containerHeight: number
): { x: number; y: number } {
  // Clamp to valid grid bounds to prevent overflow
  const clampedX = Math.max(0, Math.min(gridX, gridColumns));
  const clampedY = Math.max(0, Math.min(gridY, gridRows));

  const cellWidth = containerWidth / gridColumns;
  const cellHeight = containerHeight / gridRows;
  return {
    x: clampedX * cellWidth,
    y: clampedY * cellHeight,
  };
}

// Generate SVG path based on style
function generatePath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  style: "straight" | "curved" | "orthogonal"
): string {
  switch (style) {
    case "straight":
      return `M ${startX} ${startY} L ${endX} ${endY}`;

    case "curved": {
      // Quadratic Bezier curve with control point at midpoint, offset perpendicular
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      const dx = endX - startX;
      const dy = endY - startY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance === 0) return `M ${startX} ${startY} L ${endX} ${endY}`;
      // Control point offset perpendicular to line (30% of distance)
      const offset = distance * 0.3;
      // Perpendicular vector (normalized)
      const perpX = -dy / distance;
      const perpY = dx / distance;
      const ctrlX = midX + perpX * offset;
      const ctrlY = midY + perpY * offset;
      return `M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`;
    }

    case "orthogonal": {
      // Right-angle path (horizontal first, then vertical)
      const midX = (startX + endX) / 2;
      return `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
    }

    default:
      return `M ${startX} ${startY} L ${endX} ${endY}`;
  }
}

// Animation speed to duration mapping
const ANIMATION_DURATIONS = {
  slow: "2s",
  medium: "1s",
  fast: "0.5s",
};

export function CableWidget({
  config,
  gridColumns,
  gridRows,
  containerWidth,
  containerHeight,
  liveValue,
  isEditMode,
  isSelected,
  onClick,
  onStartDrag,
  onEndDrag,
  onCableDrag,
}: CableWidgetProps) {
  // Convert grid coordinates to pixels
  const start = useMemo(
    () => gridToPixel(config.startX, config.startY, gridColumns, gridRows, containerWidth, containerHeight),
    [config.startX, config.startY, gridColumns, gridRows, containerWidth, containerHeight]
  );

  const end = useMemo(
    () => gridToPixel(config.endX, config.endY, gridColumns, gridRows, containerWidth, containerHeight),
    [config.endX, config.endY, gridColumns, gridRows, containerWidth, containerHeight]
  );

  // Generate path
  const pathD = useMemo(
    () => generatePath(start.x, start.y, end.x, end.y, config.pathStyle),
    [start.x, start.y, end.x, end.y, config.pathStyle]
  );

  // Determine animation direction based on value
  const isReverse = liveValue !== null && liveValue !== undefined && liveValue < 0;
  const animationDuration = ANIMATION_DURATIONS[config.animationSpeed] || "1s";

  // Hover state for endpoint circles
  const [startHovered, setStartHovered] = useState(false);
  const [endHovered, setEndHovered] = useState(false);

  // Calculate midpoint for toolbar positioning
  const midPoint = useMemo(() => ({
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  }), [start.x, start.y, end.x, end.y]);

  // Endpoint circle radius based on state
  const getRadius = (isHovered: boolean) => {
    if (isSelected) return isHovered ? 12 : 10;
    return isHovered ? 10 : 8;
  };

  return (
    <g className="cable-widget">
      {/* Invisible wider click area for easier selection in edit mode */}
      {isEditMode && (
        <path
          d={pathD}
          fill="none"
          stroke="transparent"
          strokeWidth={20}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="cursor-pointer"
          onClick={onClick}
        />
      )}

      {/* Selection highlight */}
      {isSelected && (
        <path
          d={pathD}
          fill="none"
          stroke="#22c55e"
          strokeWidth={config.thickness + 6}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.5}
        />
      )}

      {/* Main cable path */}
      <path
        d={pathD}
        fill="none"
        stroke={config.color}
        strokeWidth={config.thickness}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(
          config.animated && "cable-animated",
          config.animated && isReverse && "cable-reverse",
          isEditMode && "cursor-move"
        )}
        style={
          config.animated
            ? {
                strokeDasharray: "10 5",
                animation: `cable-flow ${animationDuration} linear infinite`,
                animationDirection: isReverse ? "reverse" : "normal",
              }
            : undefined
        }
        onClick={isEditMode ? onClick : undefined}
        onMouseDown={isEditMode ? (e) => {
          e.stopPropagation();
          e.preventDefault();
          onCableDrag?.(e);
        } : undefined}
      />

      {/* Edit mode: draggable endpoints */}
      {isEditMode && (
        <>
          {/* Start point handle */}
          <circle
            cx={start.x}
            cy={start.y}
            r={getRadius(startHovered)}
            fill={isSelected ? "#22c55e" : config.color}
            stroke="white"
            strokeWidth={2}
            className="cursor-move"
            style={{
              pointerEvents: "auto",
              transition: "r 0.15s ease, fill 0.15s ease",
            }}
            onMouseEnter={() => setStartHovered(true)}
            onMouseLeave={() => setStartHovered(false)}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onStartDrag?.(e);
            }}
          />
          {/* End point handle */}
          <circle
            cx={end.x}
            cy={end.y}
            r={getRadius(endHovered)}
            fill={isSelected ? "#22c55e" : config.color}
            stroke="white"
            strokeWidth={2}
            className="cursor-move"
            style={{
              pointerEvents: "auto",
              transition: "r 0.15s ease, fill 0.15s ease",
            }}
            onMouseEnter={() => setEndHovered(true)}
            onMouseLeave={() => setEndHovered(false)}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onEndDrag?.(e);
            }}
          />

          {/* Selection indicator at midpoint */}
          {isSelected && (
            <circle
              cx={midPoint.x}
              cy={midPoint.y}
              r={6}
              fill="#22c55e"
              stroke="white"
              strokeWidth={2}
            />
          )}
        </>
      )}
    </g>
  );
}

// CSS keyframes for cable animation (inject once)
if (typeof document !== "undefined") {
  const styleId = "cable-widget-styles";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes cable-flow {
        to {
          stroke-dashoffset: -15;
        }
      }
    `;
    document.head.appendChild(style);
  }
}
