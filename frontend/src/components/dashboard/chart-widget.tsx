"use client";

/**
 * Chart Widget
 *
 * Displays a customizable chart for selected device registers.
 * Supports line, area, and bar chart types with dual Y-axis.
 * Uses the same data source as Historical Data page.
 */

import { useState, useEffect, memo, useMemo } from "react";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ComposedChart,
} from "recharts";
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

interface ChartParameter {
  id: string;
  device_id: string;
  device_name: string;
  register_name: string;
  label?: string;
  unit?: string;
  color: string;
  y_axis: "left" | "right";
  chart_type?: "line" | "area" | "bar";
}

interface ChartWidgetConfig {
  title?: string;
  chart_type?: "line" | "area" | "bar";
  time_range?: "1h" | "6h" | "24h" | "7d";
  aggregation?: "raw" | "hourly" | "daily";
  parameters?: ChartParameter[];
}

interface ChartWidgetProps {
  widget: Widget;
  liveData: LiveData | null;
  isEditMode: boolean;
  onSelect: () => void;
  siteId: string;
  cellHeight?: number; // Cell height from grid density
}

interface ChartDataPoint {
  timestamp: string;
  time: string;
  [key: string]: string | number | null;
}

const TIME_RANGES: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

// Map time range to appropriate aggregation
const getApiAggregation = (timeRange: string, aggregation: string): string => {
  if (aggregation === "raw") return "raw";
  if (aggregation === "hourly") return "hourly_avg";
  if (aggregation === "daily") return "daily_avg";

  // Auto-select based on time range
  if (timeRange === "1h" || timeRange === "6h") return "raw";
  if (timeRange === "24h") return "hourly_avg";
  return "daily_avg";
};

