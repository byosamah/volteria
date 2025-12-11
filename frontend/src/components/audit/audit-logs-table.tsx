/**
 * Audit Logs Table Component
 *
 * ⚠️ PHASE 5 - Enterprise Features
 *
 * Client component with:
 * - Filterable columns (user, action, category, status)
 * - Search functionality
 * - Date range filter
 * - Pagination
 * - Detail view dialog
 * - Export to CSV
 */

"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  History,
  Search,
  RefreshCw,
  Download,
  ChevronLeft,
  ChevronRight,
  User,
  Clock,
  Activity,
  Shield,
  AlertCircle,
  CheckCircle,
  XCircle,
  Eye,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Audit log entry type
interface AuditLog {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_role: string | null;
  action: string;
  action_category: string;
  resource_type: string | null;
  resource_id: string | null;
  resource_name: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  status: string;
  error_message: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  // Joined
  users?: { full_name: string | null } | null;
}

// Action category colors
const categoryColors: Record<string, string> = {
  auth: "bg-purple-100 text-purple-700",
  project: "bg-blue-100 text-blue-700",
  site: "bg-cyan-100 text-cyan-700",
  device: "bg-orange-100 text-orange-700",
  user: "bg-pink-100 text-pink-700",
  controller: "bg-green-100 text-green-700",
  alarm: "bg-red-100 text-red-700",
  setting: "bg-gray-100 text-gray-700",
  control: "bg-yellow-100 text-yellow-700",
  export: "bg-indigo-100 text-indigo-700",
};

