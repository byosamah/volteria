/**
 * Site Quick Test API
 *
 * POST /api/sites/[siteId]/test - Trigger a diagnostic test
 * GET /api/sites/[siteId]/test?testId=xxx - Get test results (poll)
 *
 * Tests device data flow by checking device_readings for recent data.
 * Control logic test skipped (needs redesign).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

// 10 min threshold: cloud sync is every ~180s, plus buffer for processing
const READING_THRESHOLD_MS = 10 * 60 * 1000;

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

    // Verify site exists
    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select("id, name")
      .eq("id", siteId)
      .single();

    if (siteError || !site) {
      return NextResponse.json({ message: "Site not found" }, { status: 404 });
    }

    // Get enabled devices with template info
    const { data: devices } = await supabase
      .from("site_devices")
      .select(`
        id, name,
        device_templates(device_type, brand, model)
      `)
      .eq("site_id", siteId)
      .eq("enabled", true);

    const now = Date.now();
    const deviceList = devices || [];

    // Get latest reading timestamp per device from device_readings
    const latestReadings: Record<string, string> = {};
    if (deviceList.length > 0) {
      const deviceIds = deviceList.map((d) => d.id);
      // Query latest reading for each device
      for (const deviceId of deviceIds) {
        const { data: reading } = await supabase
          .from("device_readings")
          .select("timestamp")
          .eq("device_id", deviceId)
          .order("timestamp", { ascending: false })
          .limit(1)
          .single();
        if (reading) {
          latestReadings[deviceId] = reading.timestamp;
        }
      }
    }

    // Build test results based on actual readings data
    const testResults = deviceList.map((device) => {
      const lastReadingTs = latestReadings[device.id];
      const lastReadingTime = lastReadingTs ? new Date(lastReadingTs).getTime() : 0;
      const isRecent = lastReadingTime > 0 && (now - lastReadingTime) < READING_THRESHOLD_MS;

      const rawTemplate = device.device_templates;
      const template = Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate;

      const agoSeconds = lastReadingTime > 0 ? Math.round((now - lastReadingTime) / 1000) : 0;
      const agoLabel = agoSeconds < 60
        ? `${agoSeconds}s ago`
        : `${Math.round(agoSeconds / 60)}m ago`;

      return {
        device_id: device.id,
        device_name: device.name,
        device_type: template?.device_type || "unknown",
        brand: template?.brand || "",
        model: template?.model || "",
        status: isRecent ? "passed" : "failed",
        message: isRecent
          ? `Last reading ${agoLabel}`
          : lastReadingTime > 0
            ? `Last reading ${agoLabel} (stale)`
            : "No readings found",
        value: null,
      };
    });

    // Determine overall status
    const passedCount = testResults.filter((r) => r.status === "passed").length;
    const totalCount = testResults.length;
    let overallStatus: "passed" | "failed" | "partial" = "failed";
    if (totalCount === 0) {
      overallStatus = "passed";
    } else if (passedCount === totalCount) {
      overallStatus = "passed";
    } else if (passedCount > 0) {
      overallStatus = "partial";
    }

    // Create test record
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
      device_count: deviceList.length,
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
