/**
 * API Route: Controller Heartbeats
 *
 * Returns the latest heartbeat timestamp for each controller.
 * Used by the Controller Master List to poll for connection status updates.
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = await createClient();

    // Fetch recent heartbeats ordered by timestamp (newest first)
    // Limit to 500 records - enough to cover all controllers with recent activity
    // This prevents slow queries when the table has many historical records
    const { data: heartbeatData, error } = await supabase
      .from("controller_heartbeats")
      .select("controller_id, timestamp")
      .not("controller_id", "is", null)
      .order("timestamp", { ascending: false })
      .limit(500);

    if (error) {
      console.error("Heartbeats query error:", error);
      return NextResponse.json({ error: "Failed to fetch heartbeats" }, { status: 500 });
    }

    if (!heartbeatData) {
      return NextResponse.json({});
    }

    // Build map: controller_id -> latest heartbeat timestamp
    // Since results are ordered by timestamp DESC, first occurrence is the latest
    const heartbeatMap: Record<string, string> = {};
    for (const hb of heartbeatData) {
      if (hb.controller_id && !heartbeatMap[hb.controller_id]) {
        heartbeatMap[hb.controller_id] = hb.timestamp;
      }
    }

    return NextResponse.json(heartbeatMap);
  } catch {
    return NextResponse.json({});
  }
}
