/**
 * Command History Component
 *
 * ⚠️ PHASE 3 - Remote Control UI
 *
 * Shows audit trail of all commands sent to the site:
 * - Command type (power limit, DG reserve, emergency stop)
 * - Who executed the command
 * - When it was executed
 * - Status (sent, queued, executed, failed)
 *
 * Uses real-time subscription to show new commands as they're sent.
 */

"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, RefreshCw, Zap, Gauge, AlertOctagon, User, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Command type from the database
interface ControlCommand {
  id: string;
  site_id: string;
  project_id: string;
  command_type: "set_power_limit" | "set_dg_reserve" | "emergency_stop" | "resume_operations";
  command_value: Record<string, number | string | boolean>;
  status: "queued" | "sent" | "executed" | "failed";
  executed_by?: string;
  created_at: string;
  executed_at?: string;
  error_message?: string;
  // Joined user data
  users?: { full_name: string | null; email: string } | null;
}

// Props for the CommandHistory component
interface CommandHistoryProps {
  siteId: string;
  projectId: string;
}

// Helper to format command type for display
function formatCommandType(type: string): { label: string; icon: React.ReactNode; color: string } {
  switch (type) {
    case "set_power_limit":
      return {
        label: "Power Limit",
        icon: <Zap className="h-4 w-4" />,
        color: "bg-yellow-100 text-yellow-700",
      };
    case "set_dg_reserve":
      return {
        label: "DG Reserve",
        icon: <Gauge className="h-4 w-4" />,
        color: "bg-blue-100 text-blue-700",
      };
    case "emergency_stop":
      return {
        label: "Emergency Stop",
        icon: <AlertOctagon className="h-4 w-4" />,
        color: "bg-red-100 text-red-700",
      };
    case "resume_operations":
      return {
        label: "Resume Operations",
        icon: <RefreshCw className="h-4 w-4" />,
        color: "bg-green-100 text-green-700",
      };
    default:
      return {
        label: type,
        icon: <History className="h-4 w-4" />,
        color: "bg-gray-100 text-gray-700",
      };
  }
}

// Helper to format status badge
function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    queued: "bg-yellow-100 text-yellow-700 border-yellow-200",
    sent: "bg-blue-100 text-blue-700 border-blue-200",
    executed: "bg-green-100 text-green-700 border-green-200",
    failed: "bg-red-100 text-red-700 border-red-200",
  };

  return (
    <Badge variant="outline" className={`${variants[status] || "bg-gray-100"} capitalize`}>
      {status}
    </Badge>
  );
}

// Helper to format relative time
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
  return `${diffDays}d ago`;
}

// Helper to format command value for display
function formatCommandValue(type: string, value: Record<string, number | string | boolean>): string {
  switch (type) {
    case "set_power_limit":
      return `${value.power_limit_pct}%`;
    case "set_dg_reserve":
      return `${value.dg_reserve_kw} kW`;
    case "emergency_stop":
      return "All inverters → 0%";
    case "resume_operations":
      return "Normal operation";
    default:
      return JSON.stringify(value);
  }
}

export function CommandHistory({ siteId, projectId }: CommandHistoryProps) {
  const [commands, setCommands] = useState<ControlCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch command history
  async function fetchCommands() {
    const supabase = createClient();

    const { data, error } = await supabase
      .from("control_commands")
      .select(`
        id,
        site_id,
        project_id,
        command_type,
        command_value,
        status,
        executed_by,
        created_at,
        executed_at,
        error_message,
        users:executed_by (full_name, email)
      `)
      .eq("site_id", siteId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (!error && data) {
      // Transform Supabase data: users may be array, convert to single object or null
      const transformedData = data.map((cmd) => ({
        ...cmd,
        users: Array.isArray(cmd.users)
          ? cmd.users[0] || null
          : cmd.users || null,
      }));
      setCommands(transformedData as ControlCommand[]);
    }
    setLoading(false);
    setRefreshing(false);
  }

  // Initial fetch and real-time subscription
  useEffect(() => {
    fetchCommands();

    // Subscribe to new commands
    const supabase = createClient();
    const channel = supabase
      .channel("control_commands_changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "control_commands",
          filter: `site_id=eq.${siteId}`,
        },
        () => {
          // Refresh the list when a new command is added
          fetchCommands();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "control_commands",
          filter: `site_id=eq.${siteId}`,
        },
        () => {
          // Refresh when command status changes
          fetchCommands();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [siteId]);

  // Handle manual refresh
  function handleRefresh() {
    setRefreshing(true);
    fetchCommands();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-muted-foreground" />
              Command History
            </CardTitle>
            <CardDescription>
              Recent commands sent to this site
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="min-h-[44px] min-w-[44px]"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading command history...
          </div>
        ) : commands.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No commands have been sent to this site yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {commands.map((command) => {
              const typeInfo = formatCommandType(command.command_type);

              return (
                <div
                  key={command.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                >
                  {/* Left side: Command info */}
                  <div className="flex items-start gap-3">
                    {/* Command type icon */}
                    <div className={`p-2 rounded-md ${typeInfo.color}`}>
                      {typeInfo.icon}
                    </div>

                    {/* Command details */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{typeInfo.label}</span>
                        <span className="text-sm text-muted-foreground">
                          → {formatCommandValue(command.command_type, command.command_value)}
                        </span>
                      </div>

                      {/* Who and when */}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {command.users?.full_name || command.users?.email || "System"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatTimeAgo(command.created_at)}
                        </span>
                      </div>

                      {/* Error message if failed */}
                      {command.error_message && (
                        <p className="text-xs text-red-600">{command.error_message}</p>
                      )}
                    </div>
                  </div>

                  {/* Right side: Status badge */}
                  <StatusBadge status={command.status} />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
