"use client";

/**
 * Control Logs Viewer Component
 *
 * Displays control logs in a table with:
 * - Time range filtering
 * - Pagination
 * - Export functionality (CSV/JSON)
 * - Contextual empty states based on controller status
 */

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Log entry type
interface ControlLog {
  id: number;
  timestamp: string;
  total_load_kw: number | null;
  dg_power_kw: number | null;
  solar_output_kw: number | null;
  solar_limit_pct: number | null;
  available_headroom_kw: number | null;
  safe_mode_active: boolean;
  config_mode: string | null;
}

interface ControlLogsViewerProps {
  projectId: string;
  siteId?: string;  // Optional: for sites architecture
}

// Site status interface for contextual empty states
interface SiteStatus {
  connection: {
    status: "online" | "offline";
    lastSeen: string | null;
    type: "controller" | "gateway" | "none";
  };
  logging: {
    hasLogs: boolean;
    lastLogTimestamp: string | null;
    totalLogs: number;
  };
}

export function ControlLogsViewer({ projectId, siteId }: ControlLogsViewerProps) {
  const [logs, setLogs] = useState<ControlLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState("1h"); // 1h, 6h, 24h, 7d
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [siteStatus, setSiteStatus] = useState<SiteStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const pageSize = 50;

  // Calculate start time based on time range
  const getStartTime = () => {
    const now = new Date();
    switch (timeRange) {
      case "1h":
        return new Date(now.getTime() - 60 * 60 * 1000);
      case "6h":
        return new Date(now.getTime() - 6 * 60 * 60 * 1000);
      case "24h":
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case "7d":
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 60 * 60 * 1000);
    }
  };

  // Fetch site status (controller/gateway connection and logging status)
  const fetchSiteStatus = useCallback(async () => {
    // Only fetch status for sites (not project-level)
    if (!siteId) return;

    setStatusLoading(true);
    try {
      const response = await fetch(`/api/sites/${siteId}/status`);
      if (response.ok) {
        const data = await response.json();
        setSiteStatus(data);
      }
    } catch (error) {
      console.error("Error fetching site status:", error);
    }
    setStatusLoading(false);
  }, [siteId]);

  // Fetch logs
  const fetchLogs = async () => {
    setLoading(true);
    const supabase = createClient();
    const startTime = getStartTime();

    // Build query - use site_id if provided, otherwise project_id
    let query = supabase
      .from("control_logs")
      .select(
        "id, timestamp, total_load_kw, dg_power_kw, solar_output_kw, solar_limit_pct, available_headroom_kw, safe_mode_active, config_mode"
      );

    // Filter by site_id or project_id
    if (siteId) {
      query = query.eq("site_id", siteId);
    } else {
      query = query.eq("project_id", projectId);
    }

    const { data, error } = await query
      .gte("timestamp", startTime.toISOString())
      .order("timestamp", { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error("Error fetching logs:", error);
    } else {
      setLogs(data || []);
      setHasMore((data?.length || 0) === pageSize);
    }
    setLoading(false);
  };

  // Fetch site status on mount (for contextual empty states)
  useEffect(() => {
    fetchSiteStatus();
  }, [fetchSiteStatus]);

  // Fetch logs when time range or page changes
  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange, page, projectId, siteId]);

  // Export logs as CSV
  const exportCSV = async () => {
    const supabase = createClient();
    const startTime = getStartTime();

    // Build query - use site_id if provided, otherwise project_id
    let query = supabase
      .from("control_logs")
      .select(
        "timestamp, total_load_kw, dg_power_kw, solar_output_kw, solar_limit_pct, available_headroom_kw, safe_mode_active, config_mode"
      );

    if (siteId) {
      query = query.eq("site_id", siteId);
    } else {
      query = query.eq("project_id", projectId);
    }

    const { data } = await query
      .gte("timestamp", startTime.toISOString())
      .order("timestamp", { ascending: false });

    if (!data || data.length === 0) {
      alert("No data to export");
      return;
    }

    // Create CSV content
    const headers = [
      "Timestamp",
      "Total Load (kW)",
      "Generator Power (kW)",
      "Solar Output (kW)",
      "Solar Limit (%)",
      "Available Headroom (kW)",
      "Safe Mode",
      "Config Mode",
    ];

    const rows = data.map((log) => [
      log.timestamp,
      log.total_load_kw ?? "",
      log.dg_power_kw ?? "",
      log.solar_output_kw ?? "",
      log.solar_limit_pct ?? "",
      log.available_headroom_kw ?? "",
      log.safe_mode_active ? "Yes" : "No",
      log.config_mode ?? "",
    ]);

    const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

    // Download file
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `control_logs_${siteId || projectId}_${timeRange}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Export logs as JSON
  const exportJSON = async () => {
    const supabase = createClient();
    const startTime = getStartTime();

    // Build query - use site_id if provided, otherwise project_id
    let query = supabase
      .from("control_logs")
      .select(
        "timestamp, total_load_kw, dg_power_kw, solar_output_kw, solar_limit_pct, available_headroom_kw, safe_mode_active, config_mode"
      );

    if (siteId) {
      query = query.eq("site_id", siteId);
    } else {
      query = query.eq("project_id", projectId);
    }

    const { data } = await query
      .gte("timestamp", startTime.toISOString())
      .order("timestamp", { ascending: false });

    if (!data || data.length === 0) {
      alert("No data to export");
      return;
    }

    // Download file
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `control_logs_${siteId || projectId}_${timeRange}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Format timestamp for display
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  // Format relative time (e.g., "5 minutes ago")
  const formatRelativeTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  };

  // Render contextual empty state based on site status
  const renderEmptyState = () => {
    // If we're still loading status, show generic message
    if (statusLoading) {
      return (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Checking controller status...</p>
        </div>
      );
    }

    // For project-level view (no siteId), show generic message
    if (!siteId || !siteStatus) {
      return (
        <div className="text-center py-12">
          <svg className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-muted-foreground font-medium">No logs found for this time period</p>
          <p className="text-muted-foreground/70 text-sm mt-1">Try selecting a different time range</p>
        </div>
      );
    }

    const { connection, logging } = siteStatus;

    // Case 1: No controller assigned to this site
    if (connection.type === "none") {
      return (
        <div className="text-center py-12">
          <svg className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.181 8.68a4.503 4.503 0 011.903 6.405m-9.768-2.782L3.56 14.06a4.5 4.5 0 005.657 5.656l1.757-1.757m9.768-2.782l1.757-1.757a4.5 4.5 0 00-5.656-5.657l-1.757 1.757m5.574 6.161l-.881-.881m-9.768 2.782l-.881-.881m9.768-2.782l.881.881m-9.768 2.782l.881.881M9.75 9.75l4.5 4.5" />
          </svg>
          <p className="text-muted-foreground font-medium">No controller assigned</p>
          <p className="text-muted-foreground/70 text-sm mt-1">
            Assign a controller to this site to start collecting logs
          </p>
        </div>
      );
    }

    // Case 2: Controller is offline
    if (connection.status === "offline") {
      return (
        <div className="text-center py-12">
          <svg className="h-12 w-12 text-destructive/50 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
          </svg>
          <p className="text-muted-foreground font-medium">Controller is offline</p>
          <p className="text-muted-foreground/70 text-sm mt-1">
            {connection.lastSeen
              ? `Last seen ${formatRelativeTime(connection.lastSeen)}`
              : "Never connected"}
          </p>
          {logging.hasLogs && logging.lastLogTimestamp && (
            <p className="text-muted-foreground/70 text-sm mt-1">
              Last log received {formatRelativeTime(logging.lastLogTimestamp)}
            </p>
          )}
        </div>
      );
    }

    // Case 3: Controller online but no logs at all for this site
    if (!logging.hasLogs) {
      return (
        <div className="text-center py-12">
          <svg className="h-12 w-12 text-primary/50 mx-auto mb-4 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-muted-foreground font-medium">Waiting for data...</p>
          <p className="text-muted-foreground/70 text-sm mt-1">
            Controller is online. Data will appear shortly.
          </p>
        </div>
      );
    }

    // Case 4: Controller online, has logs but none in selected time range
    return (
      <div className="text-center py-12">
        <svg className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <p className="text-muted-foreground font-medium">No logs in this time range</p>
        <p className="text-muted-foreground/70 text-sm mt-1">
          {logging.lastLogTimestamp && (
            <>Last log received {formatRelativeTime(logging.lastLogTimestamp)}</>
          )}
        </p>
        <p className="text-muted-foreground/70 text-sm">Try selecting a longer time range</p>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        {/* MOBILE-FRIENDLY: Header stacks on mobile */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Control Logs</CardTitle>
            <CardDescription>Recent control loop data</CardDescription>
          </div>
          {/* Controls - wrap on mobile */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Time Range Selector */}
            <Select value={timeRange} onValueChange={(value) => { setTimeRange(value); setPage(0); }}>
              <SelectTrigger className="w-[120px] min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">Last 1 hour</SelectItem>
                <SelectItem value="6h">Last 6 hours</SelectItem>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
              </SelectContent>
            </Select>

            {/* Export Buttons - hidden on mobile to save space */}
            <Button variant="outline" size="sm" onClick={exportCSV} className="hidden sm:inline-flex min-h-[44px]">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-1">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" x2="12" y1="15" y2="3" />
              </svg>
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportJSON} className="hidden sm:inline-flex min-h-[44px]">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-1">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" x2="12" y1="15" y2="3" />
              </svg>
              JSON
            </Button>

            {/* Refresh Button - 44px touch target */}
            <Button variant="outline" size="sm" onClick={fetchLogs} className="min-w-[44px] min-h-[44px]">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </svg>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : logs.length === 0 ? (
          renderEmptyState()
        ) : (
          <>
            {/* MOBILE: Card view for small screens */}
            <div className="sm:hidden space-y-3">
              {logs.map((log) => (
                <div key={log.id} className="rounded-lg border p-3 space-y-2">
                  {/* Time and Status row */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-muted-foreground">
                      {formatTime(log.timestamp)}
                    </span>
                    {log.safe_mode_active ? (
                      <Badge variant="destructive" className="text-xs">Safe Mode</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">Normal</Badge>
                    )}
                  </div>
                  {/* Power values in 2x2 grid */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Load</span>
                      <span className="font-medium">{log.total_load_kw?.toFixed(1) ?? "-"} kW</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Generator</span>
                      <span className="font-medium">{log.dg_power_kw?.toFixed(1) ?? "-"} kW</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Solar</span>
                      <span className="font-medium text-[#6baf4f]">{log.solar_output_kw?.toFixed(1) ?? "-"} kW</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Limit</span>
                      <span className="font-medium">{log.solar_limit_pct?.toFixed(0) ?? "-"}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* DESKTOP: Table view for larger screens */}
            <div className="hidden sm:block rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead className="text-right">Load (kW)</TableHead>
                    <TableHead className="text-right">Generator (kW)</TableHead>
                    <TableHead className="text-right">Solar (kW)</TableHead>
                    <TableHead className="text-right">Limit (%)</TableHead>
                    <TableHead className="text-right">Headroom (kW)</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-sm">
                        {formatTime(log.timestamp)}
                      </TableCell>
                      <TableCell className="text-right">
                        {log.total_load_kw?.toFixed(1) ?? "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {log.dg_power_kw?.toFixed(1) ?? "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {log.solar_output_kw?.toFixed(1) ?? "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {log.solar_limit_pct?.toFixed(0) ?? "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {log.available_headroom_kw?.toFixed(1) ?? "-"}
                      </TableCell>
                      <TableCell>
                        {log.safe_mode_active ? (
                          <Badge variant="destructive">Safe Mode</Badge>
                        ) : (
                          <Badge variant="outline">Normal</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination - responsive with 44px touch targets */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mt-4">
              <p className="text-sm text-muted-foreground text-center sm:text-left">
                Showing {logs.length} records
              </p>
              <div className="flex gap-2 justify-center sm:justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="min-h-[44px] min-w-[100px]"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasMore}
                  className="min-h-[44px] min-w-[100px]"
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
