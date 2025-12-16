"use client";

/**
 * Power Flow Chart Component
 *
 * Multi-view chart component with three chart types:
 * - Power Flow: Load, Solar Output, DG Power over time
 * - System Health: CPU, Memory, Disk, Temperature from controller heartbeats
 * - Control Status: Solar limit %, safe mode events
 *
 * Supports multiple time ranges: 1h, 6h, 24h, 7d.
 */

import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Area,
  AreaChart,
} from "recharts";
import { Zap, Activity, Gauge } from "lucide-react";

// Chart type options
type ChartType = "power" | "system" | "control";

// Time range options for the chart
const TIME_RANGES = [
  { label: "1h", value: 1, unit: "hour" },
  { label: "6h", value: 6, unit: "hours" },
  { label: "24h", value: 24, unit: "hours" },
  { label: "7d", value: 7 * 24, unit: "days" },
] as const;

// Chart data point types
interface PowerDataPoint {
  timestamp: string;
  time: string; // Formatted time for display
  load_kw: number;
  solar_kw: number;
  dg_kw: number;
  solar_limit_pct: number;
}

// System health data from controller heartbeats
interface SystemHealthPoint {
  timestamp: string;
  time: string;
  cpu_pct: number;
  memory_pct: number;
  disk_pct: number;
  temp_celsius: number | null;
}

// Control status data
interface ControlStatusPoint {
  timestamp: string;
  time: string;
  solar_limit_pct: number;
  safe_mode_active: boolean;
}

// Chart color constants - consistent across all chart types
const CHART_COLORS = {
  // Power metrics
  load: "#3b82f6",      // Blue
  solar: "#eab308",     // Yellow
  dg: "#1f2937",        // Dark gray
  subload: "#93c5fd",   // Light blue (future use)
  // System metrics
  cpu: "#f97316",       // Orange
  memory: "#a855f7",    // Purple
  disk: "#3b82f6",      // Blue
  temperature: "#ef4444", // Red
  // Control metrics
  solarLimit: "#eab308", // Yellow
  safeMode: "#ef4444",   // Red
};

// Helper: Downsample data for chart performance (pure function, no deps)
// Moved outside component to prevent recreation on every render
function downsample<T>(data: T[], maxPoints = 100): T[] {
  const step = Math.max(1, Math.floor(data.length / maxPoints));
  return data.filter((_, index) => index % step === 0);
}

interface PowerFlowChartProps {
  projectId: string;
  siteId: string;
}

