"use client";

/**
 * Live Power Display Component
 *
 * Shows real-time power data with auto-refresh:
 * - Total Load
 * - DG Power
 * - Solar Output
 * - Solar Limit
 * - Safe Mode Status
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface LiveData {
  timestamp: string;
  total_load_kw: number;
  dg_power_kw: number;
  solar_output_kw: number;
  solar_limit_pct: number;
  safe_mode_active: boolean;
}

interface LivePowerDisplayProps {
  projectId: string;
  dgReserveKw: number;
}

// Power gauge component
function PowerGauge({
  label,
  value,
  max,
  unit = "kW",
  color = "bg-primary",
}: {
  label: string;
  value: number;
  max: number;
  unit?: string;
  color?: string;
}) {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {value.toFixed(1)} {unit}
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export function LivePowerDisplay({ projectId, dgReserveKw }: LivePowerDisplayProps) {
  const supabase = createClient();
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isStale, setIsStale] = useState(false);

  // Fetch latest data and subscribe to updates
  useEffect(() => {
    const fetchLatest = async () => {
      const { data, error } = await supabase
        .from("control_logs")
        .select("timestamp, total_load_kw, dg_power_kw, solar_output_kw, solar_limit_pct, safe_mode_active")
        .eq("project_id", projectId)
        .order("timestamp", { ascending: false })
        .limit(1)
        .single();

      if (!error && data) {
        setLiveData(data);
        setLastUpdate(new Date());
      }
    };

    fetchLatest();

    // Subscribe to realtime updates
    const channel = supabase
      .channel(`live_power:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "control_logs",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          setLiveData(payload.new as LiveData);
          setLastUpdate(new Date());
          setIsStale(false);
        }
      )
      .subscribe();

    // Check for stale data every 10 seconds
    const staleCheck = setInterval(() => {
      if (lastUpdate) {
        const secondsSinceUpdate = (Date.now() - lastUpdate.getTime()) / 1000;
        setIsStale(secondsSinceUpdate > 30);
      }
    }, 10000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(staleCheck);
    };
  }, [projectId, supabase, lastUpdate]);

  // Calculate derived values
  const loadKw = liveData?.total_load_kw || 0;
  const solarKw = liveData?.solar_output_kw || 0;
  const dgKw = liveData?.dg_power_kw || 0;
  const solarLimitPct = liveData?.solar_limit_pct || 0;
  const safeMode = liveData?.safe_mode_active || false;

  // Calculate max values for gauges (assuming some reasonable maximums)
  const maxLoad = 500; // TODO: Get from project config
  const maxSolar = 150; // TODO: Get from device config
  const maxDg = 500;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Total Load */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardDescription>Total Load</CardDescription>
            {isStale && (
              <Badge variant="outline" className="text-yellow-600">
                Stale
              </Badge>
            )}
          </div>
          <CardTitle className="text-3xl">
            {loadKw.toFixed(1)} <span className="text-lg font-normal">kW</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PowerGauge label="" value={loadKw} max={maxLoad} color="bg-blue-500" />
        </CardContent>
      </Card>

      {/* Solar Output */}
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Solar Output</CardDescription>
          <CardTitle className="text-3xl">
            {solarKw.toFixed(1)} <span className="text-lg font-normal">kW</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-muted-foreground">Limit</span>
            <span className="font-medium">{solarLimitPct.toFixed(0)}%</span>
          </div>
          <PowerGauge label="" value={solarKw} max={maxSolar} color="bg-amber-500" />
        </CardContent>
      </Card>

      {/* DG Power */}
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>DG Power</CardDescription>
          <CardTitle className="text-3xl">
            {dgKw.toFixed(1)} <span className="text-lg font-normal">kW</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PowerGauge label="" value={dgKw} max={maxDg} color="bg-slate-500" />
        </CardContent>
      </Card>

      {/* DG Reserve & Status */}
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>DG Reserve</CardDescription>
          <CardTitle className="text-3xl">
            {dgReserveKw} <span className="text-lg font-normal">kW</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            {safeMode ? (
              <Badge variant="destructive">Safe Mode Active</Badge>
            ) : (
              <Badge variant="outline">Normal Operation</Badge>
            )}
          </div>
          {lastUpdate && (
            <p className="text-xs text-muted-foreground mt-2">
              Updated: {lastUpdate.toLocaleTimeString()}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
