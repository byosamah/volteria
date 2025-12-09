"use client";

/**
 * Step 6: Safe Mode Settings
 *
 * Configure communication safe mode:
 * - Enable/disable safe mode
 * - Type: Time-based or Rolling Average
 * - Timeout, window, threshold parameters
 * - Power limit during safe mode
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { StepProps, SafeModeType } from "../wizard-types";

export function StepSafeMode({ formData, updateField }: StepProps) {
  return (
    <div className="space-y-6">
      {/* Enable Safe Mode Toggle */}
      <div className="flex items-center justify-between p-4 rounded-lg border">
        <div className="space-y-1">
          <Label htmlFor="safe-mode-enabled" className="cursor-pointer text-base font-medium">
            Enable Communication Safe Mode
          </Label>
          <p className="text-sm text-muted-foreground">
            Automatically reduce solar output if communication with devices fails.
          </p>
        </div>
        <Switch
          id="safe-mode-enabled"
          checked={formData.safeModeEnabled}
          onCheckedChange={(checked) => updateField("safeModeEnabled", checked)}
        />
      </div>

      {/* Safe Mode Configuration (only shown when enabled) */}
      {formData.safeModeEnabled && (
        <div className="space-y-6 pl-4 border-l-2 border-primary/30">
          {/* Safe Mode Type */}
          <div className="space-y-3">
            <Label>Safe Mode Type</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              {/* Time-based Option */}
              <button
                type="button"
                onClick={() => updateField("safeModeType", "time_based")}
                className={`
                  p-4 rounded-lg border-2 text-left transition-all
                  ${formData.safeModeType === "time_based"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/50"
                  }
                `}
              >
                <div className="flex items-start gap-3">
                  <div className={`
                    w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5
                    ${formData.safeModeType === "time_based"
                      ? "border-primary"
                      : "border-muted-foreground/50"
                    }
                  `}>
                    {formData.safeModeType === "time_based" && (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <div>
                    <span className="font-medium">Time-based</span>
                    <p className="text-xs text-muted-foreground mt-1">
                      Triggers safe mode after X seconds without valid readings.
                    </p>
                  </div>
                </div>
              </button>

              {/* Rolling Average Option */}
              <button
                type="button"
                onClick={() => updateField("safeModeType", "rolling_average")}
                className={`
                  p-4 rounded-lg border-2 text-left transition-all
                  ${formData.safeModeType === "rolling_average"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/50"
                  }
                `}
              >
                <div className="flex items-start gap-3">
                  <div className={`
                    w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5
                    ${formData.safeModeType === "rolling_average"
                      ? "border-primary"
                      : "border-muted-foreground/50"
                    }
                  `}>
                    {formData.safeModeType === "rolling_average" && (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <div>
                    <span className="font-medium">Rolling Average</span>
                    <p className="text-xs text-muted-foreground mt-1">
                      Triggers when successful readings fall below threshold over time window.
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Time-based Settings */}
          {formData.safeModeType === "time_based" && (
            <div className="space-y-2">
              <Label htmlFor="timeout">
                Timeout (seconds) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="timeout"
                type="number"
                min={5}
                max={300}
                step={1}
                value={formData.safeModeTimeoutS}
                onChange={(e) => updateField("safeModeTimeoutS", Number(e.target.value))}
                className="min-h-[44px]"
              />
              <p className="text-xs text-muted-foreground">
                How many seconds without valid readings before safe mode activates (min: 5 seconds).
              </p>
            </div>
          )}

          {/* Rolling Average Settings */}
          {formData.safeModeType === "rolling_average" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="rolling-window">
                  Rolling Window (minutes) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="rolling-window"
                  type="number"
                  min={1}
                  max={30}
                  step={1}
                  value={formData.safeModeRollingWindowMin}
                  onChange={(e) => updateField("safeModeRollingWindowMin", Number(e.target.value))}
                  className="min-h-[44px]"
                />
                <p className="text-xs text-muted-foreground">
                  Time window to calculate the success rate (1-30 minutes).
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="threshold">
                  Success Threshold (%) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="threshold"
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={formData.safeModeThresholdPct}
                  onChange={(e) => updateField("safeModeThresholdPct", Number(e.target.value))}
                  className="min-h-[44px]"
                />
                <p className="text-xs text-muted-foreground">
                  Safe mode activates when success rate falls below this percentage.
                </p>
              </div>
            </div>
          )}

          {/* Power Limit */}
          <div className="space-y-2">
            <Label htmlFor="power-limit">Safe Mode Power Limit (kW)</Label>
            <Input
              id="power-limit"
              type="number"
              min={0}
              step={1}
              value={formData.safeModePowerLimitKw}
              onChange={(e) => updateField("safeModePowerLimitKw", Number(e.target.value))}
              className="min-h-[44px]"
            />
            <p className="text-xs text-muted-foreground">
              Maximum solar output allowed during safe mode.
              Set to 0 to completely stop solar output. Leave empty for no limit.
            </p>
          </div>

          {/* Explanation box */}
          <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
            <div className="flex items-start gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              <div className="text-sm text-blue-800">
                <strong>How it works:</strong>
                {formData.safeModeType === "time_based" ? (
                  <p className="mt-1">
                    If no valid device readings are received for <strong>{formData.safeModeTimeoutS} seconds</strong>,
                    the system will limit solar output to <strong>{formData.safeModePowerLimitKw || "0"} kW</strong>{" "}
                    to prevent reverse feeding.
                  </p>
                ) : (
                  <p className="mt-1">
                    If less than <strong>{formData.safeModeThresholdPct}%</strong> of readings are successful over
                    the last <strong>{formData.safeModeRollingWindowMin} minutes</strong>,
                    solar output will be limited to <strong>{formData.safeModePowerLimitKw || "0"} kW</strong>.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Warning when safe mode is disabled */}
      {!formData.safeModeEnabled && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200">
          <div className="flex items-start gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <div>
              <p className="text-sm font-medium text-red-800">Safe Mode Disabled</p>
              <p className="text-sm text-red-700 mt-1">
                Without safe mode, communication failures could cause uncontrolled solar output
                and potential reverse feeding to generators. This is <strong>not recommended</strong>.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
