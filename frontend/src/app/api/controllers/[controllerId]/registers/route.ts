/**
 * Controller Registers API Route
 *
 * Proxies register read/write requests to the backend API.
 * Handles authentication and forwards requests to the FastAPI backend.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const BACKEND_URL = process.env.NODE_ENV === "production"
  ? "http://sdc-backend:8000"
  : "http://localhost:8000";

interface ReadRequest {
  device_id: string;
  addresses: number[];
}

interface WriteRequest {
  device_id: string;
  address: number;
  value: number;
  verify?: boolean;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ controllerId: string }> }
) {
  try {
    const { controllerId } = await params;
    const supabase = await createClient();

    // Get current user session for auth
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { action, ...data } = body as { action: "read" | "write" } & (ReadRequest | WriteRequest);

    if (!action || !["read", "write"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Must be 'read' or 'write'" },
        { status: 400 }
      );
    }

    // Build backend URL
    const endpoint = action === "read" ? "read" : "write";
    const backendUrl = `${BACKEND_URL}/api/controllers/${controllerId}/registers/${endpoint}`;

    // Forward request to backend
    const backendResponse = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(data),
    });

    // Parse backend response
    const result = await backendResponse.json();

    // Return response with same status code
    return NextResponse.json(result, { status: backendResponse.status });
  } catch (error) {
    console.error("Register API error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 }
    );
  }
}
