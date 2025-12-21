"use client";

/**
 * Project Status Badge Component
 *
 * Displays live aggregated connection status for all sites in a project.
 * Uses 30-second polling with Page Visibility API to pause when tab is hidden.
 *
 * Visual States:
 * - Single site online:    ● Online     (green pulsing dot)
 * - Single site offline:   ○ Offline    (gray dot)
 * - Multiple sites:        ● 2 online · ○ 1 offline
 * - All online:            ● 3 online   (green)
 * - All offline:           ○ 3 offline  (gray)
 */

import { useState, useEffect, useCallback, memo } from "react";

// API response structure
interface ProjectStatusData {
  online: number;
  offline: number;
  total: number;
}

interface ProjectStatusBadgeProps {
  projectId: string;
  siteCount?: number;  // Total sites (including those without master devices)
}

export const ProjectStatusBadge = memo(function ProjectStatusBadge({ projectId, siteCount = 0 }: ProjectStatusBadgeProps) {
  const [status, setStatus] = useState<ProjectStatusData | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch status from API
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/status`);
      if (!res.ok) {
        throw new Error("Failed to fetch status");
      }
      const data = await res.json();
      setStatus(data);
    } catch {
      // Silently handle fetch errors - UI shows loading state
    } finally {
      setLoading(false);
    }
  }, [projectId]);

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

  // Loading state - simple skeleton
  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-muted animate-pulse" />
        <div className="h-5 w-14 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  // No status data or no sites with master devices
  if (!status || status.total === 0) {
    // If there are sites but no master devices, show "X sites - No controllers"
    if (siteCount > 0) {
      return (
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-yellow-400" />
          <span className="text-sm text-muted-foreground">
            {siteCount} site{siteCount === 1 ? "" : "s"} - No controllers
          </span>
        </div>
      );
    }
    // No sites at all
    return (
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-gray-400" />
        <span className="text-sm text-muted-foreground">No sites</span>
      </div>
    );
  }

  const { online, offline, total } = status;
  const allOnline = online === total && total > 0;
  const allOffline = offline === total && total > 0;

  // Single site - show simple status
  if (total === 1) {
    const isOnline = online === 1;
    return (
      <div className="flex items-center gap-2">
        {isOnline ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            <span className="text-sm font-medium text-green-600">Online</span>
          </>
        ) : (
          <>
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-gray-400"></span>
            </span>
            <span className="text-sm font-medium text-gray-500">Offline</span>
          </>
        )}
      </div>
    );
  }

  // Multiple sites - show aggregate counts
  return (
    <div className="flex items-center gap-3 text-sm">
      {/* Online count - only show if there are online sites */}
      {online > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            {allOnline && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            )}
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span className="font-medium text-green-600">{online} online</span>
        </div>
      )}

      {/* Separator - only if both online and offline */}
      {online > 0 && offline > 0 && (
        <span className="text-muted-foreground">·</span>
      )}

      {/* Offline count - only show if there are offline sites */}
      {offline > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="relative inline-flex rounded-full h-2 w-2 bg-gray-400"></span>
          </span>
          <span className="font-medium text-gray-500">{offline} offline</span>
        </div>
      )}
    </div>
  );
});
