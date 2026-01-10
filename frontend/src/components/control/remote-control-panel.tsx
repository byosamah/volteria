/**
 * Remote Control Panel Component
 *
 * ⚠️ PHASE 3 - Remote Control UI
 *
 * Client component that allows adjusting:
 * - Inverter power limit (0-100%) via slider
 * - DG reserve in kW via number input
 *
 * Sends commands to the controller via the API.
 * Commands are queued if controller is offline.
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Zap, Gauge, Loader2, Check, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Props for the RemoteControlPanel
interface RemoteControlPanelProps {
  siteId: string;
  projectId: string;
  currentDgReserve: number;     // Current DG reserve in kW
  currentPowerLimit: number;     // Current power limit percentage (0-100)
  isOnline: boolean;             // Whether controller is online
}

export function RemoteControlPanel({
  siteId,
  projectId,
  currentDgReserve,
  currentPowerLimit,
  isOnline,
}: RemoteControlPanelProps) {
  // Local state for form values
  const [powerLimit, setPowerLimit] = useState(currentPowerLimit);
  const [dgReserve, setDgReserve] = useState(currentDgReserve);

  // Sync local state when props change (e.g., after page refresh or parent re-fetch)
  // This prevents stale closure where local state doesn't match server values
  useEffect(() => {
    setPowerLimit(currentPowerLimit);
  }, [currentPowerLimit]);

  useEffect(() => {
    setDgReserve(currentDgReserve);
  }, [currentDgReserve]);

  // Refs for timeout cleanup (prevents memory leak on unmount)
  const powerSuccessTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dgSuccessTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (powerSuccessTimeoutRef.current) clearTimeout(powerSuccessTimeoutRef.current);
      if (dgSuccessTimeoutRef.current) clearTimeout(dgSuccessTimeoutRef.current);
    };
  }, []);

  // Submission states
  const [submittingPower, setSubmittingPower] = useState(false);
  const [submittingDg, setSubmittingDg] = useState(false);
  const [powerSuccess, setPowerSuccess] = useState(false);
  const [dgSuccess, setDgSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handle power limit submission
  async function handlePowerLimitSubmit() {
    setSubmittingPower(true);
    setError(null);
    setPowerSuccess(false);

    try {
      const supabase = createClient();

      // Update the site's power limit setting
      const { error: updateError } = await supabase
        .from("sites")
        .update({ safe_mode_power_limit_pct: powerLimit })
        .eq("id", siteId);

      if (updateError) throw updateError;

      // Log the command for audit trail
      await supabase.from("control_commands").insert({
        site_id: siteId,
        project_id: projectId,
        command_type: "set_power_limit",
        command_value: { power_limit_pct: powerLimit },
        status: isOnline ? "sent" : "queued",
      });

      setPowerSuccess(true);
      // Clear success indicator after 3 seconds (with cleanup on unmount)
      if (powerSuccessTimeoutRef.current) clearTimeout(powerSuccessTimeoutRef.current);
      powerSuccessTimeoutRef.current = setTimeout(() => setPowerSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to set power limit:", err);
      setError("Failed to update power limit. Please try again.");
    } finally {
      setSubmittingPower(false);
    }
  }

  // Handle DG reserve submission
  async function handleDgReserveSubmit() {
    setSubmittingDg(true);
    setError(null);
    setDgSuccess(false);

    try {
      const supabase = createClient();

      // Update the site's DG reserve setting
      const { error: updateError } = await supabase
        .from("sites")
        .update({ dg_reserve_kw: dgReserve })
        .eq("id", siteId);

      if (updateError) throw updateError;

      // Log the command for audit trail
      await supabase.from("control_commands").insert({
        site_id: siteId,
        project_id: projectId,
        command_type: "set_dg_reserve",
        command_value: { dg_reserve_kw: dgReserve },
        status: isOnline ? "sent" : "queued",
      });

      setDgSuccess(true);
      // Clear success indicator after 3 seconds (with cleanup on unmount)
      if (dgSuccessTimeoutRef.current) clearTimeout(dgSuccessTimeoutRef.current);
      dgSuccessTimeoutRef.current = setTimeout(() => setDgSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to set DG reserve:", err);
      setError("Failed to update DG reserve. Please try again.");
    } finally {
      setSubmittingDg(false);
    }
  }

  // Check if power limit has changed from current value
  const powerLimitChanged = powerLimit !== currentPowerLimit;
  // Check if DG reserve has changed from current value
  const dgReserveChanged = dgReserve !== currentDgReserve;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="h-5 w-5 text-primary" />
          Control Settings
        </CardTitle>
        <CardDescription>
          Adjust power limits and DG reserve settings remotely
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Error display */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-md text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Power Limit Control */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-500" />
              Inverter Power Limit
            </Label>
            <span className="text-2xl font-bold text-primary">{powerLimit}%</span>
          </div>

          {/* Slider for power limit (0-100%) */}
          <Slider
            value={[powerLimit]}
            onValueChange={(values) => setPowerLimit(values[0])}
            max={100}
            min={0}
            step={5}
            className="py-2"
          />

          {/* Quick preset buttons */}
          <div className="flex gap-2 flex-wrap" role="group" aria-label="Power limit presets">
            {[0, 25, 50, 75, 100].map((preset) => (
              <Button
                key={preset}
                variant={powerLimit === preset ? "default" : "outline"}
                size="sm"
                onClick={() => setPowerLimit(preset)}
                className="min-h-[44px] min-w-[44px]"
                aria-label={`Set power limit to ${preset}%`}
                aria-pressed={powerLimit === preset}
              >
                {preset}%
              </Button>
            ))}
          </div>

          {/* Apply button */}
          <Button
            onClick={handlePowerLimitSubmit}
            disabled={!powerLimitChanged || submittingPower}
            className="w-full min-h-[44px]"
          >
            {submittingPower ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Applying...
              </>
            ) : powerSuccess ? (
              <>
                <Check className="h-4 w-4 mr-2" />
                Applied!
              </>
            ) : (
              "Apply Power Limit"
            )}
          </Button>
        </div>

        {/* Divider */}
        <div className="border-t" />

        {/* Generator Reserve Control */}
        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-gray-500" />
            Generator Reserve (kW)
          </Label>

          <div className="flex gap-2">
            <Input
              type="number"
              value={dgReserve}
              onChange={(e) => setDgReserve(Number(e.target.value))}
              min={0}
              max={1000}
              step={1}
              className="min-h-[44px] flex-1"
              placeholder="Enter generator reserve in kW"
            />
            <Button
              onClick={handleDgReserveSubmit}
              disabled={!dgReserveChanged || submittingDg}
              className="min-h-[44px]"
            >
              {submittingDg ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : dgSuccess ? (
                <Check className="h-4 w-4" />
              ) : (
                "Apply"
              )}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Minimum power the generator should maintain. Solar output will be limited to prevent reverse feeding.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
