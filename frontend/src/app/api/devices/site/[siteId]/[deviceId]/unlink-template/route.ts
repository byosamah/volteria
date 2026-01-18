/**
 * API Route: Unlink Device Template
 *
 * Removes the template link from a device.
 * - Removes all registers with source:"template"
 * - Keeps all registers with source:"manual"
 * - Sets template_id to NULL
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string; deviceId: string }> }
) {
  try {
    const { siteId, deviceId } = await params;
    const supabase = await createClient();

    // Get current user for auth
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get auth token for backend
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return NextResponse.json({ error: "No session" }, { status: 401 });
    }

    // Proxy to backend
    const response = await fetch(
      `${BACKEND_URL}/api/devices/site/${siteId}/${deviceId}/unlink-template`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: error || "Failed to unlink template" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Unlink template error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
