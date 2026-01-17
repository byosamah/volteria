/**
 * API Route: Historical Data
 *
 * Fetches time-series data for the Historical Data visualization page.
 * Uses server-side aggregation RPC function for optimal performance.
 *
 * Query parameters:
 * - siteIds: Comma-separated site UUIDs (required)
 * - deviceIds: Comma-separated device UUIDs (required for device source)
 * - registers: Comma-separated register names (optional)
 * - start: ISO datetime string (required)
 * - end: ISO datetime string (required)
 * - source: "device" | "aggregate" | "both" (default: "device")
 * - aggregation: "auto" | "raw" | "hourly" | "daily" (default: "auto")
 *
 * Date Range Limits (enforced by RPC):
 * - Raw: max 7 days
 * - Hourly: max 90 days
 * - Daily: max 2 years
 *
 * Aggregation Auto-Selection:
 * - < 24h → raw
 * - 24h - 7d → hourly
 * - > 7d → daily
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Aggregation type
type AggregationType = "auto" | "raw" | "hourly" | "daily";

// Response types
interface DeviceReading {
  device_id: string;
  device_name: string;
  site_id: string;
  site_name: string;
  register_name: string;
  unit: string | null;
  data: { timestamp: string; value: number; min_value?: number; max_value?: number; sample_count?: number }[];
}

interface AggregateData {
  timestamp: string;
  total_load_kw: number | null;
  solar_output_kw: number | null;
  dg_power_kw: number | null;
  solar_limit_pct: number | null;
  safe_mode_active: boolean;
}

interface HistoricalDataResponse {
  deviceReadings: DeviceReading[];
  aggregateData: AggregateData[];
  metadata: {
    totalPoints: number;
    startTime: string;
    endTime: string;
    downsampled: boolean;
    aggregationType: AggregationType;
    originalCount?: number;
  };
}

// Helper to parse duration strings to milliseconds (for backward compatibility)
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(h|d)$/);
  if (!match) return 24 * 60 * 60 * 1000; // Default 24h

  const value = parseInt(match[1], 10);
  const unit = match[2];

  if (unit === "h") return value * 60 * 60 * 1000;
  if (unit === "d") return value * 24 * 60 * 60 * 1000;

  return 24 * 60 * 60 * 1000;
}

// Valid aggregation types
const VALID_AGGREGATIONS = ["auto", "raw", "hourly", "daily"] as const;

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get current user for access control
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const siteIdsParam = searchParams.get("siteIds") || searchParams.get("siteId"); // Support both
    const deviceIdsParam = searchParams.get("deviceIds");
    const registersParam = searchParams.get("registers");
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");
    const durationParam = searchParams.get("duration");
    const source = searchParams.get("source") || "device";
    const aggregationParam = (searchParams.get("aggregation") || "auto") as AggregationType;

    // Validate required parameters
    if (!siteIdsParam) {
      return NextResponse.json(
        { error: "siteIds is required" },
        { status: 400 }
      );
    }

    // Parse site IDs (comma-separated)
    const siteIds = siteIdsParam.split(",").filter((id) => id.trim());

    // Calculate time range
    let startTime: Date;
    let endTime: Date;

    if (startParam && endParam) {
      startTime = new Date(startParam);
      endTime = new Date(endParam);
    } else if (durationParam) {
      endTime = new Date();
      startTime = new Date(endTime.getTime() - parseDuration(durationParam));
    } else {
      // Default to last 24 hours
      endTime = new Date();
      startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
    }

    // Verify user has access to all sites via projects
    const { data: sitesData, error: sitesError } = await supabase
      .from("sites")
      .select("id, name, project_id")
      .in("id", siteIds);

    if (sitesError || !sitesData || sitesData.length === 0) {
      return NextResponse.json(
        { error: "Sites not found" },
        { status: 404 }
      );
    }

    // Check user profile for admin access
    const { data: userProfile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const isAdmin =
      userProfile?.role === "super_admin" ||
      userProfile?.role === "backend_admin";

    // Non-admin users must have project access to all sites
    if (!isAdmin) {
      const projectIds = [...new Set(sitesData.map((s) => s.project_id))];
      const { data: projectAccess } = await supabase
        .from("user_projects")
        .select("project_id")
        .eq("user_id", user.id)
        .in("project_id", projectIds);

      const accessibleProjects = new Set(projectAccess?.map((p) => p.project_id) || []);
      const hasAccessToAll = projectIds.every((pid) => accessibleProjects.has(pid));

      if (!hasAccessToAll) {
        return NextResponse.json(
          { error: "Access denied to one or more sites" },
          { status: 403 }
        );
      }
    }

    // Create site name lookup
    const siteNameMap: Record<string, string> = {};
    sitesData.forEach((s) => {
      siteNameMap[s.id] = s.name;
    });

    // Parse device IDs and registers
    const deviceIds = deviceIdsParam
      ? deviceIdsParam.split(",").filter((id) => id.trim())
      : [];
    const registers = registersParam
      ? registersParam.split(",").filter((r) => r.trim())
      : [];

    // Determine actual aggregation based on date range (for auto mode)
    const diffHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
    let actualAggregation: AggregationType = aggregationParam;
    if (aggregationParam === "auto") {
      if (diffHours <= 24) actualAggregation = "raw";
      else if (diffHours <= 168) actualAggregation = "hourly"; // 7 days
      else actualAggregation = "daily";
    }

    // Initialize response
    const response: HistoricalDataResponse = {
      deviceReadings: [],
      aggregateData: [],
      metadata: {
        totalPoints: 0,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        downsampled: actualAggregation !== "raw",
        aggregationType: actualAggregation,
      },
    };

    // Fetch device readings if requested
    if (
      (source === "device" || source === "both") &&
      deviceIds.length > 0
    ) {
      // Use RPC function for server-side aggregation
      const { data: readingsData, error: readingsError } = await supabase.rpc(
        "get_historical_readings",
        {
          p_site_ids: siteIds,
          p_device_ids: deviceIds,
          p_registers: registers.length > 0 ? registers : null,
          p_start: startTime.toISOString(),
          p_end: endTime.toISOString(),
          p_aggregation: actualAggregation === "auto" ? "auto" : actualAggregation,
        }
      );

      console.log("[historical API] RPC result:", readingsData?.length || 0, "readings, aggregation:", actualAggregation, "error:", readingsError?.message);

      if (!readingsError && readingsData && readingsData.length > 0) {
        // Fetch device names for mapping
        const { data: devicesData } = await supabase
          .from("site_devices")
          .select("id, name, site_id")
          .in("id", deviceIds);

        const deviceInfoMap: Record<string, { name: string; site_id: string }> = {};
        if (devicesData) {
          devicesData.forEach((d) => {
            deviceInfoMap[d.id] = { name: d.name, site_id: d.site_id };
          });
        }

        // Group readings by device and register
        const groupedReadings: Record<
          string,
          {
            device_id: string;
            device_name: string;
            site_id: string;
            site_name: string;
            register_name: string;
            unit: string | null;
            data: { timestamp: string; value: number; min_value?: number; max_value?: number; sample_count?: number }[];
          }
        > = {};

        for (const reading of readingsData) {
          const key = `${reading.device_id}:${reading.register_name}`;
          const deviceInfo = deviceInfoMap[reading.device_id];

          if (!groupedReadings[key]) {
            groupedReadings[key] = {
              device_id: reading.device_id,
              device_name: deviceInfo?.name || "Unknown",
              site_id: reading.site_id,
              site_name: siteNameMap[reading.site_id] || "Unknown",
              register_name: reading.register_name,
              unit: reading.unit,
              data: [],
            };
          }

          groupedReadings[key].data.push({
            timestamp: reading.bucket,
            value: reading.value,
            min_value: reading.min_value,
            max_value: reading.max_value,
            sample_count: reading.sample_count,
          });
        }

        response.deviceReadings = Object.values(groupedReadings);
        response.metadata.totalPoints += readingsData.length;
        console.log("[historical API] Grouped into", response.deviceReadings.length, "series with", response.metadata.totalPoints, "total points");
      }
    }

    // Fetch aggregate data if requested (from control_logs for backward compatibility)
    if (source === "aggregate" || source === "both") {
      const { data: logsData, error: logsError } = await supabase
        .from("control_logs")
        .select(
          "site_id, timestamp, total_load_kw, solar_output_kw, dg_power_kw, solar_limit_pct, safe_mode_active"
        )
        .in("site_id", siteIds)
        .gte("timestamp", startTime.toISOString())
        .lte("timestamp", endTime.toISOString())
        .order("timestamp", { ascending: true })
        .limit(10000); // Safety limit

      if (!logsError && logsData) {
        response.aggregateData = logsData.map((log) => ({
          timestamp: log.timestamp,
          total_load_kw: log.total_load_kw,
          solar_output_kw: log.solar_output_kw,
          dg_power_kw: log.dg_power_kw,
          solar_limit_pct: log.solar_limit_pct,
          safe_mode_active: log.safe_mode_active || false,
        }));
        response.metadata.totalPoints += logsData.length;
      }
    }

    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
