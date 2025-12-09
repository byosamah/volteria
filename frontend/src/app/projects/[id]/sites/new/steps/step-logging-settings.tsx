"use client";

/**
 * Step 5: Logging Settings
 *
 * Configure data logging:
 * - Local logging interval
 * - Local data retention
 * - Cloud sync via controller
 * - Gateway logging (only if Gateway API selected)
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { StepProps } from "../wizard-types";

export function StepLoggingSettings({ formData, updateField }: StepProps) {
  // Only show gateway logging option if Gateway API is the control method
  const showGatewayLogging = formData.controlMethod === "gateway_api";

  return (
    <div className="space-y-6">
      {/* Local Logging Interval */}
      <div className="space-y-2">
        <Label htmlFor="logging-interval">
          Local Logging Interval (ms) <span className="text-red-500">*</span>
        </Label>
        <Input
          id="logging-interval"
          type="number"
          min={100}
          max={60000}
          step={100}
          value={formData.loggingLocalIntervalMs}
          onChange={(e) => updateField("loggingLocalIntervalMs", Number(e.target.value))}
          className="min-h-[44px]"
        />
        <p className="text-xs text-muted-foreground">
          How often data is saved locally on the controller (100-60,000 ms).
          Default: 1000 ms (1 second).
        </p>
      </div>

      {/* Local Retention */}
      <div className="space-y-2">
        <Label htmlFor="retention-days">
          Local Data Retention (days) <span className="text-red-500">*</span>
        </Label>
        <Input
          id="retention-days"
          type="number"
          min={1}
          max={90}
          step={1}
          value={formData.loggingLocalRetentionDays}
          onChange={(e) => updateField("loggingLocalRetentionDays", Number(e.target.value))}
          className="min-h-[44px]"
        />
        <p className="text-xs text-muted-foreground">
          How long to keep data on the local controller (1-90 days).
          Older data is automatically deleted.
        </p>

        {/* Quick selection buttons */}
        <div className="mt-2 flex gap-2">
          {[7, 14, 30].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => updateField("loggingLocalRetentionDays", days)}
              className={`
                px-3 py-1 text-xs rounded border transition-all
                ${formData.loggingLocalRetentionDays === days
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-muted hover:border-muted-foreground/50"
                }
              `}
            >
              {days} days
            </button>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t pt-6">
        <h3 className="text-sm font-medium mb-4">Cloud Synchronization</h3>

        {/* Cloud Logging via Controller */}
        <div className="flex items-center justify-between p-4 rounded-lg border">
          <div className="space-y-1">
            <Label htmlFor="cloud-logging" className="cursor-pointer">
              Cloud Logging via Controller
            </Label>
            <p className="text-xs text-muted-foreground">
              Sync data to the cloud database through the on-site controller&apos;s internet connection.
            </p>
          </div>
          <Switch
            id="cloud-logging"
            checked={formData.loggingCloudEnabled}
            onCheckedChange={(checked) => updateField("loggingCloudEnabled", checked)}
          />
        </div>

        {/* Gateway Logging (only visible when Gateway API is selected) */}
        {showGatewayLogging && (
          <div className="mt-3 flex items-center justify-between p-4 rounded-lg border">
            <div className="space-y-1">
              <Label htmlFor="gateway-logging" className="cursor-pointer">
                Cloud Logging via Gateway API
              </Label>
              <p className="text-xs text-muted-foreground">
                Sync data through the Netbiter gateway instead of the controller.
                Useful when controller has no direct internet access.
              </p>
            </div>
            <Switch
              id="gateway-logging"
              checked={formData.loggingGatewayEnabled}
              onCheckedChange={(checked) => updateField("loggingGatewayEnabled", checked)}
            />
          </div>
        )}

        {/* Info message when no cloud logging */}
        {!formData.loggingCloudEnabled && !formData.loggingGatewayEnabled && (
          <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
            <div className="flex items-start gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <div className="text-xs text-amber-800">
                <strong>Warning:</strong> With cloud logging disabled, you won&apos;t be able to
                view historical data in the dashboard. Data will only be stored locally
                on the controller.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Storage estimate */}
      <div className="p-4 rounded-lg bg-muted/50 border">
        <h4 className="text-sm font-medium mb-2">Storage Estimate</h4>
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            • Logging every <strong>{formData.loggingLocalIntervalMs} ms</strong> generates
            approximately <strong>{Math.round(86400000 / formData.loggingLocalIntervalMs).toLocaleString()}</strong>{" "}
            records per day.
          </p>
          <p>
            • With <strong>{formData.loggingLocalRetentionDays} days</strong> retention,
            expect up to <strong>
              {Math.round((86400000 / formData.loggingLocalIntervalMs) * formData.loggingLocalRetentionDays).toLocaleString()}
            </strong>{" "}
            records stored locally.
          </p>
          <p>
            • Typical storage: ~{Math.round(((86400000 / formData.loggingLocalIntervalMs) * formData.loggingLocalRetentionDays * 200) / 1024 / 1024)} MB
          </p>
        </div>
      </div>
    </div>
  );
}
