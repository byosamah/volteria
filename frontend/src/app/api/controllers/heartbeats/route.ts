/**
 * API Route: Controller Heartbeats
 *
 * Returns the latest heartbeat timestamp for each controller.
 * Used by the Controller Master List to poll for connection status updates.
 *
 * Uses service key to bypass RLS since:
 * 1. Heartbeat data is not sensitive (just timestamps)
 * 2. This is a polling endpoint that needs to be reliable
 * 3. The page itself is already protected by auth middleware
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Use service key to bypass RLS for reliable polling
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase credentials");
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
