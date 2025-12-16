"use client";

/**
 * Data Usage List - Client Component
 *
 * Interactive table displaying enterprise storage usage with:
 * - Search/filter by enterprise name
 * - Package filter dropdown
 * - Warning level indicators
 * - Expandable rows for detailed breakdown
 * - Sort by usage percentage
 */

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import {
  Search,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Database,
  Bell,
  Activity,
  Users,
  Building2,
  Cpu,
} from "lucide-react";

// Type for enterprise usage data passed from server component
interface EnterpriseUsage {
  enterprise_id: string;
  enterprise_name: string;
  package_id: string | null;
  package_name: string | null;
  storage_limit_bytes: number | null;
  storage_limit_gb: number | null;
  total_storage_bytes: number;
  total_storage_gb: number;
  storage_usage_percent: number;
  control_logs_bytes: number;
  control_logs_rows: number;
  alarms_bytes: number;
  heartbeats_bytes: number;
  sites_count: number;
  controllers_count: number;
  users_count: number;
  warning_level: string;
  grace_period_start: string | null;
  snapshot_date: string | null;
}

// Type for usage package
interface UsagePackage {
  id: string;
  name: string;
  storage_limit_bytes: number;
  bandwidth_limit_bytes: number | null;
  max_sites: number | null;
  max_controllers: number | null;
}

interface DataUsageListProps {
  enterprises: EnterpriseUsage[];
  packages: UsagePackage[];
}

// Helper to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Get badge variant based on warning level
function getWarningBadge(level: string) {
  switch (level) {
    case "critical":
      return (
        <Badge variant="destructive" className="animate-pulse">
          Critical
        </Badge>
      );
    case "exceeded":
      return <Badge variant="destructive">Over Limit</Badge>;
    case "approaching":
      return (
        <Badge className="bg-amber-500 hover:bg-amber-600 text-white">
          Warning
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="bg-green-100 text-green-800">
          Normal
        </Badge>
      );
  }
}

// Get progress bar color based on percentage
function getProgressColor(percent: number): string {
  if (percent >= 100) return "bg-red-500";
  if (percent >= 80) return "bg-amber-500";
  return "bg-green-500";
}

