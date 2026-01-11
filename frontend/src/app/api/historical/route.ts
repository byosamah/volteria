/**
 * API Route: Historical Data
 *
 * Fetches time-series data for the Historical Data visualization page.
 * Supports:
 * - Device readings from device_readings table (per-device data)
 * - Aggregate readings from control_logs table (backward compatibility)
 * - Date range filtering with downsampling for large datasets
 *
 * Query parameters:
 * - siteId: UUID of the site (required)
 * - deviceIds: Comma-separated device UUIDs (optional, for device_readings)
 * - registers: Comma-separated register names (optional)
 * - start: ISO datetime string (required)
 * - end: ISO datetime string (required)
 * - source: "device" | "aggregate" | "both" (default: "both")
 * - limit: Max number of points per device (default: 5000)
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Response types
interface DeviceReading {
  device_id: string;
  device_name: string;
  register_name: string;
  unit: string | null;
  data: { timestamp: string; value: number }[];
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
    originalCount?: number;
  };
}

// Helper to parse duration strings to milliseconds
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(h|d)$/);
  if (!match) return 24 * 60 * 60 * 1000; // Default 24h

  const value = parseInt(match[1], 10);
  const unit = match[2];

  if (unit === "h") return value * 60 * 60 * 1000;
  if (unit === "d") return value * 24 * 60 * 60 * 1000;

  return 24 * 60 * 60 * 1000;
}

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
    const siteId = searchParams.get("siteId");
    const deviceIdsParam = searchParams.get("deviceIds");
    const registersParam = searchParams.get("registers");
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");
    const durationParam = searchParams.get("duration");
    const source = searchParams.get("source") || "both";
    const limit = parseInt(searchParams.get("limit") || "5000", 10);

    // Validate required parameters
    if (!siteId) {
      return NextResponse.json(
        { error: "siteId is required" },
        { status: 400 }
      );
    }

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

    // Verify user has access to this site via project
    const { data: siteData, error: siteError } = await supabase
      .from("sites")
      .select("id, project_id")
      .eq("id", siteId)
      .single();

    if (siteError || !siteData) {
      return NextResponse.json(
        { error: "Site not found" },
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

    // Non-admin users must have project access
    if (!isAdmin) {
      const { data: projectAccess } = await supabase
        .from("user_projects")
        .select("project_id")
        .eq("user_id", user.id)
        .eq("project_id", siteData.project_id)
        .single();

      if (!projectAccess) {
        return NextResponse.json(
          { error: "Access denied to this site" },
          { status: 403 }
        );
      }
    }

    // Parse device IDs and registers
    const deviceIds = deviceIdsParam
      ? deviceIdsParam.split(",").filter((id) => id.trim())
      : [];
    const registers = registersParam
      ? registersParam.split(",").filter((r) => r.trim())
      : [];

    // Initialize response
    const response: HistoricalDataResponse = {
      deviceReadings: [],
      aggregateData: [],
      metadata: {
        totalPoints: 0,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        downsampled: false,
      },
    };

    // Fetch device readings if requested
    if (
      (source === "device" || source === "both") &&
      deviceIds.length > 0
    ) {
      // Build query for device readings
      let query = supabase
        .from("device_readings")
        .select("device_id, register_name, value, unit, timestamp")
        .eq("site_id", siteId)
        .in("device_id", deviceIds)
        .gte("timestamp", startTime.toISOString())
        .lte("timestamp", endTime.toISOString())
        .order("timestamp", { ascending: true });

      // Filter by registers if specified
      if (registers.length > 0) {
        query = query.in("register_name", registers);
      }

      // Apply limit
      query = query.limit(limit * deviceIds.length);

      const { data: readingsData, error: readingsError } = await query;

      if (!readingsError && readingsData && readingsData.length > 0) {
        // Fetch device names for mapping
        const { data: devicesData } = await supabase
          .from("site_devices")
          .select("id, name")
          .in("id", deviceIds);

        const deviceNameMap: Record<string, string> = {};
        if (devicesData) {
          devicesData.forEach((d) => {
            deviceNameMap[d.id] = d.name;
          });
        }

        // Group readings by device and register
        const groupedReadings: Record<
          string,
          {
            device_id: string;
            device_name: string;
            register_name: string;
            unit: string | null;
            data: { timestamp: string; value: number }[];
          }
        > = {};

        for (const reading of readingsData) {
          const key = `${reading.device_id}:${reading.register_name}`;

          if (!groupedReadings[key]) {
            groupedReadings[key] = {
              device_id: reading.device_id,
              device_name: deviceNameMap[reading.device_id] || "Unknown",
              register_name: reading.register_name,
              unit: reading.unit,
              data: [],
            };
          }

          groupedReadings[key].data.push({
            timestamp: reading.timestamp,
            value: reading.value,
          });
        }

        response.deviceReadings = Object.values(groupedReadings);
        response.metadata.totalPoints += readingsData.length;

        // Check if we hit the limit (indicates downsampling may be needed)
        if (readingsData.length >= limit * deviceIds.length) {
          response.metadata.downsampled = true;
        }
      }
    }

    // Fetch aggregate data if requested
    if (source === "aggregate" || source === "both") {
      const { data: logsData, error: logsError } = await supabase
        .from("control_logs")
        .select(
          "timestamp, total_load_kw, solar_output_kw, dg_power_kw, solar_limit_pct, safe_mode_active"
        )
        .eq("site_id", siteId)
        .gte("timestamp", startTime.toISOString())
        .lte("timestamp", endTime.toISOString())
        .order("timestamp", { ascending: true })
        .limit(limit);

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

        if (logsData.length >= limit) {
          response.metadata.downsampled = true;
        }
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
