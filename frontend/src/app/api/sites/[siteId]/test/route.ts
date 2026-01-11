/**
 * Site Quick Test API
 *
 * POST /api/sites/[siteId]/test - Trigger a diagnostic test
 * GET /api/sites/[siteId]/test?testId=xxx - Get test results (poll)
 *
 * Tests device communication and control logic for a site.
 *
 * V1 Implementation: Status-based testing
 * - Checks current device online status from database
 * - Reports based on is_online and last_seen fields
 * - Future: Real device communication tests via controller
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

// How long ago a device must have been seen to be considered "responding"
const DEVICE_ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * POST /api/sites/[siteId]/test
 * Trigger a new diagnostic test for the site
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await params;
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Get site to verify it exists and get control method
    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select("id, name, control_method, project_id, controller_status, controller_last_seen")
      .eq("id", siteId)
      .single();

    if (siteError || !site) {
      return NextResponse.json({ message: "Site not found" }, { status: 404 });
    }

    // Get site devices with their current status
    const { data: devices } = await supabase
      .from("site_devices")
      .select(`
        id, name, enabled, is_online, last_seen, last_error,
        device_templates(device_type, brand, model)
      `)
      .eq("site_id", siteId)
      .eq("enabled", true);

    const now = Date.now();

    // Build test results based on current device status
    const testResults = (devices || []).map((device) => {
      const lastSeenTime = device.last_seen ? new Date(device.last_seen).getTime() : 0;
      const isRecent = (now - lastSeenTime) < DEVICE_ONLINE_THRESHOLD_MS;
      const isPassing = device.is_online && isRecent;

      // Handle Supabase join - may return array or object
      const rawTemplate = device.device_templates;
      const template = Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate;

      return {
        device_id: device.id,
        device_name: device.name,
        device_type: template?.device_type || "unknown",
        brand: template?.brand || "",
        model: template?.model || "",
        status: isPassing ? "passed" : "failed",
        message: isPassing
          ? `Last seen ${Math.round((now - lastSeenTime) / 1000)}s ago`
          : device.last_error || (device.is_online ? "No recent data" : "Device offline"),
        value: null,
      };
    });

    // Add control logic test (based on controller status)
    const controllerLastSeen = site.controller_last_seen
      ? new Date(site.controller_last_seen).getTime()
      : 0;
    const controllerRecent = (now - controllerLastSeen) < DEVICE_ONLINE_THRESHOLD_MS;
    const controllerOnline = site.controller_status === "online" && controllerRecent;

    testResults.push({
      device_id: null,
      device_name: "Control Logic",
      device_type: "control_logic",
      brand: "",
      model: "",
      status: controllerOnline ? "passed" : "failed",
      message: controllerOnline
        ? `Controller online, last seen ${Math.round((now - controllerLastSeen) / 1000)}s ago`
        : "Controller offline or not responding",
      value: null,
    });

    // Determine overall status
    const passedCount = testResults.filter((r) => r.status === "passed").length;
    const totalCount = testResults.length;
    let overallStatus: "passed" | "failed" | "partial" = "failed";
    if (passedCount === totalCount) {
      overallStatus = "passed";
    } else if (passedCount > 0) {
      overallStatus = "partial";
    }

    // Create test record with results
    const { data: testRecord, error: insertError } = await supabase
      .from("site_test_results")
      .insert({
        site_id: siteId,
        triggered_by: user.id,
        status: overallStatus,
        results: testResults,
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error("[Site Test API] Insert error:", insertError);
      return NextResponse.json(
        { message: "Failed to create test record" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      test_id: testRecord.id,
      status: overallStatus,
      device_count: devices?.length || 0,
      passed_count: passedCount,
      total_count: totalCount,
    });
  } catch (error) {
    console.error("[Site Test API] POST unexpected error:", error);
    return NextResponse.json(
      { message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sites/[siteId]/test?testId=xxx
 * Get test results (for polling)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await params;
    const { searchParams } = new URL(request.url);
    const testId = searchParams.get("testId");

    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (!testId) {
      // Return latest test for this site
      const { data: latestTest, error } = await supabase
        .from("site_test_results")
        .select("*")
        .eq("site_id", siteId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== "PGRST116") {
        console.error("[Site Test API] GET latest error:", error);
        return NextResponse.json(
          { message: "Failed to fetch test results" },
          { status: 500 }
        );
      }

      return NextResponse.json(latestTest || null);
    }

    // Get specific test
    const { data: test, error } = await supabase
      .from("site_test_results")
      .select("*")
      .eq("id", testId)
      .eq("site_id", siteId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({ message: "Test not found" }, { status: 404 });
      }
      console.error("[Site Test API] GET error:", error);
      return NextResponse.json(
        { message: "Failed to fetch test results" },
        { status: 500 }
      );
    }

    return NextResponse.json(test);
  } catch (error) {
    console.error("[Site Test API] GET unexpected error:", error);
    return NextResponse.json(
      { message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