export function DataUsageList({ enterprises, packages }: DataUsageListProps) {
  // State for filters and expansion
  const [searchQuery, setSearchQuery] = useState("");
  const [packageFilter, setPackageFilter] = useState<string>("all");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"name" | "usage">("usage");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Filter and sort enterprises
  const filteredEnterprises = useMemo(() => {
    let result = [...enterprises];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.enterprise_name.toLowerCase().includes(query) ||
          e.package_name?.toLowerCase().includes(query)
      );
    }

    // Package filter
    if (packageFilter !== "all") {
      result = result.filter((e) => e.package_id === packageFilter);
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === "name") {
        const comparison = a.enterprise_name.localeCompare(b.enterprise_name);
        return sortOrder === "asc" ? comparison : -comparison;
      } else {
        // Sort by usage percentage
        const comparison = a.storage_usage_percent - b.storage_usage_percent;
        return sortOrder === "asc" ? comparison : -comparison;
      }
    });

    return result;
  }, [enterprises, searchQuery, packageFilter, sortBy, sortOrder]);

  // Toggle row expansion
  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  // Toggle sort
  const handleSort = (column: "name" | "usage") => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder(column === "name" ? "asc" : "desc");
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters Row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Search Input */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search enterprises..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Package Filter */}
        <div className="flex gap-2 items-center">
          <span className="text-sm text-muted-foreground">Package:</span>
          <Select value={packageFilter} onValueChange={setPackageFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Packages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Packages</SelectItem>
              {packages.map((pkg) => (
                <SelectItem key={pkg.id} value={pkg.id}>
                  {pkg.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead>
                <Button
                  variant="ghost"
                  className="h-8 px-2 -ml-2 font-medium"
                  onClick={() => handleSort("name")}
                >
                  Enterprise
                  {sortBy === "name" && (
                    <span className="ml-1">{sortOrder === "asc" ? "↑" : "↓"}</span>
                  )}
                </Button>
              </TableHead>
              <TableHead>Package</TableHead>
              <TableHead className="hidden md:table-cell">
                <Button
                  variant="ghost"
                  className="h-8 px-2 -ml-2 font-medium"
                  onClick={() => handleSort("usage")}
                >
                  Usage
                  {sortBy === "usage" && (
                    <span className="ml-1">{sortOrder === "asc" ? "↑" : "↓"}</span>
                  )}
                </Button>
              </TableHead>
              <TableHead className="hidden lg:table-cell">Storage</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEnterprises.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  {searchQuery || packageFilter !== "all"
                    ? "No enterprises match your filters"
                    : "No enterprises with usage data"}
                </TableCell>
              </TableRow>
            ) : (
              filteredEnterprises.map((enterprise) => (
                <Collapsible
                  key={enterprise.enterprise_id}
                  open={expandedRows.has(enterprise.enterprise_id)}
                  onOpenChange={() => toggleRow(enterprise.enterprise_id)}
                  asChild
                >
                  <>
                    {/* Main Row */}
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleRow(enterprise.enterprise_id)}
                    >
                      <TableCell>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                            {expandedRows.has(enterprise.enterprise_id) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </CollapsibleTrigger>
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {enterprise.enterprise_name}
                        </div>
                      </TableCell>
                      <TableCell>
                        {enterprise.package_name ? (
                          <Badge variant="outline">{enterprise.package_name}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">No package</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex items-center gap-2 min-w-[150px]">
                          <Progress
                            value={Math.min(enterprise.storage_usage_percent, 100)}
                            className={`h-2 flex-1 ${getProgressColor(enterprise.storage_usage_percent)}`}
                          />
                          <span className="text-sm font-medium w-12 text-right">
                            {enterprise.storage_usage_percent}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="text-sm">
                          {enterprise.total_storage_gb} GB
                          {enterprise.storage_limit_gb && (
                            <span className="text-muted-foreground">
                              {" "}/ {enterprise.storage_limit_gb} GB
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {getWarningBadge(enterprise.warning_level)}
                      </TableCell>
                    </TableRow>

                    {/* Expanded Details */}
                    <CollapsibleContent asChild>
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={6} className="p-0">
                          <div className="p-4 space-y-4">
                            {/* Usage Breakdown */}
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                              {/* Control Logs */}
                              <div className="flex items-start gap-3 p-3 bg-background rounded-lg border">
                                <div className="p-2 bg-blue-100 rounded-lg">
                                  <Database className="h-4 w-4 text-blue-600" />
                                </div>
                                <div>
                                  <p className="text-sm font-medium">Control Logs</p>
                                  <p className="text-lg font-bold">
                                    {formatBytes(enterprise.control_logs_bytes)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {enterprise.control_logs_rows.toLocaleString()} rows
                                  </p>
                                </div>
                              </div>

                              {/* Alarms */}
                              <div className="flex items-start gap-3 p-3 bg-background rounded-lg border">
                                <div className="p-2 bg-amber-100 rounded-lg">
                                  <Bell className="h-4 w-4 text-amber-600" />
                                </div>
                                <div>
                                  <p className="text-sm font-medium">Alarms</p>
                                  <p className="text-lg font-bold">
                                    {formatBytes(enterprise.alarms_bytes)}
                                  </p>
                                </div>
                              </div>

                              {/* Heartbeats */}
                              <div className="flex items-start gap-3 p-3 bg-background rounded-lg border">
                                <div className="p-2 bg-green-100 rounded-lg">
                                  <Activity className="h-4 w-4 text-green-600" />
                                </div>
                                <div>
                                  <p className="text-sm font-medium">Heartbeats</p>
                                  <p className="text-lg font-bold">
                                    {formatBytes(enterprise.heartbeats_bytes)}
                                  </p>
                                </div>
                              </div>

                              {/* Resources */}
                              <div className="flex items-start gap-3 p-3 bg-background rounded-lg border">
                                <div className="p-2 bg-purple-100 rounded-lg">
                                  <HardDrive className="h-4 w-4 text-purple-600" />
                                </div>
                                <div>
                                  <p className="text-sm font-medium">Resources</p>
                                  <div className="flex gap-4 mt-1">
                                    <div className="flex items-center gap-1">
                                      <Building2 className="h-3 w-3 text-muted-foreground" />
                                      <span className="text-sm">{enterprise.sites_count} sites</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Cpu className="h-3 w-3 text-muted-foreground" />
                                      <span className="text-sm">{enterprise.controllers_count}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Users className="h-3 w-3 text-muted-foreground" />
                                      <span className="text-sm">{enterprise.users_count}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Grace Period Warning */}
                            {enterprise.grace_period_start && (
                              <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
                                <Bell className="h-4 w-4" />
                                <span className="text-sm">
                                  Grace period started:{" "}
                                  {new Date(enterprise.grace_period_start).toLocaleDateString()}
                                  {" - "}
                                  {(() => {
                                    const start = new Date(enterprise.grace_period_start);
                                    const end = new Date(start);
                                    end.setDate(end.getDate() + 30);
                                    const daysLeft = Math.ceil(
                                      (end.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                                    );
                                    return daysLeft > 0
                                      ? `${daysLeft} days remaining`
                                      : "Grace period expired";
                                  })()}
                                </span>
                              </div>
                            )}

                            {/* Snapshot Info */}
                            {enterprise.snapshot_date && (
                              <p className="text-xs text-muted-foreground">
                                Last snapshot:{" "}
                                {new Date(enterprise.snapshot_date).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    </CollapsibleContent>
                  </>
                </Collapsible>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Results Summary */}
      <div className="text-sm text-muted-foreground">
        Showing {filteredEnterprises.length} of {enterprises.length} enterprises
      </div>
    </div>
  );
}
