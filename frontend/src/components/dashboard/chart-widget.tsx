"use client";

/**
 * Chart Widget
 *
 * Displays a customizable chart for selected device registers.
 * Supports line, area, and bar chart types with dual Y-axis.
 * Uses the same data source as Historical Data page.
 */

import { useState, useEffect, useRef, memo, useMemo } from "react";
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
  siteId
}: ChartWidgetProps) {
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track container dimensions
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  // ResizeObserver to track container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const config = widget.config as ChartWidgetConfig;
  const timeRange = config.time_range || "1h";
  const aggregation = config.aggregation || "raw";
  const parameters = config.parameters || [];

  // Split parameters by axis (case-insensitive, default to "left")
  const leftParams = useMemo(() => parameters.filter(p =>
    !p.y_axis || p.y_axis.toLowerCase() !== "right"
  ), [parameters]);
  const rightParams = useMemo(() => parameters.filter(p =>
    p.y_axis && p.y_axis.toLowerCase() === "right"
  ), [parameters]);


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

        // Downsample if needed (max 100 points for widget performance)
        const maxPoints = 100;
        const step = timestamps.length > maxPoints ? Math.ceil(timestamps.length / maxPoints) : 1;
        const sampledTimestamps = timestamps.filter((_, i) => i % step === 0);

        // Build chart data points
        const chartPoints: ChartDataPoint[] = sampledTimestamps.map(timestamp => {
          const point: ChartDataPoint = {
            timestamp,
            time: formatTime(timestamp, timeRange),
          };

          parameters.forEach(param => {
            const key = `${param.device_id}:${param.register_name}`;
            const paramKey = param.label || param.register_name;
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
    const calculateDomain = (params: ChartParameter[]): [number, number] | undefined => {
      if (params.length === 0 || chartData.length === 0) return undefined;

      let min = Infinity;
      let max = -Infinity;

      for (const param of params) {
        const key = param.label || param.register_name;
        for (const point of chartData) {
          const value = point[key];
          if (typeof value === "number" && !isNaN(value)) {
            min = Math.min(min, value);
            max = Math.max(max, value);
          }
        }
      }

      if (min === Infinity || max === -Infinity) return undefined;

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
  const renderChart = () => {
    if (chartData.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
          {error || "No data available"}
        </div>
      );
    }

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
        const key = param.label || param.register_name;
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
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        );
      });
    };

    return (
      <ComposedChart
        data={chartData}
        margin={{ top: 5, right: hasRightAxis ? 35 : 10, left: -15, bottom: 5 }}
      >
        <XAxis dataKey="time" {...commonAxisProps} />

        {hasLeftAxis && (
          <YAxis
            yAxisId="left"
            orientation="left"
            domain={yAxisDomains.left || ["auto", "auto"]}
            {...commonAxisProps}
            label={leftUnit ? { value: leftUnit, angle: -90, position: "insideLeft", fontSize: 9, fill: "#888" } : undefined}
          />
        )}

        {hasRightAxis && (
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={yAxisDomains.right || ["auto", "auto"]}
            {...commonAxisProps}
            label={rightUnit ? { value: rightUnit, angle: 90, position: "insideRight", fontSize: 9, fill: "#888" } : undefined}
          />
        )}

        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            fontSize: "11px",
          }}
          formatter={(value: number, name: string) => {
            const param = parameters.find(p => (p.label || p.register_name) === name);
            return [`${value?.toFixed(2) ?? "--"} ${param?.unit || ""}`, name];
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

      {/* Chart */}
      <div ref={containerRef} className="flex-1 min-h-0">
        {isLoading && chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
          </div>
        ) : parameters.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm text-center px-2">
            {isEditMode ? "Click to configure chart" : "No parameters selected"}
          </div>
        ) : dimensions ? (
          <ResponsiveContainer width={dimensions.width} height={Math.max(80, dimensions.height)}>
            {renderChart()}
          </ResponsiveContainer>
        ) : null}
      </div>
    </div>
  );
});
