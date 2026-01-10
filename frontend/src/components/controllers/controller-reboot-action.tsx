"use client";

/**
 * Controller Reboot Action Component
 *
 * Shared component for rebooting controllers across multiple pages:
 * - Master Device List (site detail page)
 * - Controllers page (admin)
 * - My Controllers page
 *
 * Features:
 * - Double confirmation (first dialog + type "REBOOT")
 * - Only enabled for online controllers with non-draft status
 * - Calls backend API which handles SSH reboot
 */

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";

// Controller status types that allow reboot (not draft)
const REBOOTABLE_STATUSES = ["ready", "claimed", "deployed"];

// Helper to determine if controller is online (heartbeat within last 90 seconds)
const isControllerOnline = (lastHeartbeat: string | null): boolean => {
  if (!lastHeartbeat) return false;
  const thresholdMs = 90 * 1000; // 90 seconds
  return Date.now() - new Date(lastHeartbeat).getTime() < thresholdMs;
};

interface ControllerRebootActionProps {
  controllerId: string;
  controllerName: string;
  controllerStatus: string;
  lastHeartbeat: string | null;
  variant?: "icon" | "button"; // icon = just icon button, button = full button with text
  size?: "sm" | "default";
  onRebootInitiated?: () => void; // Optional callback after reboot is initiated
}

export function ControllerRebootAction({
  controllerId,
  controllerName,
  controllerStatus,
  lastHeartbeat,
  variant = "icon",
  size = "sm",
  onRebootInitiated,
}: ControllerRebootActionProps) {
  // Dialog state
  const [showFirstConfirm, setShowFirstConfirm] = useState(false);
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isRebooting, setIsRebooting] = useState(false);

  // Check if reboot is allowed
  const isOnline = isControllerOnline(lastHeartbeat);
  const canReboot = isOnline && REBOOTABLE_STATUSES.includes(controllerStatus);

  // Get disabled reason for tooltip
  const getDisabledReason = (): string => {
    if (!isOnline) return "Controller must be online to reboot";
    if (!REBOOTABLE_STATUSES.includes(controllerStatus)) {
      return `Cannot reboot controllers in "${controllerStatus}" status`;
    }
    return "";
  };

  // Handle opening the first confirmation dialog
  const handleStartReboot = () => {
    setShowFirstConfirm(true);
  };

  // Handle the actual reboot after typing REBOOT
  const handleReboot = async () => {
    if (confirmText !== "REBOOT") return;

    setIsRebooting(true);
    try {
      const res = await fetch(`/api/controllers/${controllerId}/reboot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send reboot command");
      }

      toast.success("Reboot command sent. Controller will restart shortly.");

      // Close all dialogs and reset state
      setShowFinalConfirm(false);
      setShowFirstConfirm(false);
      setConfirmText("");

      // Call optional callback
      onRebootInitiated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reboot controller");
    } finally {
      setIsRebooting(false);
    }
  };

  // Handle canceling from final dialog
  const handleCancelFinal = () => {
    setShowFinalConfirm(false);
    setConfirmText("");
  };

  // Handle canceling from first dialog
  const handleCancelFirst = () => {
    setShowFirstConfirm(false);
  };

  return (
    <>
      {/* Reboot Button */}
      {variant === "icon" ? (
        <Button
          variant="ghost"
          size={size === "sm" ? "icon" : "default"}
          className={`${size === "sm" ? "h-9 w-9" : "h-10 w-10"} text-amber-600 hover:text-amber-700 hover:bg-amber-50`}
          onClick={handleStartReboot}
          disabled={!canReboot}
          title={canReboot ? "Reboot controller" : getDisabledReason()}
        >
          <RefreshCw className="h-4 w-4" />
          <span className="sr-only">Reboot</span>
        </Button>
      ) : (
        <Button
          variant="outline"
          size={size}
          className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 border-amber-200"
          onClick={handleStartReboot}
          disabled={!canReboot}
          title={canReboot ? "Reboot controller" : getDisabledReason()}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Reboot
        </Button>
      )}

      {/* First Confirmation Dialog */}
      <AlertDialog open={showFirstConfirm} onOpenChange={setShowFirstConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reboot &quot;{controllerName}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will restart the controller hardware. The site will be offline for approximately 60 seconds during the reboot.
              <span className="block mt-2 text-amber-600 font-medium">
                All active control operations will be interrupted.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="min-h-[44px]"
              onClick={handleCancelFirst}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowFirstConfirm(false);
                setShowFinalConfirm(true);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 min-h-[44px]"
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Final Confirmation Dialog - Type REBOOT */}
      <Dialog open={showFinalConfirm} onOpenChange={(open) => {
        setShowFinalConfirm(open);
        if (!open) {
          setConfirmText("");
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Confirm Reboot</DialogTitle>
            <DialogDescription>
              Type <span className="font-mono font-bold">REBOOT</span> to confirm you want to restart the controller.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
              placeholder="Type REBOOT"
              className="min-h-[44px] font-mono text-center text-lg"
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancelFinal}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReboot}
              disabled={confirmText !== "REBOOT" || isRebooting}
              className="min-h-[44px]"
            >
              {isRebooting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Rebooting...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Confirm Reboot
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Export helper for use in other components
export { isControllerOnline, REBOOTABLE_STATUSES };
