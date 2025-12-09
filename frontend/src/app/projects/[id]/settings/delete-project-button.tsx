"use client";

/**
 * Delete Project Button
 *
 * Handles project deletion with confirmation dialog.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface DeleteProjectButtonProps {
  projectId: string;
  projectName: string;
  siteCount: number;    // Number of active sites in project
  deviceCount: number;  // Number of active devices in project
}

export function DeleteProjectButton({
  projectId,
  projectName,
  siteCount,
  deviceCount,
}: DeleteProjectButtonProps) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  // Check if project can be deleted (no sites or devices)
  const canDelete = siteCount === 0 && deviceCount === 0;

  // Check if confirmation text matches
  const isConfirmed = confirmText === projectName;

  // Handle deletion
  const handleDelete = async () => {
    if (!isConfirmed) return;

    setLoading(true);

    try {
      // Hard delete: permanently remove the record
      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("id", projectId);

      if (error) {
        console.error("Error deleting project:", error);
        toast.error(error.message || "Failed to delete project");
        setLoading(false);
        return;
      }

      // Success!
      toast.success("Project deleted successfully");
      setOpen(false);
      router.push("/projects");
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="destructive" disabled={!canDelete}>
            Delete Project
          </Button>
        </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Project</DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently delete the
            project and all associated data.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium">Warning:</p>
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li>All control logs will be deleted</li>
              <li>All device configurations will be removed</li>
              <li>All alarms history will be lost</li>
            </ul>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm">
              Type <span className="font-mono font-bold">{projectName}</span> to
              confirm
            </Label>
            <Input
              id="confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Enter project name"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!isConfirmed || loading}
          >
            {loading ? "Deleting..." : "Delete Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {/* Warning message when project has sites or devices */}
      {!canDelete && (
        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg max-w-sm text-right">
          <p className="text-sm text-amber-800 font-medium">
            Cannot delete project
          </p>
          <p className="text-sm text-amber-700 mt-1">
            This project has {siteCount} site{siteCount !== 1 ? "s" : ""}
            {deviceCount > 0 && (
              <> and {deviceCount} device{deviceCount !== 1 ? "s" : ""}</>
            )}.
            Delete all sites and devices first.
          </p>
        </div>
      )}
    </div>
  );
}
