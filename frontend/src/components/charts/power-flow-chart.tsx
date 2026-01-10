"use client";

/**
 * Power Flow Chart Component
 *
 * Multi-view chart component with three chart types:
 * - Connection Status: Online/offline history derived from heartbeat gaps
 * - System Health: CPU, Memory, Disk, Temperature from controller heartbeats
 * - Control Status: Solar limit %, safe mode events
 *
 * Supports multiple time ranges: 1h, 6h, 24h, 7d.
 */

import { useState, useEffect, useRef, useCallback, memo } from "react";
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
import { Wifi, Activity, Gauge } from "lucide-react";

// Chart type options
type ChartType = "connection" | "system" | "control";

// Time range options for the chart
const TIME_RANGES = [
  { label: "1h", value: 1, unit: "hour" },
  { label: "6h", value: 6, unit: "hours" },
  { label: "24h", value: 24, unit: "hours" },
  { label: "7d", value: 7 * 24, unit: "days" },
] as const;

// Chart data point types
interface ConnectionStatusPoint {
  timestamp: string;
  time: string; // Formatted time for display
  status: 0 | 1; // 0 = offline, 1 = online
  isOnline: boolean;
  gapSeconds?: number; // Gap since last heartbeat (for tooltip)
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
  // Connection status
  online: "#22c55e",    // Green
  offline: "#ef4444",   // Red
  // System metrics
  cpu: "#f97316",       // Orange
  memory: "#a855f7",    // Purple
  disk: "#3b82f6",      // Blue
  temperature: "#ef4444", // Red
  // Control metrics
  solarLimit: "#eab308", // Yellow
  safeMode: "#ef4444",   // Red
};

// Threshold for considering controller offline (in seconds)
// Controllers send heartbeats every 30 seconds, so 120s = 4 missed heartbeats
// This provides tolerance for network latency and timing variations
const OFFLINE_THRESHOLD_SECONDS = 120;

