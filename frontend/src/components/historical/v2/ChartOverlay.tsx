"use client";

import { useRef, useCallback, useState } from "react";
import type { AxisParameter, ChartDataPoint } from "./types";
import { OverlayTooltip } from "./OverlayTooltip";

interface ChartOverlayProps {
  data: ChartDataPoint[];
  leftAxisParams: AxisParameter[];
  rightAxisParams: AxisParameter[];
  onZoom: (startIdx: number, endIdx: number) => void;
  chartMargins: { left: number; right: number; top: number; bottom: number };
  xAxisPadding: { left: number; right: number }; // Recharts XAxis padding
  yAxisWidth: number; // Width of the left YAxis (pushes data area right)
  rightYAxisWidth?: number; // Width of the right YAxis (0 if no right axis)
  width: number;
  height: number;
  showTooltip?: boolean; // Whether to show overlay tooltip (false = let Recharts handle it)
  timezone?: string; // IANA timezone for display
}

// Legend takes approximately 60px at bottom
const LEGEND_HEIGHT = 60;

export function ChartOverlay({
  data,
  leftAxisParams,
  rightAxisParams,
  onZoom,
  chartMargins,
  xAxisPadding,
  yAxisWidth,
  rightYAxisWidth = 0,
  width,
  height,
  showTooltip = true,
  timezone,
}: ChartOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const cursorLineRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<HTMLDivElement>(null);

  // Use refs for drag state to avoid re-renders
  const isDragging = useRef(false);
  const dragStartX = useRef<number | null>(null);
  const dragEndX = useRef<number | null>(null);

  // Only use state for tooltip (needs React rendering)
  const [tooltipData, setTooltipData] = useState<{
    x: number;
    y: number;
    dataPoint: ChartDataPoint | null;
    visible: boolean;
  }>({ x: 0, y: 0, dataPoint: null, visible: false });

  // Calculate the actual plot area dimensions
  const plotLeft = chartMargins.left;
  const plotRight = width - chartMargins.right;
  const plotWidth = plotRight - plotLeft;
  const plotTop = chartMargins.top;
  // Account for legend height - legend sits below the chart area
  const plotBottom = height - chartMargins.bottom - LEGEND_HEIGHT;
  const plotHeight = plotBottom - plotTop;

  // Data area accounts for both YAxis widths and XAxis padding
  // Left: offset by left Y-axis width + XAxis padding
  // Right: offset by right Y-axis width + XAxis padding
  // (Recharts draws Y-axes INSIDE the margin area, reducing the data area)
  const dataLeft = plotLeft + yAxisWidth + xAxisPadding.left;
  const dataRight = plotRight - rightYAxisWidth - xAxisPadding.right;
  const dataWidth = dataRight - dataLeft;

  // Convert pixel X position to data index
  // Uses data area (with XAxis padding) for accurate index calculation
  // Returns -1 if outside data area (no tooltip in padding zones)
  const pixelToIndex = useCallback(
    (pixelX: number): number => {
      if (data.length === 0) return -1;

      // Reject if outside data area (in XAxis padding zones)
      if (pixelX < dataLeft || pixelX > dataRight) return -1;

      const relativeX = pixelX - dataLeft;
      const ratio = relativeX / dataWidth;

      // Linear mapping to index
      const index = Math.round(ratio * (data.length - 1));
      return Math.max(0, Math.min(data.length - 1, index));
    },
    [data.length, dataLeft, dataRight, dataWidth]
  );

  // Check if position is within plot area
  const isInPlotArea = useCallback(
    (x: number, y: number): boolean => {
      return x >= plotLeft && x <= plotRight && y >= plotTop && y <= plotBottom;
    },
    [plotLeft, plotRight, plotTop, plotBottom]
  );

  // Update cursor line position directly (no React state)
  // Note: cursor is inside a clipping container that starts at plotLeft,
  // so we use coordinates relative to that container (subtract plotLeft)
  const updateCursorLine = useCallback(
    (x: number | null, visible: boolean) => {
      if (!cursorLineRef.current) return;

      if (!visible || x === null) {
        cursorLineRef.current.style.opacity = "0";
        return;
      }

      // Clamp to plot area and convert to container-relative coordinates
      const clampedX = Math.max(plotLeft, Math.min(plotRight, x));
      const relativeX = clampedX - plotLeft;
      cursorLineRef.current.style.transform = `translateX(${relativeX}px)`;
      cursorLineRef.current.style.opacity = "1";
    },
    [plotLeft, plotRight]
  );

  // Update selection rectangle directly (no React state)
  // Note: selection is inside a clipping container that starts at plotLeft
  const updateSelection = useCallback(() => {
    if (!selectionRef.current) return;

    if (!isDragging.current || dragStartX.current === null || dragEndX.current === null) {
      selectionRef.current.style.opacity = "0";
      return;
    }

    const startX = Math.max(plotLeft, Math.min(plotRight, dragStartX.current));
    const endX = Math.max(plotLeft, Math.min(plotRight, dragEndX.current));
    // Convert to container-relative coordinates
    const relativeLeft = Math.min(startX, endX) - plotLeft;
    const selWidth = Math.abs(endX - startX);

    selectionRef.current.style.transform = `translateX(${relativeLeft}px)`;
    selectionRef.current.style.width = `${selWidth}px`;
    selectionRef.current.style.opacity = "1";
  }, [plotLeft, plotRight]);

  // Handle mouse down - start drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (!isInPlotArea(x, y)) return;

      isDragging.current = true;
      dragStartX.current = x;
      dragEndX.current = x;

      // Hide tooltip during drag
      setTooltipData((prev) => ({ ...prev, visible: false }));
    },
    [isInPlotArea]
  );

  // Handle mouse move - update cursor and selection
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const inPlot = isInPlotArea(x, y);

      // Update cursor line
      updateCursorLine(x, inPlot && !isDragging.current);

      // Update selection during drag
      if (isDragging.current) {
        dragEndX.current = x;
        updateSelection();
        return;
      }

      // Update tooltip when not dragging
      if (inPlot && data.length > 0) {
        const index = pixelToIndex(x);

        // Only show tooltip if we have a valid data point (index = -1 means outside data area)
        if (index >= 0 && index < data.length) {
          const dataPoint = data[index];
          setTooltipData({
            x: Math.max(plotLeft, Math.min(plotRight, x)),
            y,
            dataPoint,
            visible: true,
          });
        } else {
          setTooltipData((prev) => ({ ...prev, visible: false }));
        }
      } else {
        setTooltipData((prev) => ({ ...prev, visible: false }));
      }
    },
    [data, isInPlotArea, pixelToIndex, plotLeft, plotRight, updateCursorLine, updateSelection]
  );

  // Handle mouse up - complete zoom
  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging.current) return;

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      dragEndX.current = x;

      // Calculate indices
      if (dragStartX.current !== null && dragEndX.current !== null) {
        const startIdx = pixelToIndex(dragStartX.current);
        const endIdx = pixelToIndex(dragEndX.current);

        // Only zoom if both indices are valid and selection spans at least 3 points
        if (startIdx >= 0 && endIdx >= 0 && Math.abs(endIdx - startIdx) >= 2) {
          const minIdx = Math.min(startIdx, endIdx);
          const maxIdx = Math.max(startIdx, endIdx);
          onZoom(minIdx, maxIdx);
        }
      }

      // Reset drag state
      isDragging.current = false;
      dragStartX.current = null;
      dragEndX.current = null;

      // Hide selection
      if (selectionRef.current) {
        selectionRef.current.style.opacity = "0";
      }
    },
    [onZoom, pixelToIndex]
  );

  // Handle mouse leave
  const handleMouseLeave = useCallback(() => {
    // Hide cursor
    updateCursorLine(null, false);

    // Hide tooltip
    setTooltipData((prev) => ({ ...prev, visible: false }));

    // Reset drag if in progress
    if (isDragging.current) {
      isDragging.current = false;
      dragStartX.current = null;
      dragEndX.current = null;
      if (selectionRef.current) {
        selectionRef.current.style.opacity = "0";
      }
    }
  }, [updateCursorLine]);

  // Get all parameters for tooltip
  const allParams = [...leftAxisParams, ...rightAxisParams];

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-10"
      style={{ cursor: "crosshair" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {/* Clipping container for cursor and selection - constrains to plot area */}
      <div
        className="absolute pointer-events-none overflow-hidden"
        style={{
          left: plotLeft,
          top: plotTop,
          width: plotWidth,
          height: plotHeight,
        }}
      >
        {/* Vertical cursor line - only for large datasets */}
        {showTooltip && (
          <div
            ref={cursorLineRef}
            className="absolute bg-border"
            style={{
              top: 0,
              left: 0,
              width: 2,
              height: "100%",
              opacity: 0,
              willChange: "transform",
            }}
          />
        )}

        {/* Selection rectangle */}
        <div
          ref={selectionRef}
          className="absolute bg-primary/15 border-l-2 border-r-2 border-primary/50"
          style={{
            top: 0,
            left: 0,
            height: "100%",
            opacity: 0,
            willChange: "transform, width",
          }}
        />
      </div>

      {/* Tooltip - only for large datasets, small datasets use Recharts tooltip */}
      {showTooltip && tooltipData.visible && tooltipData.dataPoint && (
        <OverlayTooltip
          x={tooltipData.x}
          y={tooltipData.y}
          dataPoint={tooltipData.dataPoint}
          parameters={allParams}
          containerWidth={width}
          containerHeight={height}
          timezone={timezone}
        />
      )}
    </div>
  );
}
