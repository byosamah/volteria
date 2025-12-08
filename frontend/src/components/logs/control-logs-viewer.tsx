"use client";

/**
 * Control Logs Viewer Component
 *
 * Displays control logs in a table with:
 * - Time range filtering
 * - Pagination
 * - Export functionality (CSV/JSON)
 */

import { useState, useEffect } from "react";
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

export function ControlLogsViewer({ projectId, siteId }: ControlLogsViewerProps) {
  const [logs, setLogs] = useState<ControlLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState("1h"); // 1h, 6h, 24h, 7d
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
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
      "DG Power (kW)",
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
          <p className="text-muted-foreground text-center py-8">
            No logs found for this time period
          </p>
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
                      <span className="text-muted-foreground">DG</span>
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
                    <TableHead className="text-right">DG (kW)</TableHead>
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