// Minimum offline duration (in seconds) to count as a "disconnection"
// Brief gaps (< 30s) are likely timing variations, not real disconnections
const MIN_DISCONNECTION_SECONDS = 30;

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
  // Chart type state - default to connection status
  const [chartType, setChartType] = useState<ChartType>("connection");

  // Data states for each chart type
  const [connectionData, setConnectionData] = useState<ConnectionStatusPoint[]>([]);
  const [systemData, setSystemData] = useState<SystemHealthPoint[]>([]);
  const [controlData, setControlData] = useState<ControlStatusPoint[]>([]);

  // Stats for connection status
  const [connectionStats, setConnectionStats] = useState<{
    uptimePct: number;
    totalOnlineMinutes: number;
    totalOfflineMinutes: number;
    offlineEvents: number;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [selectedRange, setSelectedRange] = useState(1); // Default: 1 hour (reduces initial load)

  // Ref to store interval ID for visibility-aware polling
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  // Track if tab is visible (for pausing/resuming polling)
  const [isTabVisible, setIsTabVisible] = useState(true);

  // Helper: Format time based on selected range (memoized to prevent recreation)
  const formatTime = useCallback((timestamp: string) => {
    const date = new Date(timestamp);
    if (selectedRange <= 6) {
      // For 1h and 6h: show just time (same day)
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (selectedRange <= 24) {
      // For 24h: show day and time since data spans multiple days
      return date.toLocaleDateString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
    } else {
      // For 7d: show date and time
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
      if (chartType === "connection") {
        // Fetch heartbeat timestamps to derive connection status
        try {
          const response = await fetch(`/api/sites/${siteId}/heartbeats?hours=${selectedRange}`);
          if (response.ok) {
            const result = await response.json();
            interface RawHeartbeat {
              timestamp: string;
            }
            const heartbeats: RawHeartbeat[] = result.data || [];

            if (heartbeats.length === 0) {
              setConnectionData([]);
              setConnectionStats(null);
            } else {
              // Calculate connection status from heartbeat gaps
              const statusData: ConnectionStatusPoint[] = [];
              let totalOnlineMs = 0;
              let totalOfflineMs = 0;
              let offlineEvents = 0;

              // Sort by timestamp
              const sortedHeartbeats = [...heartbeats].sort(
                (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
              );

              // Start tracking from the first heartbeat, NOT from the range start
              // This prevents counting "no data" periods as "offline"

              // Add initial online point at first heartbeat
              statusData.push({
                timestamp: sortedHeartbeats[0].timestamp,
                time: formatTime(sortedHeartbeats[0].timestamp),
                status: 1,
                isOnline: true,
                gapSeconds: 0,
              });

              // Process each heartbeat starting from the second one
              for (let i = 1; i < sortedHeartbeats.length; i++) {
                const hb = sortedHeartbeats[i];
                const currentTime = new Date(hb.timestamp).getTime();
                const prevTime = new Date(sortedHeartbeats[i - 1].timestamp).getTime();
                const gapSeconds = (currentTime - prevTime) / 1000;

                // If gap is > threshold, there was an offline period
                if (gapSeconds > OFFLINE_THRESHOLD_SECONDS) {
                  // Calculate actual offline duration
                  const offlineStartTime = prevTime + OFFLINE_THRESHOLD_SECONDS * 1000;
                  const offlineDurationMs = currentTime - offlineStartTime;
                  const offlineDurationSeconds = offlineDurationMs / 1000;

                  // Only add offline point and count as disconnection if significant
                  if (offlineDurationSeconds >= MIN_DISCONNECTION_SECONDS) {
                    statusData.push({
                      timestamp: new Date(offlineStartTime).toISOString(),
                      time: formatTime(new Date(offlineStartTime).toISOString()),
                      status: 0,
                      isOnline: false,
                      gapSeconds: Math.floor(gapSeconds),
                    });
                    totalOfflineMs += offlineDurationMs;
                    offlineEvents++;
                    // Online time for previous interval is just the threshold
                    totalOnlineMs += OFFLINE_THRESHOLD_SECONDS * 1000;
                  } else {
                    // Brief gap - treat as continuous online (count full gap as online)
                    totalOnlineMs += gapSeconds * 1000;
                  }
                } else {
                  // Normal heartbeat interval - count as online time
                  totalOnlineMs += gapSeconds * 1000;
                }

                // Add online point at heartbeat time
                statusData.push({
                  timestamp: hb.timestamp,
                  time: formatTime(hb.timestamp),
                  status: 1,
                  isOnline: true,
                  gapSeconds: Math.floor(gapSeconds),
                });
              }

              // Check if currently offline (last heartbeat was > threshold ago)
              const lastHeartbeatTime = new Date(sortedHeartbeats[sortedHeartbeats.length - 1].timestamp).getTime();
              const now = Date.now();
              const timeSinceLastHeartbeat = now - lastHeartbeatTime;

              if (timeSinceLastHeartbeat > OFFLINE_THRESHOLD_SECONDS * 1000) {
                // Calculate offline duration
                const offlineStartTime = lastHeartbeatTime + OFFLINE_THRESHOLD_SECONDS * 1000;
                const offlineDurationMs = now - offlineStartTime;
                const offlineDurationSeconds = offlineDurationMs / 1000;

                // Only count as disconnection if significant duration
                if (offlineDurationSeconds >= MIN_DISCONNECTION_SECONDS) {
                  // Controller is currently offline
                  statusData.push({
                    timestamp: new Date(offlineStartTime).toISOString(),
                    time: formatTime(new Date(offlineStartTime).toISOString()),
                    status: 0,
                    isOnline: false,
                    gapSeconds: Math.floor(timeSinceLastHeartbeat / 1000),
                  });
                  totalOfflineMs += offlineDurationMs;
                  totalOnlineMs += OFFLINE_THRESHOLD_SECONDS * 1000;
                  offlineEvents++;
                } else {
                  // Brief gap - treat as still online
                  totalOnlineMs += timeSinceLastHeartbeat;
                }
              } else {
                // Still online - add time since last heartbeat as online
                totalOnlineMs += timeSinceLastHeartbeat;
              }

              // Calculate stats based on actual monitoring period (from first heartbeat to now)
              const totalMs = totalOnlineMs + totalOfflineMs;
              const uptimePct = totalMs > 0 ? (totalOnlineMs / totalMs) * 100 : 100;

              setConnectionData(downsample(statusData, 200));
              setConnectionStats({
                uptimePct,
                totalOnlineMinutes: Math.floor(totalOnlineMs / 60000),
                totalOfflineMinutes: Math.floor(totalOfflineMs / 60000),
                offlineEvents,
              });
            }
          } else {
            console.error("Error fetching heartbeats:", response.statusText);
            setConnectionData([]);
            setConnectionStats(null);
          }
        } catch (err) {
          console.error("Error fetching connection status:", err);
          setConnectionData([]);
          setConnectionStats(null);
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

  // Get chart title and description based on type
  const getChartInfo = () => {
    switch (chartType) {
      case "connection":
        return { title: "Connection Status", description: "Controller online/offline history" };
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
              <TabsTrigger value="connection" className="flex items-center gap-1.5">
                <Wifi className="h-4 w-4" />
                <span className="hidden sm:inline">Connection</span>
                <span className="sm:hidden">Conn</span>
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
            {chartType === "connection" && (
              // Connection Status Chart
              connectionData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <Wifi className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No connection data available for this time range</p>
                    <p className="text-sm mt-1">Heartbeats will appear here when controller connects</p>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col">
                  {/* Stats row */}
                  {connectionStats && (
                    <div className="flex flex-wrap gap-4 mb-4 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-green-500" />
                        <span className="text-muted-foreground">Uptime:</span>
                        <span className="font-medium">{connectionStats.uptimePct.toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Online:</span>
                        <span className="font-medium">{connectionStats.totalOnlineMinutes}m</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-red-500" />
                        <span className="text-muted-foreground">Offline:</span>
                        <span className="font-medium">{connectionStats.totalOfflineMinutes}m</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Disconnections:</span>
                        <span className="font-medium">{connectionStats.offlineEvents}</span>
                      </div>
                    </div>
                  )}
                  {/* Chart */}
                  <div className="flex-1 min-h-[200px]">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
                      <AreaChart data={connectionData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <defs>
                          <linearGradient id="connectionGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={CHART_COLORS.online} stopOpacity={0.8}/>
                            <stop offset="95%" stopColor={CHART_COLORS.online} stopOpacity={0.1}/>
                          </linearGradient>
                        </defs>
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
                          domain={[0, 1]}
                          ticks={[0, 1]}
                          tickFormatter={(value) => value === 1 ? "Online" : "Offline"}
                        />
                        <Tooltip
                          content={({ active, payload, label }) => {
                            if (!active || !payload || !payload.length) return null;
                            const point = payload[0].payload as ConnectionStatusPoint;
                            return (
                              <div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
                                <p className="font-medium mb-2">{label}</p>
                                <div className="flex items-center gap-2">
                                  <div
                                    className={`w-3 h-3 rounded-full ${point.isOnline ? 'bg-green-500' : 'bg-red-500'}`}
                                  />
                                  <span className="font-medium">
                                    {point.isOnline ? 'Online' : 'Offline'}
                                  </span>
                                </div>
                                {point.gapSeconds !== undefined && point.gapSeconds > 0 && (
                                  <p className="text-muted-foreground mt-1">
                                    {point.isOnline
                                      ? `Heartbeat received`
                                      : `Gap: ${Math.floor(point.gapSeconds / 60)}m ${point.gapSeconds % 60}s`
                                    }
                                  </p>
                                )}
                              </div>
                            );
                          }}
                        />
                        <Area
                          type="stepAfter"
                          dataKey="status"
                          stroke={CHART_COLORS.online}
                          fill="url(#connectionGradient)"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, fill: CHART_COLORS.online }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
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
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={250}>
                  <LineChart data={systemData} margin={{ top: 5, right: 50, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      className="text-muted-foreground"
                    />
                    {/* Left Y-Axis: Percentage (CPU, Memory, Disk) */}
                    <YAxis
                      yAxisId="pct"
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      className="text-muted-foreground"
                      tickFormatter={(value) => `${value}%`}
                      domain={[0, 100]}
                      label={{ value: "%", angle: -90, position: "insideLeft", style: { fontSize: 12 } }}
                    />
                    {/* Right Y-Axis: Temperature (°C) */}
                    {systemData.some(d => d.temp_celsius !== null) && (
                      <YAxis
                        yAxisId="temp"
                        orientation="right"
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        className="text-muted-foreground"
                        tickFormatter={(value) => `${value}°C`}
                        domain={[0, 100]}
                        label={{ value: "°C", angle: 90, position: "insideRight", style: { fontSize: 12 } }}
                      />
                    )}
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
                      yAxisId="pct"
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
                      yAxisId="pct"
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
                      yAxisId="pct"
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
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={250}>
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
