"use client";

/**
 * Control Logs Table Component
 *
 * Displays control log history with:
 * - Timestamp
 * - Load, DG, Solar power values
 * - Solar limit percentage
 * - Safe mode status
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";

interface ControlLog {
  id: number;
  timestamp: string;
  total_load_kw: number;
  dg_power_kw: number;
  solar_output_kw: number;
  solar_limit_pct: number;
  safe_mode_active: boolean;
}

interface ControlLogsTableProps {
  projectId: string;
  limit?: number;
}

export function ControlLogsTable({ projectId, limit = 20 }: ControlLogsTableProps) {
  const supabase = createClient();
  const [logs, setLogs] = useState<ControlLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch logs on mount and subscribe to realtime updates
  useEffect(() => {
    const fetchLogs = async () => {
      const { data, error } = await supabase
        .from("control_logs")
        .select("id, timestamp, total_load_kw, dg_power_kw, solar_output_kw, solar_limit_pct, safe_mode_active")
        .eq("project_id", projectId)
        .order("timestamp", { ascending: false })
        .limit(limit);

      if (!error && data) {
        setLogs(data);
      }
      setLoading(false);
    };

    fetchLogs();

    // Subscribe to realtime updates
    const channel = supabase
      .channel(`control_logs:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "control_logs",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          setLogs((prev) => {
            const newLogs = [payload.new as ControlLog, ...prev];
            return newLogs.slice(0, limit);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, limit, supabase]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No control logs yet. Logs will appear when the controller starts running.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-3 px-4 font-medium">Time</th>
            <th className="text-right py-3 px-4 font-medium">Load (kW)</th>
            <th className="text-right py-3 px-4 font-medium">Generator (kW)</th>
            <th className="text-right py-3 px-4 font-medium">Solar (kW)</th>
            <th className="text-right py-3 px-4 font-medium">Limit (%)</th>
            <th className="text-center py-3 px-4 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b hover:bg-muted/50">
              <td className="py-3 px-4 text-muted-foreground">
                {new Date(log.timestamp).toLocaleString()}
              </td>
              <td className="py-3 px-4 text-right font-mono">
                {log.total_load_kw.toFixed(1)}
              </td>
              <td className="py-3 px-4 text-right font-mono">
                {log.dg_power_kw.toFixed(1)}
              </td>
              <td className="py-3 px-4 text-right font-mono text-amber-600">
                {log.solar_output_kw.toFixed(1)}
              </td>
              <td className="py-3 px-4 text-right font-mono">
                {log.solar_limit_pct.toFixed(0)}%
              </td>
              <td className="py-3 px-4 text-center">
                {log.safe_mode_active ? (
                  <Badge variant="destructive">Safe Mode</Badge>
                ) : (
                  <Badge variant="outline">Normal</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
