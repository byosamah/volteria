/**
 * Emergency Stop Card Component
 *
 * ⚠️ PHASE 3 - Remote Control UI
 *
 * Provides emergency stop functionality:
 * - Big red button to immediately set all inverters to 0%
 * - Confirmation dialog before executing
 * - Resume operations button to restore normal operation
 *
 * This is a safety feature for critical situations.
 */

"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertOctagon, Power, Loader2, Check, AlertTriangle, PlayCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Props for the EmergencyStopCard
interface EmergencyStopCardProps {
  siteId: string;
  projectId: string;
  isOnline: boolean;
}

export function EmergencyStopCard({ siteId, projectId, isOnline }: EmergencyStopCardProps) {
  // UI state
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [success, setSuccess] = useState<"stop" | "resume" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStopped, setIsStopped] = useState(false);

  // Handle emergency stop execution
  async function handleEmergencyStop() {
    setExecuting(true);
    setError(null);
    setShowConfirmDialog(false);

    try {
      const supabase = createClient();

      // Set power limit to 0%
      const { error: updateError } = await supabase
        .from("sites")
        .update({ safe_mode_power_limit_pct: 0 })
        .eq("id", siteId);

      if (updateError) throw updateError;

      // Log the emergency stop command
      await supabase.from("control_commands").insert({
        site_id: siteId,
        project_id: projectId,
        command_type: "emergency_stop",
        command_value: { power_limit_pct: 0, reason: "Manual emergency stop" },
        status: isOnline ? "sent" : "queued",
      });

      setIsStopped(true);
      setSuccess("stop");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error("Emergency stop failed:", err);
      setError("Failed to execute emergency stop. Please try again or contact support.");
    } finally {
      setExecuting(false);
    }
  }

  // Handle resume operations
  async function handleResume() {
    setExecuting(true);
    setError(null);
    setShowResumeDialog(false);

    try {
      const supabase = createClient();

      // Restore power limit to 100%
      const { error: updateError } = await supabase
        .from("sites")
        .update({ safe_mode_power_limit_pct: 100 })
        .eq("id", siteId);

      if (updateError) throw updateError;

      // Log the resume command
      await supabase.from("control_commands").insert({
        site_id: siteId,
        project_id: projectId,
        command_type: "resume_operations",
        command_value: { power_limit_pct: 100, reason: "Manual resume" },
        status: isOnline ? "sent" : "queued",
      });

      setIsStopped(false);
      setSuccess("resume");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error("Resume operations failed:", err);
      setError("Failed to resume operations. Please try again.");
    } finally {
      setExecuting(false);
    }
  }

  return (
    <>
      <Card className={isStopped ? "border-red-300 bg-red-50" : ""}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertOctagon className={`h-5 w-5 ${isStopped ? "text-red-600" : "text-red-500"}`} />
            Emergency Controls
          </CardTitle>
          <CardDescription>
            Use only in emergency situations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Error display */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-100 text-red-700 rounded-md text-sm">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Current status indicator */}
          {isStopped && (
            <div className="flex items-center gap-2 p-3 bg-red-100 rounded-md">
              <div className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
              </div>
              <span className="font-medium text-red-700">Emergency Stop Active</span>
            </div>
          )}

          {/* Emergency Stop Button - Big red button */}
          {!isStopped && (
            <Button
              variant="destructive"
              size="lg"
              className="w-full h-20 text-lg font-bold gap-3"
              onClick={() => setShowConfirmDialog(true)}
              disabled={executing}
            >
              {executing ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin" />
                  Executing...
                </>
              ) : success === "stop" ? (
                <>
                  <Check className="h-6 w-6" />
                  Stopped!
                </>
              ) : (
                <>
                  <Power className="h-6 w-6" />
                  EMERGENCY STOP
                </>
              )}
            </Button>
          )}

          {/* Resume Operations Button - Only show when stopped */}
          {isStopped && (
            <Button
              variant="default"
              size="lg"
              className="w-full h-16 text-lg font-medium gap-3 bg-green-600 hover:bg-green-700"
              onClick={() => setShowResumeDialog(true)}
              disabled={executing}
            >
              {executing ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin" />
                  Resuming...
                </>
              ) : success === "resume" ? (
                <>
                  <Check className="h-6 w-6" />
                  Resumed!
                </>
              ) : (
                <>
                  <PlayCircle className="h-6 w-6" />
                  Resume Operations
                </>
              )}
            </Button>
          )}

          {/* Warning text */}
          <p className="text-xs text-muted-foreground text-center">
            {isStopped
              ? "All inverters are currently limited to 0%. Click 'Resume Operations' to restore normal operation."
              : "Emergency stop will immediately set all inverters to 0% power output. Use only in critical situations."}
          </p>
        </CardContent>
      </Card>

      {/* Emergency Stop Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertOctagon className="h-5 w-5" />
              Confirm Emergency Stop
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This will immediately set all inverter power limits to <strong>0%</strong>,
                stopping all solar power production at this site.
              </p>
              <p className="text-red-600 font-medium">
                Are you sure you want to proceed?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleEmergencyStop}
              className="bg-red-600 hover:bg-red-700 min-h-[44px]"
            >
              Yes, Emergency Stop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Resume Operations Confirmation Dialog */}
      <AlertDialog open={showResumeDialog} onOpenChange={setShowResumeDialog}>
        <AlertDialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-green-600">
              <PlayCircle className="h-5 w-5" />
              Resume Operations
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This will restore the inverter power limit to <strong>100%</strong>,
                allowing normal solar power production.
              </p>
              <p>
                Make sure the emergency situation has been resolved before resuming.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResume}
              className="bg-green-600 hover:bg-green-700 min-h-[44px]"
            >
              Resume Operations
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
