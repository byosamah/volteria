/**
 * API Route: Site Operations
 *
 * DELETE /api/sites/[siteId] - Soft delete a site
 * Calls backend which uses service_role to bypass RLS.
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await params;
    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get auth token for backend
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return NextResponse.json(
        { error: "No session" },
        { status: 401 }
      );
    }

    // Call backend to delete site (soft delete)
    const backendResponse = await fetch(
      `${BACKEND_URL}/api/sites/${siteId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }
    );

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error("Backend site delete failed:", errorText);
      return NextResponse.json(
        { error: errorText || "Failed to delete site" },
        { status: backendResponse.status }
      );
    }

    // 204 No Content on success
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Site delete error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
