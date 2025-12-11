"use client";

/**
 * Power Flow Chart Component
 *
 * Displays historical power flow data as a line chart.
 * Shows Load, Solar Output, and DG Power over time.
 * Supports multiple time ranges: 1h, 6h, 24h, 7d.
 */

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// Time range options for the chart
const TIME_RANGES = [
  { label: "1h", value: 1, unit: "hour" },
  { label: "6h", value: 6, unit: "hours" },
  { label: "24h", value: 24, unit: "hours" },
  { label: "7d", value: 7 * 24, unit: "days" },
] as const;

// Chart data point type
interface PowerDataPoint {
  timestamp: string;
  time: string; // Formatted time for display
  load_kw: number;
  solar_kw: number;
  dg_kw: number;
  solar_limit_pct: number;
}

interface PowerFlowChartProps {
  projectId: string;
  siteId: string;
}

export function PowerFlowChart({ projectId, siteId }: PowerFlowChartProps) {
  const [data, setData] = useState<PowerDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRange, setSelectedRange] = useState(24); // Default: 24 hours

  // Fetch power data from control_logs
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const supabase = createClient();

      // Calculate the start time based on selected range
      const startTime = new Date();
      startTime.setHours(startTime.getHours() - selectedRange);

      // Fetch control logs for the time range
      // Limit to reasonable number of points for chart performance
      const { data: logs, error } = await supabase
        .from("control_logs")
        .select("timestamp, total_load_kw, solar_output_kw, dg_power_kw, solar_limit_pct")
        .eq("site_id", siteId)
        .gte("timestamp", startTime.toISOString())
        .order("timestamp", { ascending: true })
        .limit(500);

      if (error) {
        console.error("Error fetching power data:", error);
        setData([]);
      } else if (logs) {
        // Transform data for the chart
        // Downsample if too many points (keep every Nth point)
        const maxPoints = 100;
        const step = Math.max(1, Math.floor(logs.length / maxPoints));

        const chartData: PowerDataPoint[] = logs
          .filter((_, index) => index % step === 0)
          .map((log) => {
            const date = new Date(log.timestamp);
            // Format time based on range
            let timeFormat: string;
            if (selectedRange <= 1) {
              timeFormat = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            } else if (selectedRange <= 24) {
              timeFormat = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            } else {
              timeFormat = date.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit" });
            }

            return {
              timestamp: log.timestamp,
              time: timeFormat,
              load_kw: log.total_load_kw || 0,
              solar_kw: log.solar_output_kw || 0,
              dg_kw: log.dg_power_kw || 0,
              solar_limit_pct: log.solar_limit_pct || 0,
            };
          });

        setData(chartData);
      }

      setLoading(false);
    };

    fetchData();

    // Set up polling for real-time updates (every 30 seconds for short ranges)
    const pollInterval = selectedRange <= 1 ? 30000 : 60000;
    const interval = setInterval(fetchData, pollInterval);

    return () => clearInterval(interval);
  }, [siteId, selectedRange]);

  // Custom tooltip for the chart
  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) => {
    if (!active || !payload || !payload.length) return null;

    return (
      <div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
        <p className="font-medium mb-2">{label}</p>
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">{entry.name}:</span>
            <span className="font-medium">{entry.value.toFixed(1)} kW</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg">Power Flow</CardTitle>
            <CardDescription>Historical power data over time</CardDescription>
          </div>
          {/* Time Range Selector */}
          <div className="flex gap-1">
            {TIME_RANGES.map((range) => (
              <Button
                key={range.label}
                variant={selectedRange === range.value ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedRange(range.value)}
                className="min-h-[36px] min-w-[44px]"
              >
                {range.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          // Loading skeleton
          <div className="h-[300px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : data.length === 0 ? (
          // No data message
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-12 w-12 mx-auto mb-2 opacity-50"
              >
                <path d="M3 3v18h18" />
                <path d="m19 9-5 5-4-4-3 3" />
              </svg>
              <p>No data available for this time range</p>
            </div>
          </div>
        ) : (
          // Chart
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  className="text-muted-foreground"
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  className="text-muted-foreground"
                  tickFormatter={(value) => `${value}`}
                  label={{ value: "kW", angle: -90, position: "insideLeft", style: { fontSize: 12 } }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ paddingTop: "10px" }}
                  formatter={(value) => <span className="text-sm">{value}</span>}
                />
                {/* Load - Blue */}
                <Line
                  type="monotone"
                  dataKey="load_kw"
                  name="Load"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                {/* Solar - Yellow/Green */}
                <Line
                  type="monotone"
                  dataKey="solar_kw"
                  name="Solar"
                  stroke="#6baf4f"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                {/* DG - Gray */}
                <Line
                  type="monotone"
                  dataKey="dg_kw"
                  name="DG"
                  stroke="#64748b"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
