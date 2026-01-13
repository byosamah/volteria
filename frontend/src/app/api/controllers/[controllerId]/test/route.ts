/**
 * Controller Test API
 *
 * POST /api/controllers/[controllerId]/test - Run diagnostic tests
 *
 * Runs REAL SSH-based tests against the controller by calling the backend API:
 * 1. SSH Tunnel - Actually connects via the reverse tunnel
 * 2. Service Health - Checks systemd services via SSH
 * 3. Cloud Communication - Tests network connectivity from controller
 * 4. Configuration Sync - Verifies config files exist
 * 5. OTA Mechanism - Checks update service and script
 *
 * Device simulation tests show demo values (no real devices during wizard).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

// Backend API URL - use internal Docker network in production
const BACKEND_URL = process.env.NODE_ENV === "production"
  ? "http://sdc-backend:8000"
  : "http://localhost:8000";

interface TestResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  message: string;
}

interface SSHTestResult {
  name: string;
  status: string;
  message: string;
  duration_ms: number;
}

interface SSHTestResponse {
  controller_id: string;
  ssh_port: number;
  results: SSHTestResult[];
  total_duration_ms: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ controllerId: string }> }
) {
  try {
    const { controllerId } = await params;
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
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

    const results: TestResult[] = [];

    // Check if SSH port is configured
    const sshPort = controller.ssh_port;

    if (!sshPort) {
      // No SSH port - can't run active tests
      results.push({
        name: "ssh_tunnel",
        status: "failed",
        message: "SSH port not configured - complete controller registration first",
      });

      // Mark other system tests as skipped
      const skippedTests = ["service_health", "communication", "config_sync", "ota_check"];
      for (const name of skippedTests) {
        results.push({
          name,
          status: "skipped",
          message: "SSH tunnel not available",
        });
      }
    } else {
      // Call backend API for real SSH tests
      console.log(`[Controller Test] Calling backend SSH tests on port ${sshPort}...`);

      try {
        // Get auth token for backend call
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;

        const response = await fetch(
          `${BACKEND_URL}/api/ssh-test/${controllerId}?ssh_port=${sshPort}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token && { "Authorization": `Bearer ${token}` }),
            },
          }
        );

        if (response.ok) {
          const sshTestData: SSHTestResponse = await response.json();

          // Convert SSH results to test results
          for (const sshResult of sshTestData.results) {
            results.push({
              name: sshResult.name,
              status: sshResult.status as "passed" | "failed" | "skipped",
              message: sshResult.message,
            });
          }

          console.log(`[Controller Test] SSH tests completed in ${sshTestData.total_duration_ms}ms`);
        } else {
          const errorText = await response.text();
          console.error(`[Controller Test] Backend SSH test failed: ${response.status} - ${errorText}`);

          // Backend call failed, add error result
          results.push({
            name: "ssh_tunnel",
            status: "failed",
            message: `Backend test failed: ${response.status}`,
          });

          const skippedTests = ["service_health", "communication", "config_sync", "ota_check"];
          for (const name of skippedTests) {
            results.push({
              name,
              status: "skipped",
              message: "SSH tests could not be executed",
            });
          }
        }
      } catch (error) {
        console.error("[Controller Test] Error calling backend:", error);

        results.push({
          name: "ssh_tunnel",
          status: "failed",
          message: `Backend connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        });

        const skippedTests = ["service_health", "communication", "config_sync", "ota_check"];
        for (const name of skippedTests) {
          results.push({
            name,
            status: "skipped",
            message: "SSH tests could not be executed",
          });
        }
      }
    }

    // Device simulation tests (demo values - no real devices during wizard)
    // Generate random realistic demo values
    const simLoadKw = Math.round((150 + Math.random() * 200) * 10) / 10;  // 150-350 kW
    const simSolarKw = Math.round((80 + Math.random() * 120) * 10) / 10;  // 80-200 kW
    const simDgKw = Math.round((simLoadKw - simSolarKw + 20 + Math.random() * 30) * 10) / 10;
    const simDgReserve = 50; // Example DG reserve

    // Control logic calculation
    const exampleAvailableForSolar = Math.max(0, simLoadKw - simDgReserve);
    const exampleSolarCapacity = 150; // kW
    const exampleLimitPct = Math.min(100, Math.round((exampleAvailableForSolar / exampleSolarCapacity) * 100));

    // Load Meter (Demo)
    results.push({
      name: "load_meter",
      status: "passed",
      message: `[Demo] Example: ${simLoadKw.toFixed(1)} kW (real values after site deployment)`,
    });

    // Inverter (Demo)
    results.push({
      name: "inverter",
      status: "passed",
      message: `[Demo] Example: ${simSolarKw.toFixed(1)} kW output, ${Math.min(100, exampleLimitPct)}% limit`,
    });

    // DG Controller (Demo)
    results.push({
      name: "dg_controller",
      status: "passed",
      message: `[Demo] Example: ${simDgKw.toFixed(1)} kW`,
    });

    // Control Logic (Demo)
    results.push({
      name: "control_logic",
      status: "passed",
      message: `[Demo] Load=${simLoadKw.toFixed(0)}kW - Reserve=${simDgReserve}kW = Available=${exampleAvailableForSolar.toFixed(0)}kW → Limit=${exampleLimitPct}%`,
    });

    // Calculate overall result
    const passedCount = results.filter((r) => r.status === "passed").length;
    const failedCount = results.filter((r) => r.status === "failed").length;
    const totalCount = results.length;

    // Only system test failures count (demo tests always pass)
    const systemTestNames = ["ssh_tunnel", "service_health", "communication", "config_sync", "ota_check"];
    const systemFailures = results.filter(
      (r) => systemTestNames.includes(r.name) && r.status === "failed"
    ).length;

    const overallPassed = systemFailures === 0;

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
