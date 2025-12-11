"use client";

/**
 * Step 6: Verify Online
 *
 * Wait for and confirm controller heartbeat
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
  firmware_version?: string;
  ip_address?: string;
  uptime_seconds?: number;
}

export function StepVerifyOnline({ controllerId, onVerified, verified }: StepVerifyOnlineProps) {
  const supabase = createClient();
  const [status, setStatus] = useState<"waiting" | "online" | "timeout">("waiting");
  const [heartbeat, setHeartbeat] = useState<HeartbeatData | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const TIMEOUT_SECONDS = 300; // 5 minutes
  const POLL_INTERVAL = 5000; // 5 seconds

  useEffect(() => {
    if (!controllerId || verified) return;

    let pollInterval: NodeJS.Timeout;
    let timeInterval: NodeJS.Timeout;

    // Start polling for heartbeat
    const checkHeartbeat = async () => {
      try {
        // Query for heartbeats from this controller via site_master_devices
        const { data, error: queryError } = await supabase
          .from("site_master_devices")
          .select(`
            sites (
              controller_heartbeats (
                timestamp,
                firmware_version,
                ip_address,
                uptime_seconds
              )
            )
          `)
          .eq("controller_id", controllerId)
          .order("created_at", { ascending: false })
          .limit(1);

        if (queryError) {
          console.error("Error checking heartbeat:", queryError);
          return;
        }

        // Also check direct heartbeats table (in case controller sends heartbeat before site assignment)
        const { data: directHeartbeat } = await supabase
          .from("controller_heartbeats")
          .select("timestamp, firmware_version, ip_address, uptime_seconds, metadata")
          .eq("metadata->>controller_id", controllerId)
          .order("timestamp", { ascending: false })
          .limit(1);

        // Check if we have a recent heartbeat
        let latestHeartbeat: HeartbeatData | null = null;

        // Check site-based heartbeats
        if (data && data.length > 0) {
          const sites = data[0].sites;
          const site = Array.isArray(sites) ? sites[0] : sites;
          if (site?.controller_heartbeats) {
            const hbs = Array.isArray(site.controller_heartbeats)
              ? site.controller_heartbeats
              : [site.controller_heartbeats];
            if (hbs.length > 0 && hbs[0]?.timestamp) {
              latestHeartbeat = hbs[0];
            }
          }
        }

        // Check direct heartbeats
        if (directHeartbeat && directHeartbeat.length > 0) {
          const dh = directHeartbeat[0];
          if (!latestHeartbeat || new Date(dh.timestamp) > new Date(latestHeartbeat.timestamp)) {
            latestHeartbeat = dh;
          }
        }

        if (latestHeartbeat) {
          const heartbeatTime = new Date(latestHeartbeat.timestamp).getTime();
          const now = Date.now();
          const tenMinutesAgo = now - 10 * 60 * 1000;

          if (heartbeatTime > tenMinutesAgo) {
            setHeartbeat(latestHeartbeat);
            setStatus("online");
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
            {heartbeat.ip_address && (
              <div>
                <span className="text-muted-foreground">IP Address:</span>
                <span className="ml-2 font-mono">{heartbeat.ip_address}</span>
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
              Try restarting the controller: <code className="bg-background px-1 rounded">sudo systemctl restart volteria-controller</code>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              Check logs: <code className="bg-background px-1 rounded">journalctl -u volteria-controller -f</code>
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
