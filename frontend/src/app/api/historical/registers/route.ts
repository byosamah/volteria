/**
 * API Route: Historical Register Names
 *
 * Fetches unique register names that have historical data for given device IDs.
 * Used to show "Historical" registers in the UI - registers that have data
 * in the database but are no longer in the device's current configuration.
 *
 * Query parameters:
 * - deviceIds: Comma-separated device UUIDs (required)
 * - days: Number of days to look back (optional, default: 90)
 *
 * Returns:
 * - registers: Array of { deviceId, registerNames: string[] }
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

interface DeviceRegisters {
  deviceId: string;
  registerNames: string[];
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
    const deviceIdsParam = searchParams.get("deviceIds");
    const daysParam = searchParams.get("days");

    if (!deviceIdsParam) {
      return NextResponse.json(
        { error: "deviceIds is required" },
        { status: 400 }
      );
    }

    // Parse device IDs
    const deviceIds = deviceIdsParam.split(",").filter((id) => id.trim());
    if (deviceIds.length === 0) {
      return NextResponse.json(
        { error: "At least one deviceId is required" },
        { status: 400 }
      );
    }

    // Calculate date range (default: last 90 days)
    const days = parseInt(daysParam || "90", 10);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Query unique register names per device from device_readings
    // This uses a simple approach: select distinct device_id, register_name
    const { data: readingsData, error: readingsError } = await supabase
      .from("device_readings")
      .select("device_id, register_name")
      .in("device_id", deviceIds)
      .gte("timestamp", startDate.toISOString());

    if (readingsError) {
      console.error("[historical/registers] Query error:", readingsError.message);
      return NextResponse.json(
        { error: "Failed to fetch historical registers" },
        { status: 500 }
      );
    }

    // Group unique register names by device
    const deviceRegisterMap = new Map<string, Set<string>>();

    for (const row of readingsData || []) {
      if (!deviceRegisterMap.has(row.device_id)) {
        deviceRegisterMap.set(row.device_id, new Set());
      }
      deviceRegisterMap.get(row.device_id)!.add(row.register_name);
    }

    // Convert to response format
    const registers: DeviceRegisters[] = [];
    for (const deviceId of deviceIds) {
      const registerNames = deviceRegisterMap.get(deviceId);
      registers.push({
        deviceId,
        registerNames: registerNames ? Array.from(registerNames).sort() : [],
      });
    }

    return NextResponse.json(
      { registers },
      {
        headers: {
          'Cache-Control': 'private, max-age=60', // Cache for 1 minute
        },
      }
    );
  } catch (error) {
    console.error("[historical/registers] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