// Wrapped with React.memo to prevent re-renders when props don't change
export const PowerFlowChart = memo(function PowerFlowChart({ projectId, siteId }: PowerFlowChartProps) {
  // Chart type state
  const [chartType, setChartType] = useState<ChartType>("power");

  // Data states for each chart type
  const [powerData, setPowerData] = useState<PowerDataPoint[]>([]);
  const [systemData, setSystemData] = useState<SystemHealthPoint[]>([]);
  const [controlData, setControlData] = useState<ControlStatusPoint[]>([]);

  const [loading, setLoading] = useState(true);
  const [selectedRange, setSelectedRange] = useState(24); // Default: 24 hours

  // Ref to store interval ID for visibility-aware polling
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  // Track if tab is visible (for pausing/resuming polling)
  const [isTabVisible, setIsTabVisible] = useState(true);

  // Alias for backward compatibility with existing code
  const data = powerData;

  // Helper: Format time based on selected range (memoized to prevent recreation)
  const formatTime = useCallback((timestamp: string) => {
    const date = new Date(timestamp);
    if (selectedRange <= 1) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (selectedRange <= 24) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit" });
    }
  }, [selectedRange]);

  // Page Visibility API: Pause polling when tab is hidden to save bandwidth
  useEffect(() => {
    const handleVisibilityChange = () => {
      // Update tab visibility state
      setIsTabVisible(!document.hidden);
    };

    // Listen for visibility changes
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Fetch data based on current chart type
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const supabase = createClient();

      // Calculate the start time based on selected range
      const startTime = new Date();
      startTime.setHours(startTime.getHours() - selectedRange);

      // Fetch data based on chart type
      if (chartType === "power") {
        // Fetch power flow data from control_logs
        const { data: logs, error } = await supabase
          .from("control_logs")
          .select("timestamp, total_load_kw, solar_output_kw, dg_power_kw, solar_limit_pct, safe_mode_active")
          .eq("site_id", siteId)
          .gte("timestamp", startTime.toISOString())
          .order("timestamp", { ascending: true })
          .limit(500);

        if (error) {
          console.error("Error fetching power data:", error);
          setPowerData([]);
        } else if (logs) {
          const chartData: PowerDataPoint[] = downsample(logs).map((log) => ({
            timestamp: log.timestamp,
            time: formatTime(log.timestamp),
            load_kw: log.total_load_kw || 0,
            solar_kw: log.solar_output_kw || 0,
            dg_kw: log.dg_power_kw || 0,
            solar_limit_pct: log.solar_limit_pct || 0,
          }));
          setPowerData(chartData);
        }

      } else if (chartType === "system") {
        // Fetch system health data via API route (heartbeats with controller lookup)
        try {
          const response = await fetch(`/api/sites/${siteId}/heartbeats?hours=${selectedRange}`);
          if (response.ok) {
            const result = await response.json();
            // Type the raw heartbeat data from API
            interface RawHeartbeat {
              timestamp: string;
              cpu_usage_pct: number;
              memory_usage_pct: number;
              disk_usage_pct: number;
              metadata?: { cpu_temp_celsius?: number };
            }
            const heartbeats: RawHeartbeat[] = result.data || [];
            const chartData: SystemHealthPoint[] = downsample(heartbeats).map((hb) => ({
              timestamp: hb.timestamp,
              time: formatTime(hb.timestamp),
              cpu_pct: hb.cpu_usage_pct || 0,
              memory_pct: hb.memory_usage_pct || 0,
              disk_pct: hb.disk_usage_pct || 0,
              temp_celsius: hb.metadata?.cpu_temp_celsius || null,
            }));
            setSystemData(chartData);
          } else {
            console.error("Error fetching system health:", response.statusText);
            setSystemData([]);
          }
        } catch (err) {
          console.error("Error fetching system health:", err);
          setSystemData([]);
        }

      } else if (chartType === "control") {
        // Fetch control status from control_logs (same source, different fields)
        const { data: logs, error } = await supabase
          .from("control_logs")
          .select("timestamp, solar_limit_pct, safe_mode_active")
          .eq("site_id", siteId)
          .gte("timestamp", startTime.toISOString())
          .order("timestamp", { ascending: true })
          .limit(500);

        if (error) {
          console.error("Error fetching control data:", error);
          setControlData([]);
        } else if (logs) {
          const chartData: ControlStatusPoint[] = downsample(logs).map((log) => ({
            timestamp: log.timestamp,
            time: formatTime(log.timestamp),
            solar_limit_pct: log.solar_limit_pct ?? 100,
            safe_mode_active: log.safe_mode_active || false,
          }));
          setControlData(chartData);
        }
      }

      setLoading(false);
    };

    // Always fetch data immediately when dependencies change
    fetchData();

    // Clear any existing interval before setting up new one
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Only set up polling if tab is visible (saves bandwidth when user isn't looking)
    if (isTabVisible) {
      // Set up polling for real-time updates (every 30 seconds for short ranges)
      const pollInterval = selectedRange <= 1 ? 30000 : 60000;
      intervalRef.current = setInterval(fetchData, pollInterval);
    }

    // Cleanup: clear interval when dependencies change or component unmounts
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [siteId, selectedRange, chartType, isTabVisible]);

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

  // Get chart title and description based on type
  const getChartInfo = () => {
    switch (chartType) {
      case "power":
        return { title: "Power Flow", description: "Load, Solar, and DG power over time" };
      case "system":
        return { title: "System Health", description: "CPU, Memory, Disk usage and temperature" };
      case "control":
        return { title: "Control Status", description: "Solar limit and safe mode events" };
    }
  };

  const chartInfo = getChartInfo();

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-3">
          {/* Title row with time range selector */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg">{chartInfo.title}</CardTitle>
              <CardDescription>{chartInfo.description}</CardDescription>
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
          {/* Chart Type Tabs */}
          <Tabs value={chartType} onValueChange={(v) => setChartType(v as ChartType)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="power" className="flex items-center gap-1.5">
                <Zap className="h-4 w-4" />
                <span className="hidden sm:inline">Power Flow</span>
                <span className="sm:hidden">Power</span>
              </TabsTrigger>
              <TabsTrigger value="system" className="flex items-center gap-1.5">
                <Activity className="h-4 w-4" />
                <span className="hidden sm:inline">System Health</span>
                <span className="sm:hidden">System</span>
              </TabsTrigger>
              <TabsTrigger value="control" className="flex items-center gap-1.5">
                <Gauge className="h-4 w-4" />
                <span className="hidden sm:inline">Control Status</span>
                <span className="sm:hidden">Control</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          // Loading skeleton
          <div className="h-[300px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          // Render chart based on type
          <div className="h-[300px]">
            {chartType === "power" && (
              // Power Flow Chart
              powerData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <Zap className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No power data available for this time range</p>
                  </div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={powerData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
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
                      stroke={CHART_COLORS.load}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    {/* Solar - Yellow */}
                    <Line
                      type="monotone"
                      dataKey="solar_kw"
                      name="Solar"
                      stroke={CHART_COLORS.solar}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    {/* DG - Dark Gray */}
                    <Line
                      type="monotone"
                      dataKey="dg_kw"
                      name="DG"
                      stroke={CHART_COLORS.dg}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )
            )}

            {chartType === "system" && (
              // System Health Chart
              systemData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <Activity className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No system health data available</p>
                    <p className="text-sm mt-1">Controller heartbeats will appear here</p>
                  </div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={systemData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
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
                      tickFormatter={(value) => `${value}%`}
                      domain={[0, 100]}
                      label={{ value: "%", angle: -90, position: "insideLeft", style: { fontSize: 12 } }}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
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
                                <span className="font-medium">
                                  {entry.name === "Temp"
                                    ? `${entry.value}°C`
                                    : `${typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}%`}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />
                    <Legend
                      wrapperStyle={{ paddingTop: "10px" }}
                      formatter={(value) => <span className="text-sm">{value}</span>}
                    />
                    {/* CPU Usage - Orange */}
                    <Line
                      type="monotone"
                      dataKey="cpu_pct"
                      name="CPU"
                      stroke={CHART_COLORS.cpu}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    {/* Memory Usage - Purple */}
                    <Line
                      type="monotone"
                      dataKey="memory_pct"
                      name="Memory"
                      stroke={CHART_COLORS.memory}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    {/* Disk Usage - Blue */}
                    <Line
                      type="monotone"
                      dataKey="disk_pct"
                      name="Disk"
                      stroke={CHART_COLORS.disk}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    {/* Temperature - Red (if available) */}
                    {systemData.some(d => d.temp_celsius !== null) && (
                      <Line
                        type="monotone"
                        dataKey="temp_celsius"
                        name="Temp"
                        stroke={CHART_COLORS.temperature}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                        yAxisId="temp"
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              )
            )}

            {chartType === "control" && (
              // Control Status Chart
              controlData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <Gauge className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No control data available for this time range</p>
                  </div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={controlData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
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
                      tickFormatter={(value) => `${value}%`}
                      domain={[0, 100]}
                      label={{ value: "%", angle: -90, position: "insideLeft", style: { fontSize: 12 } }}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload || !payload.length) return null;
                        const safeModeEntry = controlData.find(d => d.time === label);
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
                                <span className="font-medium">{typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}%</span>
                              </div>
                            ))}
                            {safeModeEntry?.safe_mode_active && (
                              <div className="mt-2 pt-2 border-t text-destructive flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                                Safe Mode Active
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Legend
                      wrapperStyle={{ paddingTop: "10px" }}
                      formatter={(value) => <span className="text-sm">{value}</span>}
                    />
                    {/* Solar Limit - Yellow area */}
                    <Area
                      type="monotone"
                      dataKey="solar_limit_pct"
                      name="Solar Limit"
                      stroke={CHART_COLORS.solarLimit}
                      fill={CHART_COLORS.solarLimit}
                      fillOpacity={0.2}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
});
