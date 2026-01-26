"use client";

/**
 * Site Status Header Component
 *
 * Displays unified status indicators for a site:
 * 1. Connection Status - Is the controller/gateway online?
 * 2. Control Logic Status - Is the control algorithm running? (controllers only)
 * 3. Config Sync Status - Is platform config in sync with controller?
 *
 * Features:
 * - Polls every 30 seconds for live updates
 * - Pauses polling when tab is hidden (Page Visibility API)
 * - Tooltips with detailed information
 * - Push Sync button when sync is needed
 */

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RefreshCw, WifiOff, Cpu, AlertCircle, Check, Clock, X } from "lucide-react";

// Status response from API
interface SiteStatusData {
  connection: {
    status: "online" | "offline";
    lastSeen: string | null;
    type: "controller" | "gateway" | "none";
  };
  controlLogic: {
    status: "running" | "stopped" | "error" | "unknown";
    lastError: string | null;
    activeAlarms: number;
  } | null;
  configSync: {
    status: "synced" | "sync_needed" | "never_synced";
    lastSyncedAt: string | null;
    cloudChangedAt: string | null;  // When config changed on web (config_changed_at)
    localPulledAt: string | null;   // When controller last pulled config
    lastConfigUpdate: string | null; // Max of site/device/template updated_at
    syncIntervalSeconds: number;     // Auto-sync interval
    totalDevices: number;
    devicesNeedingSync: number;
  };
}

interface SiteStatusHeaderProps {
  siteId: string;
  controlMethod?: string; // "onsite_controller" | "gateway_api" | null
}

// Format time since timestamp (for client-side use only)
function formatTimeSinceValue(timestamp: string | null): string {
  if (!timestamp) return "Never";
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 60) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Client-only component to avoid hydration mismatch
// Date.now() differs between server and client, causing React error #418
function FormattedTimeSince({ timestamp }: { timestamp: string | null }) {
  const [formatted, setFormatted] = useState<string>("--");

  useEffect(() => {
    setFormatted(formatTimeSinceValue(timestamp));
  }, [timestamp]);

  return <>{formatted}</>;
}

// Format date for display (e.g., "Jan 11, 2:45 PM")
const formatDate = (timestamp: string | null): string => {
  if (!timestamp) return "Never";
  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

// Connection Status Indicator
function ConnectionStatus({
  status,
  lastSeen,
  type,
}: {
  status: "online" | "offline";
  lastSeen: string | null;
  type: "controller" | "gateway" | "none";
}) {
  const isOnline = status === "online";
  const typeLabel = type === "controller" ? "Controller" : type === "gateway" ? "Gateway" : "No device";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 cursor-default">
            {isOnline ? (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                </span>
                <span className="text-sm font-medium text-green-600">Online</span>
              </>
            ) : (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-gray-400"></span>
                </span>
                <span className="text-sm font-medium text-gray-500">Offline</span>
              </>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="text-xs">
            <p className="font-medium">{typeLabel} Connection</p>
            <p className="text-muted-foreground">
              Last seen: <FormattedTimeSince timestamp={lastSeen} />
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Control Logic Status Indicator
function ControlLogicStatus({
  status,
  lastError,
  activeAlarms,
}: {
  status: "running" | "stopped" | "error" | "unknown";
  lastError: string | null;
  activeAlarms: number;
}) {
  const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string; dotColor: string }> = {
    running: {
      icon: <Cpu className="h-3.5 w-3.5 text-green-600" />,
      label: "Running",
      color: "text-green-600",
      dotColor: "bg-green-500",
    },
    stopped: {
      icon: <Cpu className="h-3.5 w-3.5 text-gray-500" />,
      label: "Stopped",
      color: "text-gray-500",
      dotColor: "bg-gray-400",
    },
    error: {
      icon: <AlertCircle className="h-3.5 w-3.5 text-red-600" />,
      label: "Error",
      color: "text-red-600",
      dotColor: "bg-red-500",
    },
    unknown: {
      icon: <Cpu className="h-3.5 w-3.5 text-gray-400" />,
      label: "Unknown",
      color: "text-gray-400",
      dotColor: "bg-gray-300",
    },
  };

  // Fallback to 'unknown' for any unexpected status values
  const config = statusConfig[status] || statusConfig.unknown;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 cursor-default">
            <span className={`relative flex h-2.5 w-2.5`}>
              {status === "running" && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${config.dotColor}`}></span>
            </span>
            <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="text-xs">
            <p className="font-medium">Control Logic</p>
            {status === "running" && (
              <p className="text-muted-foreground">
                {activeAlarms > 0
                  ? `Running with ${activeAlarms} active alarm${activeAlarms > 1 ? "s" : ""}`
                  : "Running with no errors"}
              </p>
            )}
            {status === "error" && lastError && (
              <p className="text-red-500 max-w-48 truncate">{lastError}</p>
            )}
            {status === "stopped" && (
              <p className="text-muted-foreground">Control loop is not running</p>
            )}
            {status === "unknown" && (
              <p className="text-muted-foreground">Status not reported</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Config Sync Status Indicator
function ConfigSyncStatus({
  status,
  lastSyncedAt,
  cloudChangedAt,
  localPulledAt,
  syncIntervalSeconds,
  devicesNeedingSync,
  onPushSync,
  isSyncing,
}: {
  status: "synced" | "sync_needed" | "never_synced";
  lastSyncedAt: string | null;
  cloudChangedAt: string | null;
  localPulledAt: string | null;
  syncIntervalSeconds: number;
  devicesNeedingSync: number;
  onPushSync: () => void;
  isSyncing: boolean;
}) {
  const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string; dotColor: string }> = {
    synced: {
      icon: <Check className="h-3.5 w-3.5 text-green-600" />,
      label: "Synced",
      color: "text-green-600",
      dotColor: "bg-green-500",
    },
    sync_needed: {
      icon: <X className="h-3.5 w-3.5 text-red-500" />,
      label: "Not Synced",
      color: "text-red-500",
      dotColor: "bg-red-500",
    },
    never_synced: {
      icon: <Clock className="h-3.5 w-3.5 text-gray-500" />,
      label: "Never Synced",
      color: "text-gray-500",
      dotColor: "bg-gray-400",
    },
  };

  // Fallback to 'never_synced' for any unexpected status values
  const config = statusConfig[status] || statusConfig.never_synced;

  // Format sync interval for display
  const formatInterval = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h`;
  };

  return (
    <div className="flex items-center gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 cursor-default">
              {/* Status icon */}
              {status === "synced" ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : status === "sync_needed" ? (
                <X className="h-4 w-4 text-red-500" />
              ) : (
                <Clock className="h-4 w-4 text-gray-400" />
              )}
              <span className={`text-sm font-medium ${config.color}`}>
                {status === "synced"
                  ? "Synced"
                  : status === "sync_needed"
                  ? "Not Synced"
                  : "Never Synced"}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="text-xs space-y-1.5">
              <p className="font-medium">Config Sync Status</p>

              {/* Cloud changed date */}
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Cloud changed:</span>
                <span className="font-medium">{formatDate(cloudChangedAt)}</span>
              </div>

              {/* Local pulled date */}
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Controller synced:</span>
                <span className="font-medium">{formatDate(localPulledAt)}</span>
              </div>

              {/* Status message */}
              {status === "synced" && (
                <p className="text-green-600 pt-1 border-t border-border">
                  <Check className="h-3 w-3 inline mr-1" />
                  Platform and controller configs match
                </p>
              )}
              {status === "sync_needed" && (
                <p className="text-red-500 pt-1 border-t border-border">
                  <X className="h-3 w-3 inline mr-1" />
                  {devicesNeedingSync > 0
                    ? `${devicesNeedingSync} device${devicesNeedingSync > 1 ? "s" : ""} pending sync`
                    : "Changes pending"} - auto-sync every {formatInterval(syncIntervalSeconds)}
                </p>
              )}
              {status === "never_synced" && (
                <p className="text-muted-foreground pt-1 border-t border-border">
                  Controller has never synced config
                </p>
              )}

              {/* Auto-sync note */}
              <p className="text-muted-foreground text-[10px] pt-1 border-t border-border italic">
                Controller automatically checks for changes every {formatInterval(syncIntervalSeconds)}
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Push Sync button - visible when sync is needed or never synced */}
      {(status === "sync_needed" || status === "never_synced") && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            onPushSync();
          }}
          disabled={isSyncing}
        >
          {isSyncing ? (
            <RefreshCw className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <RefreshCw className="h-3 w-3 mr-1" />
          )}
          Sync Now
        </Button>
      )}
    </div>
  );
}

