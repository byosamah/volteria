import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/controllers/[controllerId]/reboot
 *
 * Proxy to backend API which executes SSH reboot on the controller.
 * The backend connects via the controller's reverse SSH tunnel and executes 'sudo reboot'.
 *
 * Authentication options (one required):
 * 1. User JWT token (standard auth via session)
 * 2. controller_secret in request body (matches controller's SSH password)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ controllerId: string }> }
) {
  const { controllerId } = await params;

  try {
    // Parse request body for optional controller_secret
    let body: { controller_secret?: string } = {};
    try {
      body = await request.json();
    } catch {
      // No body or invalid JSON is fine
    }

    // Get the session from Supabase (optional now)
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();

    // Build headers - include auth token if we have a session
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }

    // Call backend API which handles SSH reboot
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://backend:8000";
    const response = await fetch(`${backendUrl}/api/controllers/${controllerId}/reboot`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || data.error || "Failed to reboot controller" },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Reboot API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
