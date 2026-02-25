"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const POLL_INTERVAL_MS = 30_000;

function PowerGauge({ value, max, color }: { value: number; max: number; color: string }) {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="space-y-2">
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function formatOperationMode(mode: string | null): string {
  switch (mode) {
    case "zero_generator_feed":
    case "zero_dg_reverse":
      return "Zero Generator Feed";
    case "peak_shaving":
      return "Peak Shaving";
    case "manual":
      return "Manual Control";
    default:
      return mode || "Not set";
  }
}

interface PowerStatsLiveProps {
  siteId: string;
  initialLoadKw: number;
  initialSolarKw: number;
  initialDgKw: number;
  initialSolarLimitPct: number;
  initialSafeModeActive: boolean;
  dgReserveKw: number;
  operationMode: string | null;
  totalCapacity: number;
}

export function PowerStatsLive({
  siteId,
  initialLoadKw,
  initialSolarKw,
  initialDgKw,
  initialSolarLimitPct,
  initialSafeModeActive,
  dgReserveKw,
  operationMode,
  totalCapacity,
}: PowerStatsLiveProps) {
  const [loadKw, setLoadKw] = useState(initialLoadKw);
  const [solarKw, setSolarKw] = useState(initialSolarKw);
  const [dgKw, setDgKw] = useState(initialDgKw);
  const [solarLimitPct, setSolarLimitPct] = useState(initialSolarLimitPct);
  const [safeModeActive, setSafeModeActive] = useState(initialSafeModeActive);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboards/${siteId}/live-data`);
      if (!res.ok) return;
      const data = await res.json();
      const agg = data.site_aggregates;
      if (!agg) return;
      if (agg.total_load_kw) setLoadKw(agg.total_load_kw.value);
      if (agg.solar_output_kw) setSolarKw(agg.solar_output_kw.value);
      if (agg.dg_power_kw) setDgKw(agg.dg_power_kw.value);
      if (agg.solar_limit_pct) setSolarLimitPct(agg.solar_limit_pct.value);
      if (agg.safe_mode_active) setSafeModeActive(agg.safe_mode_active.value === 1);
    } catch {
      // Silent fail — stale data is acceptable for "nice to have"
    }
  }, [siteId]);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (!intervalId) {
        intervalId = setInterval(fetchData, POLL_INTERVAL_MS);
      }
    };

    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        fetchData(); // Fetch immediately when tab becomes visible
        start();
      }
    };

    start();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchData]);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Total Load</CardDescription>
          <CardTitle className="text-3xl">
            {loadKw.toFixed(1)} <span className="text-lg font-normal">kW</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PowerGauge value={loadKw} max={totalCapacity} color="bg-blue-500" />
        </CardContent>
      </Card>

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
            <span className="font-medium">{solarLimitPct}%</span>
          </div>
          <PowerGauge value={solarKw} max={150} color="bg-[#6baf4f]" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Generator Power</CardDescription>
          <CardTitle className={`text-3xl ${
            dgKw < 0
              ? "text-red-600"
              : dgKw < dgReserveKw
                ? "text-orange-500"
                : ""
          }`}>
            {dgKw.toFixed(1)} <span className="text-lg font-normal">kW</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PowerGauge
            value={Math.abs(dgKw)}
            max={totalCapacity}
            color={dgKw < 0 ? "bg-red-500" : dgKw < dgReserveKw ? "bg-orange-500" : "bg-slate-500"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Generator Reserve</CardDescription>
          <CardTitle className="text-3xl">
            {dgReserveKw} <span className="text-lg font-normal">kW</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            {safeModeActive ? (
              <Badge variant="destructive">Safe Mode Active</Badge>
            ) : (
              <Badge variant="outline">{formatOperationMode(operationMode)}</Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
