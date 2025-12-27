import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/devices/templates/[templateId]/duplicate
 *
 * Proxy to backend API for duplicating a device template.
 * Creates a custom template based on an existing template.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const { templateId } = await params;
    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { detail: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get request body
    const body = await request.json();

    // Build backend URL
    const backendUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(
      ".supabase.co",
      ""
    );

    // Call backend API
    const response = await fetch(
      `${process.env.BACKEND_URL || "http://backend:8000"}/api/devices/templates/${templateId}/duplicate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: request.headers.get("Authorization") || "",
        },
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error duplicating template:", error);
    return NextResponse.json(
      { detail: "Failed to duplicate template" },
      { status: 500 }
    );
  }
}