// Format time based on range
const formatTime = (timestamp: string, timeRange: string): string => {
  const date = new Date(timestamp);
  if (timeRange === "7d") {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  if (timeRange === "24h") {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export const ChartWidget = memo(function ChartWidget({
  widget,
  isEditMode,
  onSelect,
  siteId,
  cellHeight = 100, // Default to medium density
}: ChartWidgetProps) {
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config = widget.config as ChartWidgetConfig;
  const timeRange = config.time_range || "1h";
  const aggregation = config.aggregation || "raw";

  // Calculate fixed chart height based on grid cell height (passed from dashboard-canvas)
  const GAP = 8;
  const TITLE_HEIGHT = config.title ? 44 : 0; // title (24px) + margin (16px) + padding
  const CONTAINER_PADDING = 16; // p-2 = 8px * 2
  const chartHeight = Math.max(
    80,
    (widget.grid_height * cellHeight) + ((widget.grid_height - 1) * GAP) - TITLE_HEIGHT - CONTAINER_PADDING
  );

  // Stable memoization using JSON string as dependency
  // This prevents recalculation unless actual config content changes
  const configParamsJson = JSON.stringify(config.parameters || []);

  const { parameters, leftParams, rightParams } = useMemo(() => {
    // Parse from JSON to ensure we use the exact data that triggered the memo
    const params: ChartParameter[] = configParamsJson ? JSON.parse(configParamsJson) : [];

    // Normalize y_axis values and split into left/right
    const left: ChartParameter[] = [];
    const right: ChartParameter[] = [];

    for (const p of params) {
      const yAxis = String(p.y_axis || "left").toLowerCase();
      if (yAxis === "right") {
        right.push(p);
      } else {
        left.push(p);
      }
    }

    return { parameters: params, leftParams: left, rightParams: right };
  }, [configParamsJson]);

  // Fetch historical data
  useEffect(() => {
    if (isEditMode || parameters.length === 0) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const now = new Date();
        const startTime = new Date(now.getTime() - TIME_RANGES[timeRange]);

        // Collect unique device IDs and register names
        const deviceIds = [...new Set(parameters.map(p => p.device_id))];
        const registerNames = [...new Set(parameters.map(p => p.register_name))];

        const apiAggregation = getApiAggregation(timeRange, aggregation);

        const params = new URLSearchParams({
          siteIds: siteId,
          deviceIds: deviceIds.join(","),
          registers: registerNames.join(","),
          start: startTime.toISOString(),
          end: now.toISOString(),
          aggregation: apiAggregation,
        });

        const response = await fetch(`/api/historical?${params}`);

        if (!response.ok) {
          throw new Error("Failed to fetch data");
        }

        const result = await response.json();

        if (!result.deviceReadings || result.deviceReadings.length === 0) {
          setChartData([]);
          return;
        }

        // Transform API response to chart format
        // API returns: { deviceReadings: [{ device_id, register_name, data: [{timestamp, value}] }] }
        const timestampSet = new Set<string>();
        const dataLookup: Record<string, Record<string, number | null>> = {};

        result.deviceReadings.forEach((reading: { device_id: string; register_name: string; data: Array<{ timestamp: string; value: number | null }> }) => {
          const key = `${reading.device_id}:${reading.register_name}`;
          dataLookup[key] = {};
          reading.data.forEach((point: { timestamp: string; value: number | null }) => {
            timestampSet.add(point.timestamp);
            dataLookup[key][point.timestamp] = point.value;
          });
        });

        // Sort timestamps
        const timestamps = Array.from(timestampSet).sort();

        // Smart downsampling: preserve timestamps where sparse parameters have data
        const maxPoints = 150;
        let sampledTimestamps: string[];

        if (timestamps.length <= maxPoints) {
          sampledTimestamps = timestamps;
        } else {
          // Find timestamps where each parameter has non-null data
          const paramKeys = parameters.map(p => `${p.device_id}:${p.register_name}`);

          // Prioritize timestamps that have data for ALL parameters
          const timestampsWithAllData = timestamps.filter(ts =>
            paramKeys.every(key => dataLookup[key]?.[ts] != null)
          );

          // Also get timestamps with data for ANY sparse parameter (non-primary)
          const timestampsWithSparseData = timestamps.filter(ts =>
            paramKeys.slice(1).some(key => dataLookup[key]?.[ts] != null)
          );

          // Combine: all sparse data timestamps + evenly sampled primary timestamps
          const sparseSet = new Set([...timestampsWithAllData, ...timestampsWithSparseData]);
          const remainingSlots = maxPoints - sparseSet.size;

          if (remainingSlots > 0) {
            // Fill remaining slots with evenly distributed timestamps
            const step = Math.ceil(timestamps.length / remainingSlots);
            const evenSamples = timestamps.filter((ts, i) => i % step === 0 && !sparseSet.has(ts));
            sampledTimestamps = [...sparseSet, ...evenSamples.slice(0, remainingSlots)].sort();
          } else {
            // Too many sparse points, just take them all up to maxPoints
            sampledTimestamps = [...sparseSet].sort().slice(0, maxPoints);
          }
        }

        // Build chart data points
        const chartPoints: ChartDataPoint[] = sampledTimestamps.map(timestamp => {
          const point: ChartDataPoint = {
            timestamp,
            time: formatTime(timestamp, timeRange),
          };

          parameters.forEach(param => {
            const key = `${param.device_id}:${param.register_name}`;
            // Use register_name as consistent key for data lookup and chart dataKey
            const paramKey = param.register_name;
            point[paramKey] = dataLookup[key]?.[timestamp] ?? null;
          });

          return point;
        });

        setChartData(chartPoints);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
        setChartData([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    // Refresh every 30 seconds if not in edit mode
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [siteId, parameters, timeRange, aggregation, isEditMode]);

  // Calculate Y-axis domains
  const yAxisDomains = useMemo(() => {
    type DomainValue = [number, number] | [string, string] | undefined;
    const calculateDomain = (params: ChartParameter[]): DomainValue => {
      if (params.length === 0 || chartData.length === 0) return undefined;

      let min = Infinity;
      let max = -Infinity;

      for (const param of params) {
        const key = param.register_name;
        for (const point of chartData) {
          const value = point[key];
          if (typeof value === "number" && !isNaN(value)) {
            min = Math.min(min, value);
            max = Math.max(max, value);
          }
        }
      }

      // If no valid data, let Recharts auto-calculate from available data
      if (min === Infinity || max === -Infinity) return ["dataMin", "dataMax"] as [string, string];

      // Add 10% padding
      const padding = (max - min) * 0.1 || 1;
      return [Math.floor((min - padding) * 10) / 10, Math.ceil((max + padding) * 10) / 10];
    };

    return {
      left: calculateDomain(leftParams),
      right: calculateDomain(rightParams),
    };
  }, [chartData, leftParams, rightParams]);

  // Render chart using ComposedChart for dual axis support
  // NOTE: This function is ONLY called when chartData.length > 0
  // Empty state is handled outside ResponsiveContainer to avoid Recharts warnings
  const renderChart = () => {
    const commonAxisProps = {
      stroke: "#888888",
      fontSize: 10,
      tickLine: false,
      axisLine: false,
    };

    const hasLeftAxis = leftParams.length > 0;
    const hasRightAxis = rightParams.length > 0;

    // Get unit labels for axes
    const leftUnit = leftParams[0]?.unit || "";
    const rightUnit = rightParams[0]?.unit || "";

    const renderElements = (params: ChartParameter[], yAxisId: string) => {
      return params.map((param) => {
        const key = param.register_name;
        const paramChartType = param.chart_type || "line";

        if (paramChartType === "area") {
          return (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              yAxisId={yAxisId}
              stroke={param.color}
              fill={param.color}
              fillOpacity={0.2}
              strokeWidth={2}
              connectNulls
            />
          );
        }

        if (paramChartType === "bar") {
          return (
            <Bar
              key={key}
              dataKey={key}
              yAxisId={yAxisId}
              fill={param.color}
            />
          );
        }

        return (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            yAxisId={yAxisId}
            stroke={param.color}
            strokeWidth={3}
            dot={false}
            connectNulls
          />
        );
      });
    };

    // Always render both Y-axes to avoid Recharts conditional rendering issues
    // Hide unused axis by not showing ticks/labels
    return (
      <ComposedChart
        data={chartData}
        margin={{ top: 5, right: hasRightAxis ? 50 : 5, left: -15, bottom: 5 }}
      >
        <XAxis dataKey="time" {...commonAxisProps} />

        <YAxis
          yAxisId="left"
          orientation="left"
          domain={yAxisDomains.left || ["auto", "auto"]}
          {...commonAxisProps}
          hide={!hasLeftAxis}
          label={hasLeftAxis && leftUnit ? { value: leftUnit, angle: -90, position: "insideLeft", fontSize: 9, fill: "#888" } : undefined}
        />

        <YAxis
          yAxisId="right"
          orientation="right"
          domain={yAxisDomains.right || ["auto", "auto"]}
          {...commonAxisProps}
          hide={!hasRightAxis}
          label={hasRightAxis && rightUnit ? { value: rightUnit, angle: 90, position: "insideRight", fontSize: 9, fill: "#888" } : undefined}
        />

        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            fontSize: "11px",
          }}
          formatter={(value: number, name: string) => {
            const param = parameters.find(p => p.register_name === name);
            // Display label if available, otherwise register_name
            const displayName = param?.label || name;
            return [`${value?.toFixed(2) ?? "--"} ${param?.unit || ""}`, displayName];
          }}
        />

        {parameters.length > 1 && (
          <Legend
            wrapperStyle={{ fontSize: "10px", paddingTop: "4px" }}
            iconSize={8}
          />
        )}

        {renderElements(leftParams, "left")}
        {renderElements(rightParams, "right")}
      </ComposedChart>
    );
  };

  return (
    <div
      className={cn(
        "h-full flex flex-col p-2",
        isEditMode && "cursor-pointer"
      )}
      onClick={isEditMode ? onSelect : undefined}
    >
      {/* Title */}
      {config.title && (
        <p className="text-base font-medium mb-3 pl-1 truncate">{config.title}</p>
      )}

      {/* Chart - fixed height calculated from grid_height to avoid ResponsiveContainer timing issues */}
      <div className="w-full" style={{ height: chartHeight }}>
        {isLoading && chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
          </div>
        ) : parameters.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm text-center px-2">
            {isEditMode ? "Click to configure chart" : "No parameters selected"}
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            {error || "No data available"}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={chartHeight}>
            {renderChart()}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
});
