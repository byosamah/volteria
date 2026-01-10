/**
 * Energy Consumption Chart Component
 *
 * ⚠️ PHASE 4 - Reporting & Analytics
 *
 * Bar chart showing energy consumption over time:
 * - Daily, Weekly, or Monthly view toggle
 * - Stacked bars for Load, Solar, and DG
 * - Interactive tooltips with detailed values
 */

"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { BarChart3, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Props for the EnergyConsumptionChart
interface EnergyConsumptionChartProps {
  projectId: string;
}

// Data point structure for the chart
interface ChartDataPoint {
  date: string;        // Display label (e.g., "Mon", "Week 1", "Jan")
  load: number;        // Average load in kW
  solar: number;       // Average solar in kW
  dg: number;          // Average DG in kW
}

// Time range options
type TimeRange = "daily" | "weekly" | "monthly";

export function EnergyConsumptionChart({ projectId }: EnergyConsumptionChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("daily");
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch and aggregate data based on time range
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      const supabase = createClient();

      // Calculate date range based on selection
      const now = new Date();
      let startDate: Date;
      let groupBy: "day" | "week" | "month";

      switch (timeRange) {
        case "daily":
          startDate = new Date(now);
          startDate.setDate(now.getDate() - 7);
          groupBy = "day";
          break;
        case "weekly":
          startDate = new Date(now);
          startDate.setDate(now.getDate() - 28);
          groupBy = "week";
          break;
        case "monthly":
          startDate = new Date(now);
          startDate.setMonth(now.getMonth() - 6);
          groupBy = "month";
          break;
      }

      // Fetch raw logs
      const { data: logs, error } = await supabase
        .from("control_logs")
        .select("timestamp, total_load_kw, solar_output_kw, dg_power_kw")
        .eq("project_id", projectId)
        .gte("timestamp", startDate.toISOString())
        .order("timestamp", { ascending: true });

      if (error || !logs) {
        console.error("Failed to fetch logs:", error);
        setData([]);
        setLoading(false);
        return;
      }

      // Group and aggregate data
      const grouped: Record<string, { load: number[]; solar: number[]; dg: number[] }> = {};

      logs.forEach((log) => {
        const date = new Date(log.timestamp);
        let key: string;

        switch (groupBy) {
          case "day":
            key = date.toLocaleDateString("en-US", { weekday: "short" });
            break;
          case "week":
            const weekNum = Math.ceil(date.getDate() / 7);
            key = `Week ${weekNum}`;
            break;
          case "month":
            key = date.toLocaleDateString("en-US", { month: "short" });
            break;
        }

        if (!grouped[key]) {
          grouped[key] = { load: [], solar: [], dg: [] };
        }

        grouped[key].load.push(log.total_load_kw || 0);
        grouped[key].solar.push(log.solar_output_kw || 0);
        grouped[key].dg.push(log.dg_power_kw || 0);
      });

      // Calculate averages
      const chartData: ChartDataPoint[] = Object.entries(grouped).map(([date, values]) => ({
        date,
        load: values.load.reduce((a, b) => a + b, 0) / values.load.length,
        solar: values.solar.reduce((a, b) => a + b, 0) / values.solar.length,
        dg: values.dg.reduce((a, b) => a + b, 0) / values.dg.length,
      }));

      setData(chartData);
      setLoading(false);
    }

    fetchData();
  }, [projectId, timeRange]);

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
              <BarChart3 className="h-5 w-5 text-primary" />
              Energy Consumption
            </CardTitle>
            <CardDescription>
              Average power by {timeRange === "daily" ? "day" : timeRange === "weekly" ? "week" : "month"}
            </CardDescription>
          </div>

          {/* Time range toggle */}
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            {(["daily", "weekly", "monthly"] as TimeRange[]).map((range) => (
              <Button
                key={range}
                variant={timeRange === range ? "default" : "ghost"}
                size="sm"
                onClick={() => setTimeRange(range)}
                className="min-h-[36px] capitalize"
              >
                {range}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center h-[300px]">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-[300px] text-muted-foreground">
            No data available for this period
          </div>
        ) : (
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${value}`}
                  label={{ value: "kW", angle: -90, position: "insideLeft", style: { fontSize: 12 } }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar dataKey="load" name="Load" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="solar" name="Solar" fill="#6baf4f" radius={[4, 4, 0, 0]} />
                <Bar dataKey="dg" name="Generator" fill="#64748b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
