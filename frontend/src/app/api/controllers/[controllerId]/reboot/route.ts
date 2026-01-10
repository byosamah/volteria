import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/controllers/[controllerId]/reboot
 *
 * Proxy to backend API which executes SSH reboot on the controller.
 * The backend connects via the controller's reverse SSH tunnel and executes 'sudo reboot'.
 *
 * Requires:
 * - User to be authenticated
 * - User to have access to the site where the controller is assigned
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ controllerId: string }> }
) {
  const { controllerId } = await params;

  try {
    // Get the session from Supabase
    const supabase = await createClient();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Call backend API which handles SSH reboot
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://backend:8000";
    const response = await fetch(`${backendUrl}/api/controllers/${controllerId}/reboot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
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
