"use client";

/**
 * Template Sync Status Component
 *
 * Shows the sync status between device templates and devices in a site:
 * - Last configuration update (when templates were last modified)
 * - Last synchronization (when devices were last synced from templates)
 * - Synchronize button to push template changes to all devices
 *
 * Inspired by Netbiter's configuration sync UI.
 */

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface TemplateSyncStatusProps {
  siteId: string;
}

interface SyncStatus {
  last_config_update: string | null;
  last_sync: string | null;
  needs_sync: boolean;
  total_devices: number;
  devices_needing_sync: number;
}

export function TemplateSyncStatus({ siteId }: TemplateSyncStatusProps) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Format date for display
  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    return date.toLocaleString([], {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  // Fetch sync status
  const fetchStatus = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setLoading(false);
        return;
      }

      const response = await fetch(`/api/sites/${siteId}/template-sync-status`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (error) {
      console.error("Failed to fetch sync status:", error);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  // Initial fetch
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Listen for device changes to auto-refresh sync status
  useEffect(() => {
    const handleDeviceChange = () => {
      // Refresh sync status when a device is edited/deleted
      fetchStatus();
    };

    // Listen for custom event dispatched by device-list
    window.addEventListener("device-config-changed", handleDeviceChange);

    return () => {
      window.removeEventListener("device-config-changed", handleDeviceChange);
    };
  }, [fetchStatus]);

  // Handle sync button click
  const handleSync = async () => {
    setSyncing(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        toast.error("Not authenticated");
        return;
      }

      const response = await fetch(`/api/sites/${siteId}/sync-templates`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();

      if (response.ok && result.success) {
        toast.success(result.message || `Synced ${result.synced_devices} device(s) to controller`);
        // Refresh status
        await fetchStatus();
      } else {
        // Handle error responses (timeout, failed, etc.)
        const errorMsg = result.error || result.detail || "Sync failed";
        const hint = result.hint ? ` ${result.hint}` : "";
        toast.error(`${errorMsg}${hint}`);
      }
    } catch (error) {
      console.error("Sync failed:", error);
      toast.error("Synchronization failed");
    } finally {
      setSyncing(false);
    }
  };

  // Don't render if no devices
  if (!loading && (!status || status.total_devices === 0)) {
    return null;
  }

  // Loading state
  if (loading) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-muted rounded w-48"></div>
            <div className="h-4 bg-muted rounded w-40"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const needsSync = status?.needs_sync || false;

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Status Info */}
          <div className="space-y-1 text-sm">
            {/* Last configuration update */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground min-w-[180px]">
                Last configuration update
              </span>
              <span className="font-medium">
                {formatDate(status?.last_config_update)}
              </span>
            </div>

            {/* Last controller sync confirmation */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground min-w-[180px]">
                Last controller sync
              </span>
              <span className={`font-medium flex items-center gap-1 ${needsSync ? "text-red-600" : ""}`}>
                {formatDate(status?.last_sync)}
                {needsSync ? (
                  <XCircle className="h-4 w-4 text-red-600" />
                ) : status?.last_sync ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : null}
              </span>
            </div>

            {/* Devices needing sync indicator */}
            {needsSync && status && status.devices_needing_sync > 0 && (
              <div className="flex items-center gap-2 text-amber-600">
                <AlertCircle className="h-4 w-4" />
                <span className="text-xs">
                  {status.devices_needing_sync} of {status.total_devices} device(s) need synchronization
                </span>
              </div>
            )}
          </div>

          {/* Sync Button */}
          <Button
            onClick={handleSync}
            disabled={syncing || !needsSync}
            variant={needsSync ? "default" : "outline"}
            className="min-w-[200px]"
          >
            {syncing ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Sync now
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
