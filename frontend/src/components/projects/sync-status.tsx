"use client";

/**
 * Sync Status Component
 *
 * Shows whether project configuration is synced with the controller.
 * Includes a "Push Sync" button for manual synchronization.
 *
 * Sync Logic:
 * - If controller is offline: Show "Offline" (can't sync)
 * - If config_synced_at is null: Show "Never Synced"
 * - If updated_at > config_synced_at: Show "Sync Needed"
 * - Otherwise: Show "Synced"
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";

interface SyncStatusProps {
  projectId: string;
  controllerStatus: string;
  updatedAt: string | null;
  configSyncedAt: string | null;
}

type SyncState = "synced" | "sync_needed" | "never_synced" | "offline";

// Format relative time for sync display
function formatSyncTime(timestamp: string | null): string {
  if (!timestamp) return "";
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export function SyncStatus({
  projectId,
  controllerStatus,
  updatedAt,
  configSyncedAt,
}: SyncStatusProps) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  // Determine sync state
  const getSyncState = (): SyncState => {
    // If controller is offline, can't sync
    if (controllerStatus === "offline") {
      return "offline";
    }

    // If never synced
    if (!configSyncedAt) {
      return "never_synced";
    }

    // Compare timestamps
    if (updatedAt && new Date(updatedAt) > new Date(configSyncedAt)) {
      return "sync_needed";
    }

    return "synced";
  };

  const syncState = getSyncState();

  // Sync status configurations
  const statusConfig: Record<
    SyncState,
    {
      label: string;
      variant: "default" | "secondary" | "destructive" | "outline";
      icon: React.ReactNode;
      tooltip: string;
      className?: string;
    }
  > = {
    synced: {
      label: configSyncedAt ? `Synced ${formatSyncTime(configSyncedAt)}` : "Synced",
      variant: "outline",
      className: "border-green-500 text-green-600",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3 w-3 mr-1"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ),
      tooltip: configSyncedAt
        ? `Last synced: ${new Date(configSyncedAt).toLocaleString()}`
        : "Controller has the latest configuration",
    },
    sync_needed: {
      label: "Sync Needed",
      variant: "outline",
      className: "border-orange-500 text-orange-600",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3 w-3 mr-1"
        >
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
          <path d="M16 16h5v5" />
        </svg>
      ),
      tooltip: "Configuration has changed - push to update controller",
    },
    never_synced: {
      label: "Never Synced",
      variant: "outline",
      className: "border-yellow-500 text-yellow-600",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3 w-3 mr-1"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      ),
      tooltip: "Configuration has never been synced to controller",
    },
    offline: {
      label: "Offline",
      variant: "secondary",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3 w-3 mr-1"
        >
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      ),
      tooltip: "Controller is offline - cannot sync",
    },
  };

  const config = statusConfig[syncState];

  // Handle sync button click
  const handleSync = async () => {
    if (syncState === "offline") {
      toast.error("Cannot sync while controller is offline");
      return;
    }

    setSyncing(true);

    try {
      const supabase = createClient();

      // Update config_synced_at to current timestamp
      const { error } = await supabase
        .from("projects")
        .update({ config_synced_at: new Date().toISOString() })
        .eq("id", projectId);

      if (error) {
        console.error("Error syncing config:", error);
        toast.error("Failed to sync configuration");
      } else {
        toast.success("Configuration synced to controller");
        // Refresh page to update UI
        router.refresh();
      }
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setSyncing(false);
    }
  };

  // Check if sync button should be enabled
  const canSync = syncState !== "offline" && syncState !== "synced";

  return (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        {/* Sync Status Badge */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant={config.variant} className={config.className}>
              {config.icon}
              {config.label}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>{config.tooltip}</p>
          </TooltipContent>
        </Tooltip>

        {/* Push Sync Button - only show when sync is possible or needed */}
        {syncState !== "synced" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={!canSync || syncing}
                className="min-h-[36px]"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`h-4 w-4 mr-1 ${syncing ? "animate-spin" : ""}`}
                >
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M16 16h5v5" />
                </svg>
                {syncing ? "Syncing..." : "Push Sync"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Push configuration to the controller</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
