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
 * - registers: Array of { deviceId, registers: RegisterInfo[] }
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

interface RegisterInfo {
  name: string;
  firstSeen: string;  // ISO timestamp
  lastSeen: string;   // ISO timestamp
}

interface DeviceRegisters {
  deviceId: string;
  registers: RegisterInfo[];
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

    // Query unique register names per device using RPC (database-level DISTINCT)
    // This avoids PostgREST's default 1000-row limit which truncated results
    const { data: readingsData, error: readingsError } = await supabase.rpc(
      "get_distinct_register_names",
      {
        p_device_ids: deviceIds,
        p_since: startDate.toISOString(),
      }
    );

    if (readingsError) {
      console.error("[historical/registers] RPC error:", readingsError.message);
      return NextResponse.json(
        { error: "Failed to fetch historical registers" },
        { status: 500 }
      );
    }

    // Group registers by device with timestamps (already distinct from DB)
    const deviceRegisterMap = new Map<string, RegisterInfo[]>();

    for (const row of readingsData || []) {
      if (!deviceRegisterMap.has(row.device_id)) {
        deviceRegisterMap.set(row.device_id, []);
      }
      deviceRegisterMap.get(row.device_id)!.push({
        name: row.register_name,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
      });
    }

    // Convert to response format
    const registers: DeviceRegisters[] = [];
    for (const deviceId of deviceIds) {
      registers.push({
        deviceId,
        registers: deviceRegisterMap.get(deviceId) || [],
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