// Status badge component
function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "success":
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
          <CheckCircle className="h-3 w-3 mr-1" />
          Success
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    case "denied":
      return (
        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
          <AlertCircle className="h-3 w-3 mr-1" />
          Denied
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

// Format relative time
function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

// Format action for display
function formatAction(action: string): string {
  return action
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function AuditLogsTable() {
  // Data state
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<string>("7d");

  // Pagination state
  const [page, setPage] = useState(0);
  const pageSize = 20;

  // Detail dialog state
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  // Fetch audit logs
  async function fetchLogs() {
    setLoading(true);
    const supabase = createClient();

    // Calculate date range
    let startDate: Date | null = null;
    const now = new Date();

    switch (dateRange) {
      case "1d":
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 1);
        break;
      case "7d":
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      case "30d":
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 30);
        break;
      case "90d":
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 90);
        break;
    }

    // Build query
    let query = supabase
      .from("audit_logs")
      .select(`
        id,
        user_id,
        user_email,
        user_role,
        action,
        action_category,
        resource_type,
        resource_id,
        resource_name,
        old_value,
        new_value,
        metadata,
        status,
        error_message,
        ip_address,
        user_agent,
        created_at,
        users:user_id (full_name)
      `, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    // Apply filters
    if (startDate) {
      query = query.gte("created_at", startDate.toISOString());
    }

    if (categoryFilter !== "all") {
      query = query.eq("action_category", categoryFilter);
    }

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    if (searchQuery) {
      query = query.or(`user_email.ilike.%${searchQuery}%,resource_name.ilike.%${searchQuery}%,action.ilike.%${searchQuery}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error("Failed to fetch audit logs:", error);
    } else {
      setLogs(data as AuditLog[]);
      setTotalCount(count || 0);
    }

    setLoading(false);
  }

  // Fetch on mount and when filters change
  useEffect(() => {
    fetchLogs();
  }, [page, categoryFilter, statusFilter, dateRange, searchQuery]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [categoryFilter, statusFilter, dateRange, searchQuery]);

  // Export to CSV
  function handleExport() {
    const headers = [
      "Timestamp",
      "User",
      "Action",
      "Category",
      "Resource",
      "Status",
      "IP Address",
    ];

    const csvRows = [
      headers.join(","),
      ...logs.map((log) =>
        [
          new Date(log.created_at).toISOString(),
          log.user_email || "System",
          log.action,
          log.action_category,
          log.resource_name || log.resource_type || "-",
          log.status,
          log.ip_address || "-",
        ]
          .map((val) => `"${val}"`)
          .join(",")
      ),
    ];

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `audit-logs-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Calculate pagination
  const totalPages = Math.ceil(totalCount / pageSize);
  const canGoPrev = page > 0;
  const canGoNext = page < totalPages - 1;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Activity Log
              </CardTitle>
              <CardDescription>
                {totalCount.toLocaleString()} events in selected period
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchLogs}
                className="min-h-[44px]"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                className="min-h-[44px]"
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users, actions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 min-h-[44px]"
              />
            </div>

            {/* Category filter */}
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="auth">Authentication</SelectItem>
                <SelectItem value="project">Projects</SelectItem>
                <SelectItem value="site">Sites</SelectItem>
                <SelectItem value="device">Devices</SelectItem>
                <SelectItem value="user">Users</SelectItem>
                <SelectItem value="controller">Controllers</SelectItem>
                <SelectItem value="alarm">Alarms</SelectItem>
                <SelectItem value="control">Remote Control</SelectItem>
                <SelectItem value="export">Exports</SelectItem>
              </SelectContent>
            </Select>

            {/* Status filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="denied">Denied</SelectItem>
              </SelectContent>
            </Select>

            {/* Date range */}
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue placeholder="Date range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1d">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading audit logs...
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No audit logs found for the selected filters.</p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Resource</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[60px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-1 text-sm">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            {formatTimeAgo(log.created_at)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <span className="truncate max-w-[150px]">
                              {log.users?.full_name || log.user_email || "System"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">{formatAction(log.action)}</span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={categoryColors[log.action_category] || "bg-gray-100"}
                          >
                            {log.action_category}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="truncate max-w-[150px] text-sm text-muted-foreground">
                            {log.resource_name || log.resource_type || "-"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={log.status} />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedLog(log)}
                            className="min-h-[36px] min-w-[36px] p-0"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={categoryColors[log.action_category] || "bg-gray-100"}
                        >
                          {log.action_category}
                        </Badge>
                        <StatusBadge status={log.status} />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatTimeAgo(log.created_at)}
                      </span>
                    </div>
                    <p className="font-medium">{formatAction(log.action)}</p>
                    <p className="text-sm text-muted-foreground">
                      {log.users?.full_name || log.user_email || "System"}
                    </p>
                    {log.resource_name && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {log.resource_type}: {log.resource_name}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between pt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, totalCount)} of{" "}
                  {totalCount.toLocaleString()}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={!canGoPrev}
                    className="min-h-[44px]"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={!canGoNext}
                    className="min-h-[44px]"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Audit Log Details
            </DialogTitle>
            <DialogDescription>
              {selectedLog && new Date(selectedLog.created_at).toLocaleString()}
            </DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4">
              {/* Basic info */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-muted-foreground">User</p>
                  <p className="font-medium">
                    {selectedLog.users?.full_name || selectedLog.user_email || "System"}
                  </p>
                  {selectedLog.user_role && (
                    <p className="text-sm text-muted-foreground">{selectedLog.user_role}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Action</p>
                  <p className="font-medium">{formatAction(selectedLog.action)}</p>
                  <Badge
                    variant="outline"
                    className={categoryColors[selectedLog.action_category] || "bg-gray-100"}
                  >
                    {selectedLog.action_category}
                  </Badge>
                </div>
              </div>

              {/* Resource */}
              {(selectedLog.resource_type || selectedLog.resource_name) && (
                <div>
                  <p className="text-sm text-muted-foreground">Resource</p>
                  <p className="font-medium">
                    {selectedLog.resource_type}: {selectedLog.resource_name || selectedLog.resource_id}
                  </p>
                </div>
              )}

              {/* Status */}
              <div>
                <p className="text-sm text-muted-foreground mb-1">Status</p>
                <StatusBadge status={selectedLog.status} />
                {selectedLog.error_message && (
                  <p className="text-sm text-red-600 mt-1">{selectedLog.error_message}</p>
                )}
              </div>

              {/* IP & User Agent */}
              {(selectedLog.ip_address || selectedLog.user_agent) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {selectedLog.ip_address && (
                    <div>
                      <p className="text-sm text-muted-foreground">IP Address</p>
                      <p className="font-mono text-sm">{selectedLog.ip_address}</p>
                    </div>
                  )}
                  {selectedLog.user_agent && (
                    <div>
                      <p className="text-sm text-muted-foreground">User Agent</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {selectedLog.user_agent}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Changes (old/new value) */}
              {(selectedLog.old_value || selectedLog.new_value) && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Changes</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {selectedLog.old_value && (
                      <div className="p-3 rounded bg-red-50 border border-red-200">
                        <p className="text-xs font-medium text-red-700 mb-1">Before</p>
                        <pre className="text-xs overflow-x-auto">
                          {JSON.stringify(selectedLog.old_value, null, 2)}
                        </pre>
                      </div>
                    )}
                    {selectedLog.new_value && (
                      <div className="p-3 rounded bg-green-50 border border-green-200">
                        <p className="text-xs font-medium text-green-700 mb-1">After</p>
                        <pre className="text-xs overflow-x-auto">
                          {JSON.stringify(selectedLog.new_value, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Metadata */}
              {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Additional Details</p>
                  <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
