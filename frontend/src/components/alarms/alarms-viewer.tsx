"use client";

/**
 * Alarms Viewer Component
 *
 * Displays alarms with:
 * - Filtering by severity and status
 * - Acknowledge functionality
 * - Bulk acknowledge
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Alarm type
interface Alarm {
  id: string;
  alarm_type: string;
  device_name: string | null;
  message: string;
  condition: string | null;
  severity: string;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

interface AlarmsViewerProps {
  projectId: string;
  siteId?: string;  // Optional: for sites architecture
}

export function AlarmsViewer({ projectId, siteId }: AlarmsViewerProps) {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all, unacknowledged, unresolved, critical, warning, info
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  // Fetch alarms
  const fetchAlarms = async () => {
    setLoading(true);
    const supabase = createClient();

    let query = supabase
      .from("alarms")
      .select("*");

    // Filter by site_id or project_id
    if (siteId) {
      query = query.eq("site_id", siteId);
    } else {
      query = query.eq("project_id", projectId);
    }

    query = query
      .order("created_at", { ascending: false })
      .limit(100);

    // Apply filters
    if (filter === "unacknowledged") {
      query = query.eq("acknowledged", false);
    } else if (filter === "unresolved") {
      query = query.eq("resolved", false);
    } else if (filter === "critical" || filter === "warning" || filter === "info") {
      query = query.eq("severity", filter);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching alarms:", error);
    } else {
      setAlarms(data || []);
    }
    setLoading(false);
  };

  // Fetch alarms when filter changes
  useEffect(() => {
    fetchAlarms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, projectId, siteId]);

  // Acknowledge single alarm
  const acknowledgeAlarm = async (alarmId: string) => {
    setAcknowledging(alarmId);
    const supabase = createClient();

    const { error } = await supabase
      .from("alarms")
      .update({
        acknowledged: true,
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", alarmId);

    if (error) {
      console.error("Error acknowledging alarm:", error);
    } else {
      // Refresh the list
      fetchAlarms();
    }
    setAcknowledging(null);
  };

  // Acknowledge all unacknowledged alarms
  const acknowledgeAll = async () => {
    setLoading(true);
    const supabase = createClient();

    // Build query - use site_id if provided, otherwise project_id
    let query = supabase
      .from("alarms")
      .update({
        acknowledged: true,
        acknowledged_at: new Date().toISOString(),
      });

    if (siteId) {
      query = query.eq("site_id", siteId);
    } else {
      query = query.eq("project_id", projectId);
    }

    const { error } = await query.eq("acknowledged", false);

    if (error) {
      console.error("Error acknowledging all alarms:", error);
    } else {
      fetchAlarms();
    }
  };

  // Resolve single alarm (mark issue as fixed)
  const resolveAlarm = async (alarmId: string) => {
    setResolving(alarmId);
    const supabase = createClient();

    const { error } = await supabase
      .from("alarms")
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", alarmId);

    if (error) {
      console.error("Error resolving alarm:", error);
    } else {
      // Refresh the list
      fetchAlarms();
    }
    setResolving(null);
  };

  // Format timestamp for display
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  // Get severity badge variant
  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "critical":
        return <Badge variant="destructive">Critical</Badge>;
      case "major":
        return <Badge className="bg-orange-500 hover:bg-orange-600 text-white">Major</Badge>;
      case "minor":
        return <Badge className="bg-amber-500 hover:bg-amber-600 text-white">Minor</Badge>;
      case "warning":
        return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-black">Warning</Badge>;
      case "info":
        return <Badge variant="secondary">Info</Badge>;
      default:
        return <Badge variant="outline">{severity}</Badge>;
    }
  };

  // Get alarm type display name
  const getAlarmTypeName = (type: string) => {
    const names: Record<string, string> = {
      communication_lost: "Communication Lost",
      control_error: "Control Error",
      safe_mode_triggered: "Safe Mode Triggered",
      not_reporting: "Not Reporting",
      controller_offline: "Controller Offline",
      write_failed: "Write Failed",
      command_not_taken: "Command Not Taken",
    };
    return names[type] || type;
  };

  // Get condition display for alarms
  const getConditionDisplay = (alarm: Alarm) => {
    // Device threshold alarms: use condition column if available
    if (alarm.alarm_type.startsWith("reg_")) {
      // Prefer condition column (new format)
      if (alarm.condition) {
        return alarm.condition;
      }
      // Fallback: extract register name from alarm_type
      const parts = alarm.alarm_type.split("_");
      if (parts.length >= 3) return parts.slice(2).join("_");
    }
    // System alarms: use readable name
    return getAlarmTypeName(alarm.alarm_type);
  };

  // Count unacknowledged alarms
  const unacknowledgedCount = alarms.filter((a) => !a.acknowledged).length;

  return (
    <Card>
      <CardHeader>
        {/* MOBILE-FRIENDLY: Header stacks on mobile */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Alarms
              {unacknowledgedCount > 0 && (
                <Badge variant="destructive">{unacknowledgedCount} new</Badge>
              )}
            </CardTitle>
            <CardDescription>System alerts for this project</CardDescription>
          </div>
          {/* Controls - wrap on mobile */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Filter Selector - 44px touch target */}
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-[160px] min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Alarms</SelectItem>
                <SelectItem value="unacknowledged">Unacknowledged</SelectItem>
                <SelectItem value="unresolved">Unresolved</SelectItem>
                <SelectItem value="critical">Critical Only</SelectItem>
                <SelectItem value="warning">Warnings Only</SelectItem>
                <SelectItem value="info">Info Only</SelectItem>
              </SelectContent>
            </Select>

            {/* Acknowledge All Button - hidden on very small screens */}
            {unacknowledgedCount > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="hidden xs:inline-flex min-h-[44px]">
                    Acknowledge All
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="mx-4 max-w-[calc(100%-2rem)]">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Acknowledge All Alarms?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will mark all {unacknowledgedCount} unacknowledged alarms as acknowledged.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                    <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={acknowledgeAll} className="min-h-[44px]">
                      Acknowledge All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {/* Refresh Button - 44px touch target */}
            <Button variant="outline" size="sm" onClick={fetchAlarms} className="min-w-[44px] min-h-[44px]">
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
        ) : alarms.length === 0 ? (
          <div className="text-center py-8">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-12 w-12 mx-auto text-muted-foreground mb-4">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <p className="text-muted-foreground">No alarms found</p>
          </div>
        ) : (
          <>
            {/* MOBILE: Card view for small screens */}
            <div className="sm:hidden space-y-3">
              {alarms.map((alarm) => (
                <div
                  key={alarm.id}
                  className={`rounded-lg border p-3 space-y-2 ${
                    !alarm.acknowledged ? "bg-red-50 dark:bg-red-950/20 border-red-200" : ""
                  }`}
                >
                  {/* Top row: Severity, Status, Time */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getSeverityBadge(alarm.severity)}
                      {alarm.resolved ? (
                        <Badge variant="outline" className="text-xs bg-green-100 text-green-800">Resolved</Badge>
                      ) : alarm.acknowledged ? (
                        <Badge variant="outline" className="text-xs">Ack&apos;d</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs">Active</Badge>
                      )}
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">
                      {formatTime(alarm.created_at)}
                    </span>
                  </div>

                  {/* Condition and Device */}
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{getConditionDisplay(alarm)}</p>
                    {alarm.device_name && (
                      <p className="text-xs text-muted-foreground">Device: {alarm.device_name}</p>
                    )}
                  </div>

                  {/* Message */}
                  <p className="text-sm text-muted-foreground">{alarm.message}</p>

                  {/* Action buttons - 44px touch targets */}
                  {(!alarm.acknowledged || (alarm.acknowledged && !alarm.resolved)) && (
                    <div className="flex gap-2">
                      {!alarm.acknowledged && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => acknowledgeAlarm(alarm.id)}
                          disabled={acknowledging === alarm.id}
                          className="flex-1 min-h-[44px]"
                        >
                          {acknowledging === alarm.id ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                          ) : (
                            "Acknowledge"
                          )}
                        </Button>
                      )}
                      {alarm.acknowledged && !alarm.resolved && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => resolveAlarm(alarm.id)}
                          disabled={resolving === alarm.id}
                          className="flex-1 min-h-[44px] border-green-300 text-green-700 hover:bg-green-50"
                        >
                          {resolving === alarm.id ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
                          ) : (
                            "Mark Resolved"
                          )}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* DESKTOP: Table view for larger screens */}
            <div className="hidden sm:block rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date & Time</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alarms.map((alarm) => (
                    <TableRow
                      key={alarm.id}
                      className={!alarm.acknowledged ? "bg-red-50 dark:bg-red-950/20" : ""}
                    >
                      <TableCell className="font-mono text-sm whitespace-nowrap">
                        {formatTime(alarm.created_at)}
                      </TableCell>
                      <TableCell>{getSeverityBadge(alarm.severity)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {getConditionDisplay(alarm)}
                      </TableCell>
                      <TableCell>{alarm.device_name || "-"}</TableCell>
                      <TableCell className="max-w-[300px] truncate">
                        {alarm.message}
                      </TableCell>
                      <TableCell>
                        {alarm.resolved ? (
                          <Badge variant="outline" className="bg-green-100 text-green-800">Resolved</Badge>
                        ) : alarm.acknowledged ? (
                          <Badge variant="outline">Acknowledged</Badge>
                        ) : (
                          <Badge variant="destructive">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {!alarm.acknowledged && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => acknowledgeAlarm(alarm.id)}
                              disabled={acknowledging === alarm.id}
                              className="min-h-[44px]"
                            >
                              {acknowledging === alarm.id ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                              ) : (
                                "Acknowledge"
                              )}
                            </Button>
                          )}
                          {alarm.acknowledged && !alarm.resolved && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => resolveAlarm(alarm.id)}
                              disabled={resolving === alarm.id}
                              className="min-h-[44px] text-green-700 hover:text-green-800 hover:bg-green-50"
                            >
                              {resolving === alarm.id ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
                              ) : (
                                "Resolve"
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
