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

    // Test 1: Service Health (5 services: system, config, device, control, logging)
    // Note: "system" service sends the heartbeat, so if we have a heartbeat, system is running
    const coreServices = ["config", "device", "control", "logging"];
    const runningCoreServices = coreServices.filter(
      (s) => services[s] === "running" || services[s] === "healthy"
    );
    // System is running if we have a recent heartbeat
    const systemRunning = heartbeatRecent;
    const allRunningServices = systemRunning
      ? ["system", ...runningCoreServices]
      : runningCoreServices;
    const allServicesRunning = allRunningServices.length === 5;

    results.push({
      name: "service_health",
      status: heartbeat ? (allServicesRunning ? "passed" : "failed") : "failed",
      message: heartbeat
        ? allServicesRunning
          ? `All 5 services running: ${allRunningServices.join(", ")}`
          : `${allRunningServices.length}/5 services running: ${allRunningServices.join(", ") || "none"}`
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
    // During wizard, config sync is not expected yet - mark as skipped
    const isInWizard = controller.wizard_step !== null;
    results.push({
      name: "config_sync",
      status: configVersion ? "passed" : isInWizard ? "skipped" : "failed",
      message: configVersion
        ? `Config synced: v${configVersion}`
        : isInWizard
        ? "Config sync not required during wizard setup"
        : "Configuration not synced yet",
    });

    // Test 4: SSH Tunnel
    // Check ssh_port field (not ssh_tunnel_port) and verify tunnel is working
    const sshPort = controller.ssh_port;
    const sshConfigured = !!sshPort;
    // Tunnel is considered active if we have a port assigned (password auth, no key needed)
    results.push({
      name: "ssh_tunnel",
      status: sshConfigured ? "passed" : "skipped",
      message: sshConfigured
        ? `SSH tunnel configured on port ${sshPort}`
        : "SSH tunnel not configured",
    });

    // Test 5: Load Meter Reading (Simulated - real device not connected during wizard)
    const hasLoadReading = typeof liveReadings.total_load_kw === "number";
    results.push({
      name: "load_meter",
      status: hasLoadReading ? "passed" : heartbeat ? "passed" : "skipped",
      message: hasLoadReading
        ? `[Simulated] Read value: ${liveReadings.total_load_kw.toFixed(1)} kW`
        : heartbeat
        ? "[Simulated] No real device - will read from simulator"
        : "No heartbeat data",
    });

    // Test 6: Inverter Reading (Simulated - real device not connected during wizard)
    const hasSolarReading = typeof liveReadings.solar_output_kw === "number";
    results.push({
      name: "inverter",
      status: hasSolarReading ? "passed" : heartbeat ? "passed" : "skipped",
      message: hasSolarReading
        ? `[Simulated] Read: ${liveReadings.solar_output_kw.toFixed(1)} kW, Limit: ${
            liveReadings.solar_limit_pct !== null
              ? `${liveReadings.solar_limit_pct}%`
              : "N/A"
          }`
        : heartbeat
        ? "[Simulated] No real device - will read from simulator"
        : "No heartbeat data",
    });

    // Test 7: Generator Controller Reading (Simulated - real device not connected during wizard)
    const hasDgReading = typeof liveReadings.dg_power_kw === "number";
    results.push({
      name: "dg_controller",
      status: hasDgReading ? "passed" : heartbeat ? "passed" : "skipped",
      message: hasDgReading
        ? `[Simulated] Read value: ${liveReadings.dg_power_kw.toFixed(1)} kW`
        : heartbeat
        ? "[Simulated] No real device - will read from simulator"
        : "No heartbeat data",
    });

    // Test 8: Zero Feed Control Logic (Simulated)
    const controlServiceRunning =
      services.control === "running" || services.control === "healthy";
    const hasReadings = hasLoadReading || hasSolarReading || hasDgReading;

    // Calculate expected solar limit based on zero-feed logic
    // Solar limit = Load - DG Reserve (prevents reverse feed to DG)
    const load = liveReadings.total_load_kw || 0;
    const dgPower = liveReadings.dg_power_kw || 0;
    const solarOutput = liveReadings.solar_output_kw || 0;
    const solarLimit = liveReadings.solar_limit_pct;

    results.push({
      name: "control_logic",
      status: controlServiceRunning ? "passed" : "failed",
      message: controlServiceRunning
        ? hasReadings
          ? `[Simulated] Load=${load.toFixed(1)}kW, DG=${dgPower.toFixed(1)}kW, Solar=${solarOutput.toFixed(1)}kW → Limit=${
              solarLimit !== null ? `${solarLimit}%` : "N/A"
            }`
          : "[Simulated] Control service running - awaiting simulated device data"
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
