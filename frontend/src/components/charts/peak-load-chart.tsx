/**
 * Peak Load Chart Component
 *
 * ⚠️ PHASE 4 - Reporting & Analytics
 *
 * Shows peak load analysis by hour of day:
 * - Identifies when peak loads occur
 * - Helps optimize solar/DG scheduling
 * - Area chart visualization
 */

"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Props for the PeakLoadChart
interface PeakLoadChartProps {
  projectId: string;
}

// Data point structure for the chart
interface HourlyDataPoint {
  hour: string;        // Display label (e.g., "6 AM", "12 PM")
  avgLoad: number;     // Average load at this hour
  maxLoad: number;     // Max load at this hour
}

export function PeakLoadChart({ projectId }: PeakLoadChartProps) {
  const [data, setData] = useState<HourlyDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [peakHour, setPeakHour] = useState<string | null>(null);

  // Fetch and aggregate data by hour
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      const supabase = createClient();

      // Get last 7 days of data
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: logs, error } = await supabase
        .from("control_logs")
        .select("timestamp, total_load_kw")
        .eq("project_id", projectId)
        .gte("timestamp", sevenDaysAgo.toISOString())
        .order("timestamp", { ascending: true });

      if (error || !logs) {
        console.error("Failed to fetch logs:", error);
        setData([]);
        setLoading(false);
        return;
      }

      // Group by hour of day
      const hourlyData: Record<number, number[]> = {};

      // Initialize all hours
      for (let i = 0; i < 24; i++) {
        hourlyData[i] = [];
      }

      logs.forEach((log) => {
        const date = new Date(log.timestamp);
        const hour = date.getHours();
        hourlyData[hour].push(log.total_load_kw || 0);
      });

      // Calculate averages and find peak
      let maxAvg = 0;
      let peakHourNum = 0;

      const chartData: HourlyDataPoint[] = Object.entries(hourlyData).map(([hourStr, values]) => {
        const hour = parseInt(hourStr);
        const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        const max = values.length > 0 ? Math.max(...values) : 0;

        if (avg > maxAvg) {
          maxAvg = avg;
          peakHourNum = hour;
        }

        // Format hour label
        const ampm = hour >= 12 ? "PM" : "AM";
        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;

        return {
          hour: `${displayHour}${ampm}`,
          avgLoad: avg,
          maxLoad: max,
        };
      });

      // Set peak hour label
      const peakAmpm = peakHourNum >= 12 ? "PM" : "AM";
      const peakDisplayHour = peakHourNum === 0 ? 12 : peakHourNum > 12 ? peakHourNum - 12 : peakHourNum;
      setPeakHour(`${peakDisplayHour}:00 ${peakAmpm}`);

      setData(chartData);
      setLoading(false);
    }

    fetchData();
  }, [projectId]);

  // Custom tooltip component
  const CustomTooltip = ({ active, payload, label }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string }>;
    label?: string;
  }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border rounded-lg shadow-lg p-3">
          <p className="font-medium mb-2">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {entry.name}: {entry.value.toFixed(1)} kW
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Peak Load Analysis
            </CardTitle>
            <CardDescription>
              Average load by hour of day (last 7 days)
            </CardDescription>
          </div>

          {/* Peak hour indicator */}
          {peakHour && (
            <div className="text-sm">
              <span className="text-muted-foreground">Peak at: </span>
              <span className="font-semibold text-orange-600">{peakHour}</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center h-[300px]">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-[300px] text-muted-foreground">
            No data available
          </div>
        ) : (
          <div className="h-[300px]">
            <ResponsiveContainer width="99%" height={300}>
              <AreaChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="colorLoad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorMax" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval={2}
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${value}`}
                  label={{ value: "kW", angle: -90, position: "insideLeft", style: { fontSize: 12 } }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="maxLoad"
                  name="Peak Load"
                  stroke="#f97316"
                  fill="url(#colorMax)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="avgLoad"
                  name="Avg Load"
                  stroke="#3b82f6"
                  fill="url(#colorLoad)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
