"use client";

/**
 * Controller Claim Form
 *
 * Client component for entering serial number and passcode to claim a controller.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface ClaimFormProps {
  enterpriseId: string;
  userId: string;
}

export function ClaimForm({ enterpriseId, userId }: ClaimFormProps) {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(false);
  const [serialNumber, setSerialNumber] = useState("");
  const [passcode, setPasscode] = useState("");

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate inputs
      if (!serialNumber.trim()) {
        toast.error("Serial number is required");
        setLoading(false);
        return;
      }

      if (!passcode.trim()) {
        toast.error("Passcode is required");
        setLoading(false);
        return;
      }

      // Find controller with matching serial number
      const { data: controller, error: findError } = await supabase
        .from("controllers")
        .select("id, serial_number, passcode, status, enterprise_id")
        .eq("serial_number", serialNumber.trim().toUpperCase())
        .single();

      if (findError || !controller) {
        toast.error("Controller not found. Please check the serial number.");
        setLoading(false);
        return;
      }

      // Check if already claimed
      if (controller.enterprise_id) {
        toast.error("This controller has already been claimed by another enterprise.");
        setLoading(false);
        return;
      }

      // Check if controller is ready to be claimed
      if (controller.status !== "ready") {
        toast.error("This controller is not available for claiming. Contact support.");
        setLoading(false);
        return;
      }

      // Validate passcode (case-insensitive to support both old 8-char and new UUID formats)
      const inputPasscode = passcode.trim().toLowerCase();
      const storedPasscode = (controller.passcode || "").toLowerCase();
      if (storedPasscode !== inputPasscode) {
        toast.error("Invalid passcode. Please check and try again.");
        setLoading(false);
        return;
      }

      // Claim the controller
      const { error: claimError } = await supabase
        .from("controllers")
        .update({
          enterprise_id: enterpriseId,
          claimed_at: new Date().toISOString(),
          claimed_by: userId,
          status: "deployed",
        })
        .eq("id", controller.id);

      if (claimError) {
        console.error("Error claiming controller:", claimError);
        toast.error("Failed to claim controller. Please try again.");
        setLoading(false);
        return;
      }

      toast.success("Controller claimed successfully!");
      router.push("/admin/controllers");
      router.refresh();
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <rect width="20" height="14" x="2" y="3" rx="2" />
            <line x1="8" x2="16" y1="21" y2="21" />
            <line x1="12" x2="12" y1="17" y2="21" />
          </svg>
          Enter Controller Details
        </CardTitle>
        <CardDescription>
          Enter the serial number and passcode from your controller device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleClaim} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="serial_number">
              Serial Number <span className="text-red-500">*</span>
            </Label>
            <Input
              id="serial_number"
              placeholder="e.g., RPI5-2024-001"
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value.toUpperCase())}
              className="min-h-[44px] font-mono uppercase"
              required
            />
            <p className="text-xs text-muted-foreground">
              Found on the controller label or documentation
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="passcode">
              Passcode <span className="text-red-500">*</span>
            </Label>
            <Input
              id="passcode"
              placeholder="e.g., c159d3d6-a778-4812-a688-0d7c5d0042ea"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="min-h-[44px] font-mono text-sm"
              required
            />
            <p className="text-xs text-muted-foreground">
              UUID passcode provided with the controller
            </p>
          </div>

          <div className="pt-4">
            <Button type="submit" disabled={loading} className="w-full min-h-[44px]">
              {loading ? (
                <>
                  <svg
                    className="animate-spin -ml-1 mr-2 h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Claiming...
                </>
              ) : (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 mr-2"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Claim Controller
                </>
              )}
            </Button>
          </div>
        </form>

        {/* Help Section */}
        <div className="mt-6 pt-6 border-t">
          <h4 className="text-sm font-medium mb-2">Need help?</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• Serial number is printed on the controller label</li>
            <li>• Passcode is provided in the controller documentation</li>
            <li>• Contact support if you have issues claiming</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
