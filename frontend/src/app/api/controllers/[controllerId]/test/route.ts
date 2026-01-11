/**
 * Controller Test API
 *
 * POST /api/controllers/[controllerId]/test - Run diagnostic tests
 *
 * Tests controller health by checking:
 * 1. Service health (5 services running)
 * 2. Cloud communication (heartbeat recent)
 * 3. Configuration sync (config version present)
 * 4. SSH tunnel (port assigned and active)
 * 5. Simulated device tests (based on live readings)
 * 6. Control logic (control service running)
 * 7. OTA mechanism (pending_ota status present)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

// How recent a heartbeat must be to consider controller "online"
const HEARTBEAT_THRESHOLD_MS = 60 * 1000; // 1 minute

interface TestResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  message: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ controllerId: string }> }
) {
  try {
    const { controllerId } = await params;
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Get controller
    const { data: controller, error: controllerError } = await supabase
      .from("controllers")
      .select("*")
      .eq("id", controllerId)
      .single();

    if (controllerError || !controller) {
      return NextResponse.json({ message: "Controller not found" }, { status: 404 });
    }

    // Get latest heartbeat
    const { data: heartbeats } = await supabase
      .from("controller_heartbeats")
      .select("*")
      .eq("controller_id", controllerId)
      .order("timestamp", { ascending: false })
      .limit(1);

    const heartbeat = heartbeats?.[0] || null;
    const now = Date.now();
    const heartbeatTime = heartbeat?.timestamp
      ? new Date(heartbeat.timestamp).getTime()
      : 0;
    const heartbeatAge = now - heartbeatTime;
    const heartbeatRecent = heartbeatAge < HEARTBEAT_THRESHOLD_MS;

    // Extract metadata from heartbeat
    const metadata = heartbeat?.metadata || {};
    const services = metadata.services || {};
    const pendingOta = metadata.pending_ota || {};
    const liveReadings = metadata.live_readings || {};
    const configVersion = metadata.config_version;

    const results: TestResult[] = [];

    // Test 1: Service Health
    const serviceNames = ["config", "device", "control", "logging", "supervisor"];
    const runningServices = serviceNames.filter(
      (s) => services[s] === "running" || services[s] === "healthy"
    );
    const allServicesRunning = runningServices.length === serviceNames.length;

    results.push({
      name: "service_health",
      status: heartbeat ? (allServicesRunning ? "passed" : "failed") : "failed",
      message: heartbeat
        ? allServicesRunning
          ? `All 5 services running: ${runningServices.join(", ")}`
          : `${runningServices.length}/5 services running: ${runningServices.join(", ") || "none"}`
        : "No heartbeat received - cannot check services",
    });

    // Test 2: Cloud Communication
    results.push({
      name: "communication",
      status: heartbeatRecent ? "passed" : "failed",
      message: heartbeatRecent
        ? `Heartbeat received ${Math.round(heartbeatAge / 1000)}s ago`
        : heartbeat
        ? `Last heartbeat ${Math.round(heartbeatAge / 1000)}s ago (stale)`
        : "No heartbeat received",
    });

    // Test 3: Configuration Sync
    results.push({
      name: "config_sync",
      status: configVersion ? "passed" : "failed",
      message: configVersion
        ? `Config synced at ${new Date(configVersion).toLocaleString()}`
        : "Configuration not synced yet",
    });

    // Test 4: SSH Tunnel
    const sshConfigured = !!(controller.ssh_tunnel_port && controller.ssh_username);
    results.push({
      name: "ssh_tunnel",
      status: sshConfigured && controller.ssh_tunnel_active ? "passed" :
              sshConfigured ? "failed" : "skipped",
      message: sshConfigured && controller.ssh_tunnel_active
        ? `SSH tunnel active on port ${controller.ssh_tunnel_port}`
        : sshConfigured
        ? `SSH port ${controller.ssh_tunnel_port} assigned but tunnel not active`
        : "SSH tunnel not configured",
    });

    // Test 5: Simulated Load Meter
    const hasLoadReading = typeof liveReadings.total_load_kw === "number";
    results.push({
      name: "load_meter",
      status: hasLoadReading ? "passed" : heartbeat ? "failed" : "skipped",
      message: hasLoadReading
        ? `Read value: ${liveReadings.total_load_kw.toFixed(1)} kW`
        : heartbeat
        ? "No load meter reading in heartbeat"
        : "No heartbeat data",
    });

    // Test 6: Simulated Inverter
    const hasSolarReading = typeof liveReadings.solar_output_kw === "number";
    const hasSolarLimit = typeof liveReadings.solar_limit_pct === "number" ||
                          liveReadings.solar_limit_pct === null;
    results.push({
      name: "inverter",
      status: hasSolarReading ? "passed" : heartbeat ? "failed" : "skipped",
      message: hasSolarReading
        ? `Read value: ${liveReadings.solar_output_kw.toFixed(1)} kW, Limit: ${
            liveReadings.solar_limit_pct !== null
              ? `${liveReadings.solar_limit_pct}%`
              : "N/A"
          }`
        : heartbeat
        ? "No inverter reading in heartbeat"
        : "No heartbeat data",
    });

    // Test 7: Simulated DG Controller
    const hasDgReading = typeof liveReadings.dg_power_kw === "number";
    results.push({
      name: "dg_controller",
      status: hasDgReading ? "passed" : heartbeat ? "failed" : "skipped",
      message: hasDgReading
        ? `Read value: ${liveReadings.dg_power_kw.toFixed(1)} kW`
        : heartbeat
        ? "No generator reading in heartbeat"
        : "No heartbeat data",
    });

    // Test 8: Control Logic
    const controlServiceRunning =
      services.control === "running" || services.control === "healthy";
    const hasReadings = hasLoadReading || hasSolarReading || hasDgReading;
    results.push({
      name: "control_logic",
      status: controlServiceRunning && hasReadings ? "passed" :
              controlServiceRunning ? "passed" : "failed",
      message: controlServiceRunning
        ? hasReadings
          ? `Load=${(liveReadings.total_load_kw || 0).toFixed(1)}kW, DG=${(liveReadings.dg_power_kw || 0).toFixed(1)}kW → Solar limit=${
              liveReadings.solar_limit_pct !== null
                ? `${liveReadings.solar_limit_pct}%`
                : "N/A"
            }`
          : "Control service running, awaiting device data"
        : "Control service not running",
    });

    // Test 9: OTA Check
    const hasOtaStatus = typeof pendingOta.status === "string";
    results.push({
      name: "ota_check",
      status: hasOtaStatus ? "passed" : heartbeat ? "failed" : "skipped",
      message: hasOtaStatus
        ? pendingOta.version
          ? `Update available: v${pendingOta.version}`
          : "OTA updater ready, no pending updates"
        : heartbeat
        ? "OTA status not available"
        : "No heartbeat data",
    });

    // Calculate overall result
    const passedCount = results.filter((r) => r.status === "passed").length;
    const failedCount = results.filter((r) => r.status === "failed").length;
    const totalCount = results.length;

    const overallPassed = failedCount === 0;

    // Save test results to controller
    const testResultsData: Record<string, boolean> = {};
    results.forEach((r) => {
      testResultsData[r.name] = r.status === "passed";
    });

    await supabase
      .from("controllers")
      .update({
        test_results: {
          ...testResultsData,
          passed: overallPassed,
          timestamp: new Date().toISOString(),
        },
      })
      .eq("id", controllerId);

    return NextResponse.json({
      controller_id: controllerId,
      passed: overallPassed,
      passed_count: passedCount,
      failed_count: failedCount,
      total_count: totalCount,
      results,
    });
  } catch (error) {
    console.error("[Controller Test API] Error:", error);
    return NextResponse.json(
      { message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/controllers/[controllerId]/test
 * Get latest test results for a controller
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ controllerId: string }> }
) {
  try {
    const { controllerId } = await params;
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { data: controller, error } = await supabase
      .from("controllers")
      .select("id, test_results")
      .eq("id", controllerId)
      .single();

    if (error || !controller) {
      return NextResponse.json({ message: "Controller not found" }, { status: 404 });
    }

    return NextResponse.json(controller.test_results || null);
  } catch (error) {
    console.error("[Controller Test API] GET Error:", error);
    return NextResponse.json(
      { message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
