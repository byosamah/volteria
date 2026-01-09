"use client";

/**
 * Chart Widget
 *
 * Displays a customizable chart for selected registers.
 * Supports line, area, and bar chart types.
 * Time range: 1h, 6h, 24h, 7d
 */

import { useState, useEffect, memo } from "react";
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
} from "recharts";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

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

const TIME_RANGES = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

const COLORS = [
  "#22c55e", // green
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // purple
  "#06b6d4", // cyan
];

export const ChartWidget = memo(function ChartWidget({ widget, liveData, isEditMode, onSelect, siteId }: ChartWidgetProps) {
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const config = widget.config as {
    chart_type?: "line" | "area" | "bar";
    title?: string;
    time_range?: "1h" | "6h" | "24h" | "7d";
    series?: Array<{
      device_id?: string;
      register_name: string;
      label: string;
      color?: string;
    }>;
  };

  const chartType = config.chart_type || "line";
  const timeRange = config.time_range || "1h";
  const series = config.series || [];

  // Fetch historical data
  useEffect(() => {
    if (isEditMode || series.length === 0) return;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const supabase = createClient();
        const now = new Date();
        const startTime = new Date(now.getTime() - TIME_RANGES[timeRange]);

        // For now, fetch from control_logs for aggregate data
        const { data, error } = await supabase
          .from("control_logs")
          .select("timestamp, total_load_kw, solar_output_kw, dg_power_kw, solar_limit_pct")
          .eq("site_id", siteId)
          .gte("timestamp", startTime.toISOString())
          .order("timestamp", { ascending: true })
          .limit(500);

        if (error) {
          return;
        }

        if (!data || data.length === 0) {
          setChartData([]);
          return;
        }

        // Downsample if needed (max 100 points for performance)
        const maxPoints = 100;
        const step = data.length > maxPoints ? Math.ceil(data.length / maxPoints) : 1;
        const downsampled = data.filter((_, i) => i % step === 0);

        // Map to chart format
        const mapped: ChartDataPoint[] = downsampled.map((row) => {
          const point: ChartDataPoint = {
            timestamp: row.timestamp,
            time: new Date(row.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          };

          // Map series to data points
          series.forEach((s) => {
            const key = s.label || s.register_name;
            // Map register names to control_logs columns
            const columnMap: Record<string, keyof typeof row> = {
              total_load_kw: "total_load_kw",
              solar_output_kw: "solar_output_kw",
              dg_power_kw: "dg_power_kw",
              solar_limit_pct: "solar_limit_pct",
              // Add aliases
              load: "total_load_kw",
              solar: "solar_output_kw",
              dg: "dg_power_kw",
            };

            const column = columnMap[s.register_name];
            if (column && row[column] !== undefined) {
              point[key] = row[column] as number;
            }
          });

          return point;
        });

        setChartData(mapped);
      } catch {
        // Silently handle fetch errors - UI shows "No data available"
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [siteId, series, timeRange, isEditMode]);

  // Render appropriate chart type
  const renderChart = () => {
    if (chartData.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
          No data available
        </div>
      );
    }

    const chartProps = {
      data: chartData,
      margin: { top: 5, right: 10, left: -20, bottom: 5 },
    };

    const commonAxisProps = {
      stroke: "#888888",
      fontSize: 10,
      tickLine: false,
      axisLine: false,
    };

    if (chartType === "area") {
      return (
        <AreaChart {...chartProps}>
          <XAxis dataKey="time" {...commonAxisProps} />
          <YAxis {...commonAxisProps} />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
              fontSize: "12px",
            }}
          />
          {series.map((s, idx) => (
            <Area
              key={s.label || s.register_name}
              type="monotone"
              dataKey={s.label || s.register_name}
              stroke={s.color || COLORS[idx % COLORS.length]}
              fill={s.color || COLORS[idx % COLORS.length]}
              fillOpacity={0.2}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      );
    }

    if (chartType === "bar") {
      return (
        <BarChart {...chartProps}>
          <XAxis dataKey="time" {...commonAxisProps} />
          <YAxis {...commonAxisProps} />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
              fontSize: "12px",
            }}
          />
          {series.map((s, idx) => (
            <Bar
              key={s.label || s.register_name}
              dataKey={s.label || s.register_name}
              fill={s.color || COLORS[idx % COLORS.length]}
            />
          ))}
        </BarChart>
      );
    }

    // Default: line chart
    return (
      <LineChart {...chartProps}>
        <XAxis dataKey="time" {...commonAxisProps} />
        <YAxis {...commonAxisProps} />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            fontSize: "12px",
          }}
        />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: "10px" }} />}
        {series.map((s, idx) => (
          <Line
            key={s.label || s.register_name}
            type="monotone"
            dataKey={s.label || s.register_name}
            stroke={s.color || COLORS[idx % COLORS.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    );
  };

  return (
    <div
      className={cn(
        "h-full flex flex-col p-3",
        isEditMode && "cursor-pointer"
      )}
      onClick={isEditMode ? onSelect : undefined}
    >
      {/* Title */}
      {config.title && (
        <p className="text-xs font-medium mb-2 truncate">{config.title}</p>
      )}

      {/* Chart */}
      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : series.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            {isEditMode ? "Click to configure" : "No series configured"}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minHeight={100}>
            {renderChart()}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
});