export function SiteStatusHeader({ siteId, controlMethod }: SiteStatusHeaderProps) {
  const [status, setStatus] = useState<SiteStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  // Fetch status from API
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/sites/${siteId}/status`);
      if (!res.ok) {
        throw new Error("Failed to fetch status");
      }
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error("Failed to fetch site status:", err);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  // Handle push sync - triggers immediate config sync via API
  const handlePushSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/sync`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to trigger sync");
      }

      // Refresh status after sync triggered
      await fetchStatus();
    } catch (err) {
      console.error("Failed to push sync:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  // Smart polling - polls every 30s when tab is visible
  useEffect(() => {
    // Initial fetch
    fetchStatus();

    // Set up polling interval
    let intervalId: NodeJS.Timeout;

    const startPolling = () => {
      intervalId = setInterval(fetchStatus, 30000); // 30 seconds
    };

    // Handle tab visibility changes
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearInterval(intervalId);
      } else {
        fetchStatus();
        startPolling();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    startPolling();

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchStatus]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center gap-4">
        <div className="h-4 w-16 bg-muted animate-pulse rounded"></div>
        <div className="h-4 w-16 bg-muted animate-pulse rounded"></div>
        <div className="h-4 w-16 bg-muted animate-pulse rounded"></div>
      </div>
    );
  }

  // No status data
  if (!status) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <WifiOff className="h-4 w-4" />
        <span>Status unavailable</span>
      </div>
    );
  }

  // Show gateway sites without control logic status
  const isController = controlMethod === "onsite_controller" || status.connection.type === "controller";

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {/* Connection Status */}
      <ConnectionStatus
        status={status.connection.status}
        lastSeen={status.connection.lastSeen}
        type={status.connection.type}
      />

      {/* Control Logic Status (only for controllers) */}
      {isController && status.controlLogic && (
        <ControlLogicStatus
          status={status.controlLogic.status}
          lastError={status.controlLogic.lastError}
          activeAlarms={status.controlLogic.activeAlarms}
        />
      )}

      {/* Config Sync Status */}
      <ConfigSyncStatus
        status={status.configSync.status}
        lastSyncedAt={status.configSync.lastSyncedAt}
        cloudChangedAt={status.configSync.cloudChangedAt}
        localPulledAt={status.configSync.localPulledAt}
        syncIntervalSeconds={status.configSync.syncIntervalSeconds}
        devicesNeedingSync={status.configSync.devicesNeedingSync}
        onPushSync={handlePushSync}
        isSyncing={isSyncing}
      />
    </div>
  );
}
