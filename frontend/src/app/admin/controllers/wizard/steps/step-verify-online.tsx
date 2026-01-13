"use client";

/**
 * Step 6: Verify Online
 *
 * Wait for and confirm controller heartbeat, then set up SSH tunnel
 */

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

interface StepVerifyOnlineProps {
  controllerId: string | null;
  onVerified: () => void;
  verified: boolean;
}

interface HeartbeatData {
  timestamp: string;
  controller_id?: string;
  firmware_version?: string;
  uptime_seconds?: number;
  cpu_usage_pct?: number;
  memory_usage_pct?: number;
  disk_usage_pct?: number;
  metadata?: {
    config_version?: string;
    services?: Record<string, string>;
    pending_ota?: { status: string; version?: string };
    cpu_temp_celsius?: number;
  };
}

interface SSHSetupData {
  ssh_tunnel_port: number;
  ssh_username: string;
  central_server: string;
  setup_script: string;
  already_configured?: boolean;
}

export function StepVerifyOnline({ controllerId, onVerified, verified }: StepVerifyOnlineProps) {
  const supabase = createClient();
  const [status, setStatus] = useState<"waiting" | "online" | "timeout">("waiting");
  const [heartbeat, setHeartbeat] = useState<HeartbeatData | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sshSetup, setSSHSetup] = useState<SSHSetupData | null>(null);
  const [sshSetupStatus, setSSHSetupStatus] = useState<"pending" | "setting_up" | "complete" | "error">("pending");
  const [configStatus, setConfigStatus] = useState<{ synced: boolean; message: string } | null>(null);

  const TIMEOUT_SECONDS = 300; // 5 minutes
  const POLL_INTERVAL = 5000; // 5 seconds

  // Set up SSH tunnel when controller comes online
  useEffect(() => {
    if (status !== "online" || !controllerId || sshSetupStatus !== "pending") return;

    const setupSSH = async () => {
      setSSHSetupStatus("setting_up");
      try {
        const response = await fetch(`/api/controllers/${controllerId}/ssh-setup`, {
          method: "POST",
        });

        if (!response.ok) {
          throw new Error("Failed to set up SSH tunnel");
        }

        const data = await response.json();
        setSSHSetup(data);
        setSSHSetupStatus("complete");
      } catch (err) {
        console.error("SSH setup error:", err);
        setSSHSetupStatus("error");
      }
    };

    setupSSH();
  }, [status, controllerId, sshSetupStatus]);

  useEffect(() => {
    if (!controllerId || verified) return;

    let pollInterval: NodeJS.Timeout;
    let timeInterval: NodeJS.Timeout;

    // Start polling for heartbeat
    const checkHeartbeat = async () => {
      try {
        // Query heartbeats directly by controller_id
        // At wizard step 6, controller hasn't been assigned to a site yet,
        // so we query the controller_heartbeats table directly
        const { data: heartbeatData, error: queryError } = await supabase
          .from("controller_heartbeats")
          .select("timestamp, controller_id, firmware_version, uptime_seconds, cpu_usage_pct, memory_usage_pct, disk_usage_pct, metadata")
          .eq("controller_id", controllerId)
          .order("timestamp", { ascending: false })
          .limit(1);

        if (queryError) {
          console.error("Error checking heartbeat:", queryError);
          return;
        }

        // Check if we have a recent heartbeat
        const latestHeartbeat: HeartbeatData | null = heartbeatData?.[0] ?? null;

        if (latestHeartbeat) {
          const heartbeatTime = new Date(latestHeartbeat.timestamp).getTime();
          const now = Date.now();
          const tenMinutesAgo = now - 10 * 60 * 1000;

          if (heartbeatTime > tenMinutesAgo) {
            setHeartbeat(latestHeartbeat);
            setStatus("online");

            // Check config version from metadata
            const configVersion = latestHeartbeat.metadata?.config_version;
            if (configVersion) {
              setConfigStatus({
                synced: true,
                message: `Configuration synced at ${new Date(configVersion).toLocaleString()}`,
              });
            } else {
              setConfigStatus({
                synced: false,
                message: "Heartbeat received but configuration may not be fully synced yet",
              });
            }

            onVerified();
            // Stop polling
            clearInterval(pollInterval);
            clearInterval(timeInterval);
          }
        }
      } catch (err) {
        console.error("Error checking heartbeat:", err);
        setError("Failed to check heartbeat status");
      }
    };

    // Initial check
    checkHeartbeat();

    // Set up polling interval
    pollInterval = setInterval(checkHeartbeat, POLL_INTERVAL);

    // Set up elapsed time counter
    timeInterval = setInterval(() => {
      setElapsedTime((prev) => {
        const newTime = prev + 1;
        if (newTime >= TIMEOUT_SECONDS) {
          setStatus("timeout");
          clearInterval(pollInterval);
          clearInterval(timeInterval);
        }
        return newTime;
      });
    }, 1000);

    return () => {
      clearInterval(pollInterval);
      clearInterval(timeInterval);
    };
  }, [controllerId, verified, onVerified, supabase]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleRetry = () => {
    setStatus("waiting");
    setElapsedTime(0);
    setError(null);
  };

  return (
    <div className="space-y-6">
      {/* Status display */}
      <div className="flex flex-col items-center justify-center py-8">
        {status === "waiting" && (
          <>
            {/* Animated spinner */}
            <div className="relative w-24 h-24 mb-6">
              <div className="absolute inset-0 border-4 border-muted rounded-full"></div>
              <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-10 h-10 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                </svg>
              </div>
            </div>
            <h3 className="text-xl font-semibold mb-2">Waiting for controller...</h3>
            <p className="text-muted-foreground mb-4">
              Looking for heartbeat signal from your controller
            </p>
            <div className="text-sm text-muted-foreground">
              Elapsed: {formatTime(elapsedTime)} / {formatTime(TIMEOUT_SECONDS)}
            </div>
            <div className="w-full max-w-xs mt-4 bg-muted rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-1000"
                style={{ width: `${(elapsedTime / TIMEOUT_SECONDS) * 100}%` }}
              ></div>
            </div>
          </>
        )}

        {status === "online" && (
          <>
            {/* Success indicator */}
            <div className="w-24 h-24 mb-6 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-12 h-12 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-green-600 mb-2">Controller Online!</h3>
            <p className="text-muted-foreground">
              Your controller is successfully connected to the cloud.
            </p>

            {/* Config Sync Status */}
            {configStatus && (
              <div className="mt-4 w-full max-w-md">
                {configStatus.synced ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                    <div className="flex items-center gap-2 text-green-800 font-medium mb-1">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Configuration Synced
                    </div>
                    <p className="text-green-700">{configStatus.message}</p>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                    <div className="flex items-center gap-2 text-amber-800 font-medium mb-1">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Config Sync Pending
                    </div>
                    <p className="text-amber-700">{configStatus.message}</p>
                  </div>
                )}
              </div>
            )}

            {/* SSH Setup Status */}
            <div className="mt-4 w-full max-w-md">
              {sshSetupStatus === "setting_up" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                  Setting up remote access...
                </div>
              )}
              {sshSetupStatus === "complete" && sshSetup && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                  <div className="flex items-center gap-2 text-blue-800 font-medium mb-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Remote Access Configured
                  </div>
                  <p className="text-blue-700">
                    SSH Port: <code className="bg-blue-100 px-1 rounded">{sshSetup.ssh_tunnel_port}</code>
                    {sshSetup.already_configured && " (already configured)"}
                  </p>
                </div>
              )}
              {sshSetupStatus === "error" && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
                  Remote access setup failed. You can configure it manually later.
                </div>
              )}
            </div>
          </>
        )}

        {status === "timeout" && (
          <>
            {/* Timeout indicator */}
            <div className="w-24 h-24 mb-6 bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-12 h-12 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-red-600 mb-2">Connection Timeout</h3>
            <p className="text-muted-foreground mb-4">
              Could not detect the controller within 5 minutes.
            </p>
            <button
              onClick={handleRetry}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              Retry
            </button>
          </>
        )}
      </div>

      {/* Heartbeat details */}
      {heartbeat && (
        <div className="border rounded-lg p-4 space-y-3">
          <h4 className="font-medium">Controller Information</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Last heartbeat:</span>
              <span className="ml-2 font-medium">
                {new Date(heartbeat.timestamp).toLocaleString()}
              </span>
            </div>
            {heartbeat.firmware_version && (
              <div>
                <span className="text-muted-foreground">Firmware:</span>
                <span className="ml-2 font-medium">{heartbeat.firmware_version}</span>
              </div>
            )}
            {heartbeat.cpu_usage_pct !== undefined && (
              <div>
                <span className="text-muted-foreground">CPU Usage:</span>
                <span className="ml-2 font-medium">{heartbeat.cpu_usage_pct.toFixed(1)}%</span>
              </div>
            )}
            {heartbeat.memory_usage_pct !== undefined && (
              <div>
                <span className="text-muted-foreground">Memory:</span>
                <span className="ml-2 font-medium">{heartbeat.memory_usage_pct.toFixed(1)}%</span>
              </div>
            )}
            {heartbeat.uptime_seconds && (
              <div>
                <span className="text-muted-foreground">Uptime:</span>
                <span className="ml-2 font-medium">
                  {Math.floor(heartbeat.uptime_seconds / 60)} minutes
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Troubleshooting tips */}
      {(status === "waiting" || status === "timeout") && (
        <div className="bg-muted rounded-lg p-4">
          <h4 className="font-medium mb-2">Troubleshooting Tips</h4>
          <ul className="text-sm space-y-2 text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              Make sure the Raspberry Pi is powered on (red LED should be solid)
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              Check that the Ethernet cable is connected or WiFi is configured
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              Verify the config.yaml file was copied to the correct location
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              Try restarting the controller: <code className="bg-background px-1 rounded">sudo systemctl restart volteria</code>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              Check logs: <code className="bg-background px-1 rounded">sudo journalctl -u volteria -f</code>
            </li>
          </ul>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}
