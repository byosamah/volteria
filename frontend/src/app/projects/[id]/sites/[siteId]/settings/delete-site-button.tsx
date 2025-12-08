"use client";

/**
 * Delete Site Button
 *
 * Soft deletes a site (sets is_active = false).
 * Requires confirmation dialog.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

interface DeleteSiteButtonProps {
  siteId: string;
  siteName: string;
  projectId: string;
}

export function DeleteSiteButton({ siteId, siteName, projectId }: DeleteSiteButtonProps) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);

    try {
      // Soft delete the site (set is_active = false)
      const { error } = await supabase
        .from("sites")
        .update({ is_active: false })
        .eq("id", siteId);

      if (error) {
        console.error("Error deleting site:", error);
        toast.error(error.message || "Failed to delete site");
        setLoading(false);
        return;
      }

      toast.success("Site deleted successfully");

      // Redirect to project page
      router.push(`/projects/${projectId}`);
      router.refresh();
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
      setLoading(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={loading}>
          {loading ? "Deleting..." : "Delete"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="mx-4 max-w-[calc(100%-2rem)]">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Site</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <strong>{siteName}</strong>?
            <br /><br />
            This will remove all devices and data associated with this site.
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="min-h-[44px] bg-red-600 hover:bg-red-700"
          >
            Delete Site
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
