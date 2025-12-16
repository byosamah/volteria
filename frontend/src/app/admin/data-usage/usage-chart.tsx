"use client";

/**
 * Usage Chart Component
 *
 * Displays historical storage usage over time as an area chart.
 * Features:
 * - Selectable date range (7d, 14d, 30d)
 * - Stacked area showing breakdown by category
 * - Storage limit line for reference
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";

// Type for historical snapshot data
interface UsageSnapshot {
  snapshot_date: string;
  total_storage_bytes: number;
  control_logs_bytes: number;
  alarms_bytes: number;
  heartbeats_bytes: number;
}

interface UsageChartProps {
  enterpriseId: string;
  enterpriseName: string;
  storageLimitBytes: number | null;
  snapshots: UsageSnapshot[];
}

// Convert bytes to GB
function bytesToGB(bytes: number): number {
  return Math.round((bytes / (1024 ** 3)) * 100) / 100;
}

// Date range options
const DATE_RANGES = [
  { label: "7 Days", days: 7 },
  { label: "14 Days", days: 14 },
  { label: "30 Days", days: 30 },
];

export function UsageChart({
  enterpriseId,
  enterpriseName,
  storageLimitBytes,
  snapshots,
}: UsageChartProps) {
  const [selectedRange, setSelectedRange] = useState(7);

  // Filter and transform data for chart
  const chartData = useMemo(() => {
    // Filter to selected date range
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - selectedRange);

    const filtered = snapshots
      .filter((s) => new Date(s.snapshot_date) >= cutoffDate)
      .sort((a, b) => new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime());

    // Transform to chart format (GB values)
    return filtered.map((s) => ({
      date: new Date(s.snapshot_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      fullDate: s.snapshot_date,
      total: bytesToGB(s.total_storage_bytes),
      controlLogs: bytesToGB(s.control_logs_bytes),
      alarms: bytesToGB(s.alarms_bytes),
      heartbeats: bytesToGB(s.heartbeats_bytes),
    }));
  }, [snapshots, selectedRange]);

  const storageLimitGB = storageLimitBytes ? bytesToGB(storageLimitBytes) : null;

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
          <p className="font-medium mb-2">{label}</p>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-muted-foreground">Control Logs:</span>
              <span className="font-medium">{payload[0]?.value?.toFixed(2)} GB</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-amber-500" />
              <span className="text-muted-foreground">Alarms:</span>
              <span className="font-medium">{payload[1]?.value?.toFixed(2)} GB</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-muted-foreground">Heartbeats:</span>
              <span className="font-medium">{payload[2]?.value?.toFixed(2)} GB</span>
            </div>
            <div className="border-t pt-1 mt-1">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Total:</span>
                <span className="font-bold">
                  {(
                    (payload[0]?.value || 0) +
                    (payload[1]?.value || 0) +
                    (payload[2]?.value || 0)
                  ).toFixed(2)}{" "}
                  GB
                </span>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Storage History</CardTitle>
          <CardDescription>
            Historical storage usage for {enterpriseName}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-[200px] text-muted-foreground">
            No historical data available yet
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle>Storage History</CardTitle>
            <CardDescription>
              Historical storage usage for {enterpriseName}
            </CardDescription>
          </div>
          <div className="flex gap-1">
            {DATE_RANGES.map((range) => (
              <Button
                key={range.days}
                variant={selectedRange === range.days ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedRange(range.days)}
              >
                {range.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
                tickFormatter={(value) => `${value} GB`}
                width={60}
              />
              <Tooltip content={<CustomTooltip />} />

              {/* Storage limit reference line */}
              {storageLimitGB && (
                <ReferenceLine
                  y={storageLimitGB}
                  stroke="#ef4444"
                  strokeDasharray="5 5"
                  label={{
                    value: `Limit: ${storageLimitGB} GB`,
                    position: "right",
                    fill: "#ef4444",
                    fontSize: 12,
                  }}
                />
              )}

              {/* Stacked areas */}
              <Area
                type="monotone"
                dataKey="controlLogs"
                stackId="1"
                stroke="#3b82f6"
                fill="#3b82f6"
                fillOpacity={0.6}
                name="Control Logs"
              />
              <Area
                type="monotone"
                dataKey="alarms"
                stackId="1"
                stroke="#f59e0b"
                fill="#f59e0b"
                fillOpacity={0.6}
                name="Alarms"
              />
              <Area
                type="monotone"
                dataKey="heartbeats"
                stackId="1"
                stroke="#22c55e"
                fill="#22c55e"
                fillOpacity={0.6}
                name="Heartbeats"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap justify-center gap-4 mt-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <span className="text-muted-foreground">Control Logs</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <span className="text-muted-foreground">Alarms</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-muted-foreground">Heartbeats</span>
          </div>
          {storageLimitGB && (
            <div className="flex items-center gap-2">
              <div className="w-6 h-0 border-t-2 border-dashed border-red-500" />
              <span className="text-muted-foreground">Storage Limit</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
