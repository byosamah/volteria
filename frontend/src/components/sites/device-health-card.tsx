"use client";

/**
 * Device Health Summary Card
 *
 * Shows a summary of device health status:
 * - Total devices count
 * - Online vs offline breakdown
 * - Visual progress bar
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface DeviceHealthCardProps {
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
}

export function DeviceHealthCard({
  totalDevices,
  onlineDevices,
  offlineDevices,
}: DeviceHealthCardProps) {
  const healthPercentage = totalDevices > 0 ? Math.round((onlineDevices / totalDevices) * 100) : 0;

  // Determine health status color
  const getHealthColor = () => {
    if (healthPercentage === 100) return "text-green-600";
    if (healthPercentage >= 75) return "text-yellow-600";
    if (healthPercentage >= 50) return "text-orange-600";
    return "text-red-600";
  };

  const getProgressColor = () => {
    if (healthPercentage === 100) return "bg-green-500";
    if (healthPercentage >= 75) return "bg-yellow-500";
    if (healthPercentage >= 50) return "bg-orange-500";
    return "bg-red-500";
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              {/* Activity icon */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5 text-muted-foreground"
              >
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              Device Health
            </CardTitle>
            <CardDescription>
              {totalDevices} device{totalDevices !== 1 ? "s" : ""} configured
            </CardDescription>
          </div>
          {/* Health Percentage Badge */}
          <Badge
            variant="outline"
            className={`text-lg font-bold ${getHealthColor()}`}
          >
            {healthPercentage}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {totalDevices === 0 ? (
          <p className="text-sm text-muted-foreground">
            No devices configured for this site yet.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${getProgressColor()} transition-all duration-500`}
                  style={{ width: `${healthPercentage}%` }}
                />
              </div>
            </div>

            {/* Status Breakdown */}
            <div className="flex items-center justify-between text-sm">
              {/* Online */}
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </span>
                <span className="text-muted-foreground">Online:</span>
                <span className="font-medium text-green-600">{onlineDevices}</span>
              </div>

              {/* Offline */}
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-gray-400"></span>
                </span>
                <span className="text-muted-foreground">Offline:</span>
                <span className="font-medium text-gray-600">{offlineDevices}</span>
              </div>
            </div>

            {/* Warning if any devices offline */}
            {offlineDevices > 0 && (
              <div className="p-2 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900">
                <p className="text-xs text-orange-700 dark:text-orange-300 flex items-center gap-1">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3 w-3"
                  >
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <path d="M12 9v4" />
                    <path d="M12 17h.01" />
                  </svg>
                  {offlineDevices} device{offlineDevices !== 1 ? "s" : ""} not communicating
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
