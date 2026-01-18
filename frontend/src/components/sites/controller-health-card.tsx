"use client";

/**
 * Controller Health Card Component
 *
 * Displays live health metrics for a site's controller:
 * - CPU Temperature (with color coding)
 * - CPU Usage %
 * - Memory Usage %
 * - Disk Usage %
 * - Running Hours (uptime)
 * - Online/Offline status
 *
 * Features:
 * - Polls every 30 seconds for live updates
 * - Pauses polling when tab is hidden (Page Visibility API)
 * - Color-coded temperature warnings
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Health data returned from API
interface ControllerHealthData {
  controllerId: string;
  serialNumber: string;
  hardwareType: string | null;
  firmwareVersion: string;
  uptimeSeconds: number;
  cpuUsagePct: number;
  memoryUsagePct: number;
  diskUsagePct: number;
  cpuTempCelsius: number | null;
  timestamp: string;
  isOnline: boolean;
}

interface ControllerHealthCardProps {
  siteId: string;
}

// Format uptime seconds to human-readable string
const formatUptime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }
  return `${hours}h ${minutes}m`;
};

// Format time since timestamp
const formatTimeSince = (timestamp: string): string => {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);

  if (seconds < 60) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
};

// Get color for temperature
const getTempColor = (temp: number | null): string => {
  if (temp === null) return "text-muted-foreground";
  if (temp < 50) return "text-green-600";
  if (temp < 70) return "text-yellow-600";
  return "text-red-600";
};

// Get color for usage percentage
const getUsageColor = (pct: number): string => {
  if (pct < 60) return "bg-green-500";
  if (pct < 80) return "bg-yellow-500";
  return "bg-red-500";
};

// Progress bar component
function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${getUsageColor(value)} transition-all duration-500`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function ControllerHealthCard({ siteId }: ControllerHealthCardProps) {
  const [health, setHealth] = useState<ControllerHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch health data from API
  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`/api/sites/${siteId}/controller-health`);
      if (!res.ok) {
        if (res.status === 404) {
          // No controller or no heartbeat data
          setHealth(null);
          setError(null);
        } else {
          throw new Error("Failed to fetch");
        }
        return;
      }
      const data = await res.json();
      setHealth(data);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch controller health:", err);
      setError("Failed to load health data");
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  // Smart polling - polls every 30s when tab is visible
  useEffect(() => {
    // Initial fetch
    fetchHealth();

    // Set up polling interval
    let intervalId: NodeJS.Timeout;

    const startPolling = () => {
      intervalId = setInterval(fetchHealth, 30000); // 30 seconds
    };

    // Handle tab visibility changes
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearInterval(intervalId);
      } else {
        fetchHealth();
        startPolling();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    startPolling();

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchHealth]);

  // Loading state
  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5 text-muted-foreground"
            >
              <rect width="20" height="14" x="2" y="3" rx="2" />
              <line x1="8" x2="16" y1="21" y2="21" />
              <line x1="12" x2="12" y1="17" y2="21" />
            </svg>
            Controller Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-2 bg-muted rounded"></div>
            <div className="h-2 bg-muted rounded"></div>
            <div className="h-2 bg-muted rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No controller or error state
  if (!health || error) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5 text-muted-foreground"
            >
              <rect width="20" height="14" x="2" y="3" rx="2" />
              <line x1="8" x2="16" y1="21" y2="21" />
              <line x1="12" x2="12" y1="17" y2="21" />
            </svg>
            Controller Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {error || "No controller health data available."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              {/* Monitor icon */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5 text-muted-foreground"
              >
                <rect width="20" height="14" x="2" y="3" rx="2" />
                <line x1="8" x2="16" y1="21" y2="21" />
                <line x1="12" x2="12" y1="17" y2="21" />
              </svg>
              Controller Health
            </CardTitle>
            <CardDescription className="flex items-center gap-2 mt-1">
              {health.hardwareType || health.serialNumber}
              {/* Online/Offline indicator */}
              {health.isOnline ? (
                <span className="flex items-center gap-1 text-green-600">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                  Online
                </span>
              ) : (
                <span className="flex items-center gap-1 text-gray-500">
                  <span className="relative flex h-2 w-2">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-gray-400"></span>
                  </span>
                  Offline
                </span>
              )}
            </CardDescription>
          </div>
          {/* Firmware version badge */}
          <Badge variant="outline" className="text-xs">
            v{health.firmwareVersion}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* CPU Temperature - only show if available */}
          {health.cpuTempCelsius !== null && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground flex items-center gap-2">
                {/* Thermometer icon */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />
                </svg>
                CPU Temp
              </span>
              <span className={`font-medium ${getTempColor(health.cpuTempCelsius)}`}>
                {health.cpuTempCelsius.toFixed(1)}°C
              </span>
            </div>
          )}

          {/* CPU Usage */}
          <ProgressBar value={health.cpuUsagePct} label="CPU Usage" />

          {/* Memory Usage */}
          <ProgressBar value={health.memoryUsagePct} label="Memory" />

          {/* Disk Usage */}
          <ProgressBar value={health.diskUsagePct} label="Disk" />

          {/* Hardware Uptime (time since last reboot) */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              {/* Clock icon */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Hardware Uptime
            </span>
            <span className="font-medium">{formatUptime(health.uptimeSeconds)}</span>
          </div>

          {/* Last Updated */}
          <div className="pt-2 border-t text-xs text-muted-foreground text-right">
            Updated: {formatTimeSince(health.timestamp)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
