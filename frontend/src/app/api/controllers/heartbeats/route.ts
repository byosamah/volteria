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

    // Fetch all heartbeats ordered by timestamp (newest first)
    const { data: heartbeatData, error } = await supabase
      .from("controller_heartbeats")
      .select("controller_id, timestamp")
      .not("controller_id", "is", null)
      .order("timestamp", { ascending: false });

    if (error) {
      return NextResponse.json({});
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
