"use client";

import { useRef, useCallback, useState, useMemo, useEffect } from "react";
import {
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  ReferenceLine as RechartReferenceLine,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Download, Image, RefreshCw, ZoomOut, AlertCircle } from "lucide-react";
import type { AxisParameter, ChartDataPoint, ReferenceLine, AggregationType } from "./types";
import { ChartOverlay } from "./ChartOverlay";

interface HistoricalChartProps {
  data: ChartDataPoint[];
  leftAxisParams: AxisParameter[];
  rightAxisParams: AxisParameter[];
  referenceLines: ReferenceLine[];
  isLoading: boolean;
  onRefresh: () => void;
  onExportCSV: () => void;
  onExportPNG: () => void;
  emptyMessage?: string;
  metadata?: {
    totalPoints: number;
    downsampled: boolean;
    aggregationType?: AggregationType;
    originalPoints?: number;
  };
  timezone?: string; // IANA timezone for display (e.g., "Asia/Dubai")
}

// Modern legend component with site name
function ModernLegend({
  payload,
  params
}: {
  payload?: Array<{ value: string; color: string }>;
  params?: AxisParameter[];
}) {
  if (!payload || !params) return null;

  // Create a lookup map by color for quick access to param info
  const paramsByColor = new Map(params.map(p => [p.color, p]));

  return (
    <div className="flex flex-wrap justify-center gap-3 mt-4 pt-4 border-t border-border/30">
      {payload.map((entry, index) => {
        const param = paramsByColor.get(entry.color);
        return (
          <div
            key={index}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors"
          >
            <span
              className="w-2.5 h-2.5 rounded-full shadow-sm flex-shrink-0"
              style={{ backgroundColor: entry.color }}
            />
            <div className="flex flex-col">
              <span className="text-xs font-medium text-foreground/80 leading-tight">
                {entry.value}
              </span>
              {(param?.siteName || param?.deviceName) && (
                <span className="text-[10px] text-muted-foreground leading-tight">
                  {param.siteName}{param.siteName && param.deviceName && " › "}{param.deviceName}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Aggregation label helper
function getAggregationLabel(type?: AggregationType): string {
  if (!type || type === "raw") return "";
  const labels: Record<string, string> = {
    hourly_avg: "Hourly Avg",
    hourly_min: "Hourly Min",
    hourly_max: "Hourly Max",
    daily_avg: "Daily Avg",
    daily_min: "Daily Min",
    daily_max: "Daily Max",
  };
  return labels[type] || "";
}

export function HistoricalChart({
  data,
  leftAxisParams,
  rightAxisParams,
  referenceLines,
  isLoading,
  onRefresh,
  onExportCSV,
  onExportPNG,
  emptyMessage = "Add parameters to visualize data",
  metadata,
  timezone,
}: HistoricalChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  // Zoom state
  const [zoomDomain, setZoomDomain] = useState<{ left: number; right: number } | null>(null);

  // Chart dimensions for overlay positioning
  const [chartDimensions, setChartDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Check if sparse data (< 30 points)
  const isSparseData = data.length > 0 && data.length < 30;

  // Filter data based on zoom
  const displayData = useMemo(() => {
    if (!zoomDomain) return data;
    return data.slice(zoomDomain.left, zoomDomain.right + 1);
  }, [data, zoomDomain]);

  // Track chart container dimensions using callback ref
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const chartContainerCallback = useCallback((node: HTMLDivElement | null) => {
    // Cleanup previous observer
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }

    if (!node) return;

    // Store ref for other uses
    chartContainerRef.current = node;

    // Initial measurement
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setChartDimensions({ width: rect.width, height: rect.height });
    }

    // Create ResizeObserver
    resizeObserverRef.current = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setChartDimensions({ width, height });
        }
      }
    });
    resizeObserverRef.current.observe(node);
  }, []);

  // Calculate zoom percentage
  const zoomPercentage = useMemo(() => {
    if (!zoomDomain || data.length === 0) return 100;
    const zoomedCount = zoomDomain.right - zoomDomain.left + 1;
    return Math.round((zoomedCount / data.length) * 100);
  }, [zoomDomain, data.length]);

  // Check if large dataset (disable animations for performance)
  const isLargeDataset = displayData.length > 100;

  // Handle zoom from overlay
  const handleOverlayZoom = useCallback(
    (startIdx: number, endIdx: number) => {
      // Adjust indices relative to displayData back to original data indices
      if (zoomDomain) {
        // Already zoomed - adjust relative to current zoom
        const actualStart = zoomDomain.left + startIdx;
        const actualEnd = zoomDomain.left + endIdx;
        setZoomDomain({ left: actualStart, right: actualEnd });
      } else {
        setZoomDomain({ left: startIdx, right: endIdx });
      }
    },
    [zoomDomain]
  );

  const handleResetZoom = useCallback(() => {
    setZoomDomain(null);
  }, []);

  // Generate gradient definitions for each color
  const gradientDefs = useMemo(() => {
    const allParams = [...leftAxisParams, ...rightAxisParams];
    return allParams.map((param) => ({
      id: `gradient-${param.id}`,
      color: param.color,
    }));
  }, [leftAxisParams, rightAxisParams]);

  // Calculate adaptive Y-axis domains based on actual data values
  const yAxisDomains = useMemo(() => {
    const calculateDomain = (params: AxisParameter[]): [number, number] | undefined => {
      if (params.length === 0 || displayData.length === 0) return undefined;

      let min = Infinity;
      let max = -Infinity;

      for (const param of params) {
        const dataKey = `${param.deviceId}:${param.registerName}`;
        for (const point of displayData) {
          const value = point[dataKey];
          if (typeof value === "number" && !isNaN(value)) {
            min = Math.min(min, value);
            max = Math.max(max, value);
          }
        }
      }

      // No valid data found
      if (!isFinite(min) || !isFinite(max)) return undefined;

      // If all values are the same, add some range
      if (min === max) {
        const padding = Math.abs(min) * 0.1 || 1;
        return [min - padding, max + padding];
      }

      // Add 10% padding above and below for nice visual
      const range = max - min;
      const padding = range * 0.1;

      // Round to "nice" values for cleaner axis ticks
      const niceMin = Math.floor((min - padding) * 10) / 10;
      const niceMax = Math.ceil((max + padding) * 10) / 10;

      return [niceMin, niceMax];
    };

    return {
      left: calculateDomain(leftAxisParams),
      right: calculateDomain(rightAxisParams),
    };
  }, [displayData, leftAxisParams, rightAxisParams]);

  // Render chart elements for parameters
  const renderChartElements = useCallback(
    (params: AxisParameter[], yAxisId: string) => {
      return params.map((param) => {
        const dataKey = `${param.deviceId}:${param.registerName}`;
        const name = `${param.registerName}`;
        const showDots = isSparseData;

        // Disable animation and active dot for large datasets
        const animationProps = isLargeDataset
          ? { isAnimationActive: false }
          : { animationDuration: 400, animationEasing: "ease-out" as const };

        // Disable active dot completely for large datasets (causes lag)
        const activeDotProps = isLargeDataset
          ? false
          : { r: 5, strokeWidth: 2, stroke: "var(--background)" };

        switch (param.chartType) {
          case "area":
            return (
              <Area
                key={param.id}
                type="monotone"
                dataKey={dataKey}
                name={name}
                stroke={param.color}
                fill={`url(#gradient-${param.id})`}
                strokeWidth={isLargeDataset ? 1.5 : 2}
                yAxisId={yAxisId}
                dot={showDots ? { r: 3, fill: param.color, strokeWidth: 0 } : false}
                activeDot={activeDotProps}
                connectNulls
                {...animationProps}
              />
            );
          case "bar":
            return (
              <Bar
                key={param.id}
                dataKey={dataKey}
                name={name}
                fill={param.color}
                fillOpacity={0.85}
                radius={[4, 4, 0, 0]}
                yAxisId={yAxisId}
                {...animationProps}
              />
            );
          case "line":
          default:
            return (
              <Line
                key={param.id}
                type="monotone"
                dataKey={dataKey}
                name={name}
                stroke={param.color}
                yAxisId={yAxisId}
                dot={showDots ? { r: 3, fill: param.color, strokeWidth: 0 } : false}
                activeDot={activeDotProps}
                strokeWidth={isLargeDataset ? 1.5 : 2}
                connectNulls
                {...animationProps}
              />
            );
        }
      });
    },
    [isSparseData, isLargeDataset]
  );

  // Check if we have any parameters
  const hasLeftParams = leftAxisParams.length > 0;
  const hasRightParams = rightAxisParams.length > 0;
  const hasParams = hasLeftParams || hasRightParams;
  const hasData = data.length > 0;
  const isZoomed = zoomDomain !== null;


  // Show empty state
  if (!hasParams || !hasData) {
    return (
      <div className="relative">
        {/* Options menu (disabled state) */}
        <div className="absolute top-2 right-2 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          </DropdownMenu>
        </div>

        {/* Empty state */}
        <div className="h-[450px] flex items-center justify-center border border-dashed rounded-xl bg-muted/10">
          <div className="text-center space-y-2">
            {isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin" />
                <span>Loading data...</span>
              </div>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                  <AlertCircle className="h-6 w-6 text-muted-foreground/50" />
                </div>
                <p className="text-muted-foreground text-sm">{emptyMessage}</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Get aggregation label
  const aggregationLabel = getAggregationLabel(metadata?.aggregationType);

  return (
    <div className="relative" ref={chartRef}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        {/* Left side - zoom hint or zoom reset */}
        <div className="flex items-center gap-2">
          {isZoomed ? (
            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1.5 text-xs rounded-full px-3"
              onClick={handleResetZoom}
            >
              <ZoomOut className="h-3.5 w-3.5" />
              Reset Zoom
              <span className="text-muted-foreground ml-1">({zoomPercentage}%)</span>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground/60">
              Drag on chart to zoom
            </span>
          )}
        </div>

        {/* Right side - metadata and actions */}
        <div className="flex items-center gap-3">
          {/* Sparse data warning */}
          {isSparseData && (
            <span className="text-[11px] text-amber-600 bg-amber-500/10 px-2.5 py-1 rounded-full font-medium">
              Sparse data
            </span>
          )}

          {/* Aggregation badge */}
          {aggregationLabel && metadata?.originalPoints && (
            <span className="text-[11px] text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-full">
              {aggregationLabel}
              <span className="ml-1.5 opacity-60">
                {metadata.originalPoints} → {metadata.totalPoints}
              </span>
            </span>
          )}

          {/* Point count */}
          {metadata && !aggregationLabel && (
            <span className="text-xs text-muted-foreground">
              {displayData.length.toLocaleString()} points
            </span>
          )}

          {/* Divider */}
          <div className="w-px h-5 bg-border/50" />

          {/* Refresh button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onRefresh}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>

          {/* Export menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onExportCSV}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExportPNG}>
                <Image className="h-4 w-4 mr-2" />
                Export PNG
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Chart area - use DOM overlay for large datasets to avoid Recharts re-renders */}
      <div className="px-1 select-none">
        <div
          ref={chartContainerCallback}
          className="relative"
          style={{ height: 380 }}
        >
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart
              data={displayData}
              margin={{ top: 8, right: hasRightParams ? 55 : 20, left: 0, bottom: 5 }}
            >
          {/* Gradient definitions */}
          <defs>
            {gradientDefs.map((def) => (
              <linearGradient key={def.id} id={def.id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={def.color} stopOpacity={0.35} />
                <stop offset="95%" stopColor={def.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>

          {/* Subtle horizontal grid only */}
          <CartesianGrid
            strokeDasharray="0"
            stroke="currentColor"
            strokeOpacity={0.06}
            vertical={false}
          />

          {/* X-Axis with dynamic formatting and smart tick interval */}
          <XAxis
            dataKey="timestamp"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            stroke="transparent"
            tickLine={false}
            axisLine={false}
            dy={8}
            // Smart interval: show ~8-12 ticks regardless of data density
            interval={Math.max(0, Math.floor(displayData.length / 10) - 1)}
            tickFormatter={(timestamp: string) => {
              if (!timestamp) return "";
              const date = new Date(timestamp);

              // Calculate the range of displayed data
              const firstTs = displayData[0]?.timestamp;
              const lastTs = displayData[displayData.length - 1]?.timestamp;
              if (!firstTs || !lastTs) return date.toLocaleDateString();

              const rangeMs = new Date(lastTs).getTime() - new Date(firstTs).getTime();
              const rangeHours = rangeMs / (1000 * 60 * 60);

              // Format options with timezone
              const tzOptions = timezone ? { timeZone: timezone } : {};

              // Format based on data range - clean, unambiguous formats
              if (rangeHours <= 26) {
                // ≤1 day: time only (HH:mm)
                return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, ...tzOptions });
              } else if (rangeHours <= 72) {
                // 1-3 days: "17 Jan 14:00" format (day-month-time, numbers separated by text)
                const day = date.toLocaleDateString("en-US", { day: "numeric", ...tzOptions });
                const month = date.toLocaleDateString("en-US", { month: "short", ...tzOptions });
                const time = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, ...tzOptions });
                return `${day} ${month} ${time}`;
              } else {
                // >3 days: date only "17 Jan" (time would be too crowded)
                const day = date.toLocaleDateString("en-US", { day: "numeric", ...tzOptions });
                const month = date.toLocaleDateString("en-US", { month: "short", ...tzOptions });
                return `${day} ${month}`;
              }
            }}
          />

          {/* Left Y-Axis with adaptive domain */}
          {hasLeftParams && (
            <YAxis
              yAxisId="left"
              orientation="left"
              stroke="transparent"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              domain={yAxisDomains.left || ["auto", "auto"]}
              tickFormatter={(value: number) => {
                if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
                return value.toFixed(1);
              }}
              width={55}
              dx={-5}
            />
          )}

          {/* Right Y-Axis with adaptive domain */}
          {hasRightParams && (
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="transparent"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              domain={yAxisDomains.right || ["auto", "auto"]}
              tickFormatter={(value: number) => {
                if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
                return value.toFixed(1);
              }}
              width={55}
            />
          )}

          {/* Tooltip removed - DOM overlay handles all tooltips now */}

          {/* Modern legend */}
          <Legend content={<ModernLegend params={[...leftAxisParams, ...rightAxisParams]} />} />

          {/* Render chart elements */}
          {renderChartElements(leftAxisParams, "left")}
          {renderChartElements(rightAxisParams, "right")}

          {/* Reference lines */}
          {referenceLines.map((line) => (
            <RechartReferenceLine
              key={line.id}
              y={line.value}
              yAxisId={line.axis}
              stroke={line.color}
              strokeDasharray="6 4"
              strokeOpacity={0.6}
              label={{
                value: line.label,
                fill: line.color,
                fontSize: 10,
                position: "right",
              }}
            />
          ))}

        </ComposedChart>
          </ResponsiveContainer>

          {/* DOM Overlay - handles zoom and tooltip for all datasets */}
          {chartDimensions.width > 0 && (
            <ChartOverlay
              data={displayData}
              leftAxisParams={leftAxisParams}
              rightAxisParams={rightAxisParams}
              onZoom={handleOverlayZoom}
              chartMargins={{ left: 55, right: hasRightParams ? 55 : 20, top: 8, bottom: 5 }}
              width={chartDimensions.width}
              height={chartDimensions.height}
              showTooltip={true} // Always show overlay tooltip (overlay blocks Recharts events)
              timezone={timezone}
            />
          )}
        </div>
      </div>
    </div>
  );
}
