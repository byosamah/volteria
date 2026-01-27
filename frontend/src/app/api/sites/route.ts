/**
 * API Route: Create Site
 *
 * POST /api/sites - Create a new site
 * Calls backend which uses service_role to bypass RLS.
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(request: Request) {
  try {
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

    // Parse request body
    const body = await request.json();
    const { projectId, ...formData } = body;

    if (!projectId) {
      return NextResponse.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    // Transform flat formData to backend's nested format
    const sitePayload = {
      name: formData.name?.trim(),
      location: formData.location?.trim() || null,
      description: formData.description?.trim() || null,
      controller_serial_number: formData.controllerSerialNumber || null,
      control_method: formData.controlMethod || "onsite_controller",
      control_method_backup: formData.controlMethodBackup || null,
      grid_connection: formData.gridConnection || "off_grid",
      control: {
        interval_ms: formData.controlIntervalMs || 1000,
        dg_reserve_kw: formData.dgReserveKw || 50.0,
        operation_mode: formData.operationMode || "zero_dg_reverse",
      },
      logging: {
        local_interval_ms: formData.loggingLocalIntervalMs || 1000,
        cloud_interval_ms: 5000,
        local_retention_days: formData.loggingLocalRetentionDays || 7,
        cloud_enabled: formData.loggingCloudEnabled ?? true,
        gateway_enabled: formData.loggingGatewayEnabled ?? false,
      },
      safe_mode: {
        enabled: formData.safeModeEnabled ?? true,
        type: formData.safeModeType || "rolling_average",
        timeout_s: formData.safeModeTimeoutS || 30,
        rolling_window_min: formData.safeModeRollingWindowMin || 3,
        threshold_pct: formData.safeModeThresholdPct || 80.0,
        power_limit_kw: formData.safeModePowerLimitKw || null,
      },
    };

    // Call backend to create site
    const backendResponse = await fetch(
      `${BACKEND_URL}/api/sites/project/${projectId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(sitePayload),
      }
    );

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error("Backend site create failed:", errorText);
      return NextResponse.json(
        { error: errorText || "Failed to create site" },
        { status: backendResponse.status }
      );
    }

    const createdSite = await backendResponse.json();
    return NextResponse.json(createdSite, { status: 201 });
  } catch (error) {
    console.error("Site create error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
