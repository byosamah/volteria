"use client";

/**
 * Alarms Table Component
 *
 * Interactive table with:
 * - Real-time updates
 * - Acknowledge functionality
 * - Filtering
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Alarm {
  id: string;
  project_id: string;
  alarm_type: string;
  device_name: string | null;
  message: string;
  severity: string;
  acknowledged: boolean;
  acknowledged_by: string | null;
  created_at: string;
}

export function AlarmsTable() {
  const supabase = createClient();
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unacknowledged">("unacknowledged");

  // Fetch alarms
  const fetchAlarms = async () => {
    let query = supabase
      .from("alarms")
      .select("id, project_id, alarm_type, device_name, message, severity, acknowledged, acknowledged_by, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (filter === "unacknowledged") {
      query = query.eq("acknowledged", false);
    }

    const { data, error } = await query;

    if (!error && data) {
      // Cast data to the expected type (Supabase returns the relation as an object)
      setAlarms(data as unknown as Alarm[]);
    }
    setLoading(false);
  };

  // Fetch on mount and when filter changes
  useEffect(() => {
    fetchAlarms();

    // Subscribe to realtime updates
    const channel = supabase
      .channel("alarms_updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "alarms",
        },
        () => {
          // Refetch on any change
          fetchAlarms();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [filter]);

  // Acknowledge alarm
  const handleAcknowledge = async (alarmId: string) => {
    const { error } = await supabase
      .from("alarms")
      .update({ acknowledged: true })
      .eq("id", alarmId);

    if (error) {
      toast.error("Failed to acknowledge alarm");
    } else {
      toast.success("Alarm acknowledged");
      // Update local state
      setAlarms((prev) =>
        prev.map((a) =>
          a.id === alarmId ? { ...a, acknowledged: true } : a
        )
      );
    }
  };

  // Severity badge
  const SeverityBadge = ({ severity }: { severity: string }) => {
    const variants: Record<string, "destructive" | "default" | "secondary"> = {
      critical: "destructive",
      warning: "default",
      info: "secondary",
    };

    return (
      <Badge variant={variants[severity] || "secondary"} className="capitalize">
        {severity}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex gap-2">
        <Button
          variant={filter === "unacknowledged" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("unacknowledged")}
        >
          Unacknowledged
        </Button>
        <Button
          variant={filter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("all")}
        >
          All
        </Button>
      </div>

      {/* Table */}
      {alarms.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          {filter === "unacknowledged"
            ? "No unacknowledged alarms"
            : "No alarms recorded yet"}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 font-medium">Time</th>
                <th className="text-left py-3 px-4 font-medium">Type</th>
                <th className="text-left py-3 px-4 font-medium">Message</th>
                <th className="text-center py-3 px-4 font-medium">Severity</th>
                <th className="text-center py-3 px-4 font-medium">Status</th>
                <th className="text-right py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {alarms.map((alarm) => (
                <tr
                  key={alarm.id}
                  className={`border-b hover:bg-muted/50 ${
                    alarm.severity === "critical" && !alarm.acknowledged
                      ? "bg-red-50"
                      : ""
                  }`}
                >
                  <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                    {new Date(alarm.created_at).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs">
                    {alarm.alarm_type.replace(/_/g, " ")}
                    {alarm.device_name && (
                      <span className="text-muted-foreground ml-1">
                        ({alarm.device_name})
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 max-w-xs truncate">
                    {alarm.message}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <SeverityBadge severity={alarm.severity} />
                  </td>
                  <td className="py-3 px-4 text-center">
                    {alarm.acknowledged ? (
                      <Badge variant="outline">Acknowledged</Badge>
                    ) : (
                      <Badge variant="secondary">Active</Badge>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {!alarm.acknowledged && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleAcknowledge(alarm.id)}
                      >
                        Acknowledge
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
