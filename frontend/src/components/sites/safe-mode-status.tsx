"use client";

/**
 * Safe Mode Status Panel
 *
 * Shows the current safe mode status for a site:
 * - Whether safe mode is currently active
 * - Safe mode configuration (type, threshold, timeout)
 * - Visual indicator with color coding
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SafeModeStatusProps {
  isActive: boolean;
  safeModeEnabled: boolean;
  safeModeType: string | null;
  safeModeTimeout: number | null;
  safeModeThreshold: number | null;
  safeModePowerLimit: number | null;
}

// Format safe mode type for display
function formatSafeModeType(type: string | null): string {
  switch (type) {
    case "communication_loss":
      return "Communication Loss";
    case "sensor_failure":
      return "Sensor Failure";
    case "power_threshold":
      return "Power Threshold";
    case "manual":
      return "Manual Trigger";
    default:
      return type || "Not configured";
  }
}

export function SafeModeStatus({
  isActive,
  safeModeEnabled,
  safeModeType,
  safeModeTimeout,
  safeModeThreshold,
  safeModePowerLimit,
}: SafeModeStatusProps) {
  return (
    <Card className={isActive ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              {/* Shield icon */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`h-5 w-5 ${isActive ? "text-red-600" : "text-muted-foreground"}`}
              >
                <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
              </svg>
              Safe Mode
            </CardTitle>
            <CardDescription>
              {safeModeEnabled ? "Protection system enabled" : "Protection system disabled"}
            </CardDescription>
          </div>
          {/* Status Badge */}
          {isActive ? (
            <Badge variant="destructive" className="animate-pulse">
              <span className="mr-1">●</span> ACTIVE
            </Badge>
          ) : safeModeEnabled ? (
            <Badge variant="outline" className="border-green-500 text-green-600">
              <span className="mr-1">●</span> Ready
            </Badge>
          ) : (
            <Badge variant="secondary">Disabled</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isActive && (
          <div className="mb-4 p-3 rounded-lg bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200">
            <p className="font-medium">Safe mode is currently active!</p>
            <p className="text-sm mt-1">
              Solar output is limited to {safeModePowerLimit || 0}% to protect equipment.
            </p>
          </div>
        )}

        {safeModeEnabled ? (
          <div className="grid grid-cols-2 gap-4 text-sm">
            {/* Trigger Type */}
            <div>
              <p className="text-muted-foreground">Trigger Type</p>
              <p className="font-medium">{formatSafeModeType(safeModeType)}</p>
            </div>

            {/* Timeout */}
            <div>
              <p className="text-muted-foreground">Timeout</p>
              <p className="font-medium">
                {safeModeTimeout ? `${safeModeTimeout}s` : "Not set"}
              </p>
            </div>

            {/* Threshold */}
            <div>
              <p className="text-muted-foreground">Threshold</p>
              <p className="font-medium">
                {safeModeThreshold ? `${safeModeThreshold} kW` : "Not set"}
              </p>
            </div>

            {/* Power Limit */}
            <div>
              <p className="text-muted-foreground">Power Limit</p>
              <p className="font-medium">
                {safeModePowerLimit ? `${safeModePowerLimit}%` : "0%"}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Safe mode is disabled. Enable it in site settings to protect your equipment
            during communication failures or abnormal conditions.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
