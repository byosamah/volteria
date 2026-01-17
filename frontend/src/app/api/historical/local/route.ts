/**
 * API Route: Local Historical Data
 *
 * Proxies historical data requests to the controller's local SQLite database
 * via the backend SSH endpoint.
 *
 * Query parameters (same as cloud route):
 * - siteIds: Comma-separated site UUIDs (required, but only first is used for local)
 * - deviceIds: Comma-separated device UUIDs
 * - registers: Comma-separated register names
 * - start: ISO datetime string (required)
 * - end: ISO datetime string (required)
 *
 * Max range: 7 days (enforced by UI, validated here)
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Max 7 days for local data source
const MAX_LOCAL_DAYS = 7;

interface DeviceReading {
  device_id: string;
  device_name: string;
  site_id: string;
  site_name: string;
  register_name: string;
  unit: string | null;
  data: { timestamp: string; value: number }[];
}

interface HistoricalDataResponse {
  deviceReadings: DeviceReading[];
  aggregateData: never[];
  metadata: {
    totalPoints: number;
    startTime: string;
    endTime: string;
    downsampled: boolean;
    source: string;
  };
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
    const siteIdsParam = searchParams.get("siteIds") || searchParams.get("siteId");
    const deviceIdsParam = searchParams.get("deviceIds");
    const registersParam = searchParams.get("registers");
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");
    const aggregationParam = searchParams.get("aggregation") || "raw";

    // Validate required parameters
    if (!siteIdsParam || !startParam || !endParam) {
      return NextResponse.json(
        { error: "siteIds, start, and end are required" },
        { status: 400 }
      );
    }

    // For local data, we only support one site at a time (single controller)
    const siteIds = siteIdsParam.split(",").filter((id) => id.trim());
    if (siteIds.length !== 1) {
      return NextResponse.json(
        { error: "Local data source only supports one site at a time" },
        { status: 400 }
      );
    }
    const siteId = siteIds[0];

    // Validate date range (max 7 days)
    const startTime = new Date(startParam);
    const endTime = new Date(endParam);
    const diffDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays > MAX_LOCAL_DAYS) {
      return NextResponse.json(
        { error: `Local data source limited to ${MAX_LOCAL_DAYS} days. Use cloud data for longer ranges.` },
        { status: 400 }
      );
    }

    // Get site info and verify access
    const { data: siteData, error: siteError } = await supabase
      .from("sites")
      .select("id, name, project_id, controller_serial_number")
      .eq("id", siteId)
      .single();

    if (siteError || !siteData) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    // Check user has access to the project
    const { data: userProfile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const isAdmin =
      userProfile?.role === "super_admin" ||
      userProfile?.role === "backend_admin";

    if (!isAdmin) {
      const { data: projectAccess } = await supabase
        .from("user_projects")
        .select("project_id")
        .eq("user_id", user.id)
        .eq("project_id", siteData.project_id);

      if (!projectAccess || projectAccess.length === 0) {
        return NextResponse.json(
          { error: "Access denied to this site" },
          { status: 403 }
        );
      }
    }

    // Find the controller for this site (by site_id in controllers table)
    let controllerData: { id: string; serial_number: string; status: string } | null = null;

    // First try: look by site_id directly
    const { data: controllerBySite } = await supabase
      .from("controllers")
      .select("id, serial_number, status")
      .eq("site_id", siteId)
      .single();

    if (controllerBySite) {
      controllerData = controllerBySite;
    } else if (siteData.controller_serial_number) {
      // Second try: look by serial number in site settings
      const { data: controllerBySerial } = await supabase
        .from("controllers")
        .select("id, serial_number, status")
        .eq("serial_number", siteData.controller_serial_number)
        .single();

      if (controllerBySerial) {
        controllerData = controllerBySerial;
      }
    }

    if (!controllerData) {
      return NextResponse.json(
        { error: "No controller found for this site. Local data requires an assigned controller." },
        { status: 404 }
      );
    }

    if (controllerData.status !== "deployed" && controllerData.status !== "ready") {
      return NextResponse.json(
        { error: `Controller is not deployed (status: ${controllerData.status})` },
        { status: 400 }
      );
    }

    // Get device info for mapping device names
    const deviceIds = deviceIdsParam
      ? deviceIdsParam.split(",").filter((id) => id.trim())
      : [];

    const { data: devicesData } = await supabase
      .from("site_devices")
      .select("id, name, site_id")
      .eq("site_id", siteId);

    const deviceInfoMap: Record<string, { name: string; site_id: string }> = {};
    if (devicesData) {
      devicesData.forEach((d) => {
        deviceInfoMap[d.id] = { name: d.name, site_id: d.site_id };
      });
    }

    // Call backend endpoint to query local data via SSH
    const backendUrl = process.env.BACKEND_URL || "http://backend:8000";
    const registers = registersParam
      ? registersParam.split(",").filter((r) => r.trim())
      : [];

    const backendResponse = await fetch(
      `${backendUrl}/api/controllers/${controllerData.id}/historical/query`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Pass service key for backend auth (backend will verify)
          "X-Service-Key": process.env.SUPABASE_SERVICE_KEY || "",
        },
        body: JSON.stringify({
          site_id: siteId,
          device_ids: deviceIds.length > 0 ? deviceIds : null,
          registers: registers.length > 0 ? registers : null,
          start: startTime.toISOString(),
          end: endTime.toISOString(),
          aggregation: aggregationParam,
        }),
      }
    );

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error("[local historical API] Backend error:", errorText);
      return NextResponse.json(
        { error: `Backend error: ${backendResponse.status}` },
        { status: backendResponse.status }
      );
    }

    const backendData = await backendResponse.json();

    if (!backendData.success) {
      return NextResponse.json(
        { error: backendData.error || "Failed to query local data" },
        { status: 500 }
      );
    }

    // Transform backend response to match cloud API format
    const deviceReadings: DeviceReading[] = (backendData.deviceReadings || []).map(
      (reading: { device_id: string; register_name: string; unit: string | null; data: { timestamp: string; value: number }[] }) => ({
        device_id: reading.device_id,
        device_name: deviceInfoMap[reading.device_id]?.name || "Unknown",
        site_id: siteId,
        site_name: siteData.name,
        register_name: reading.register_name,
        unit: reading.unit,
        data: reading.data,
      })
    );

    const response: HistoricalDataResponse = {
      deviceReadings,
      aggregateData: [],
      metadata: {
        totalPoints: backendData.metadata?.totalPoints || 0,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        downsampled: false,
        source: "local",
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[local historical API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
