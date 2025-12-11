/**
 * Efficiency Metrics Card Component
 *
 * ⚠️ PHASE 4 - Reporting & Analytics
 *
 * Displays key efficiency metrics:
 * - Solar utilization percentage
 * - Safe mode frequency
 * - Operational insights
 */

"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, Shield, Activity, CheckCircle, AlertTriangle } from "lucide-react";

// Props for the EfficiencyMetricsCard
interface EfficiencyMetricsCardProps {
  avgSolarLimit: number;        // Average solar limit percentage
  safeModePercentage: number;   // Percentage of time in safe mode
  totalRecords: number;         // Total records analyzed
}

export function EfficiencyMetricsCard({
  avgSolarLimit,
  safeModePercentage,
  totalRecords,
}: EfficiencyMetricsCardProps) {
  // Determine efficiency rating
  const getEfficiencyRating = () => {
    if (avgSolarLimit >= 90) return { label: "Excellent", color: "text-green-600 bg-green-100" };
    if (avgSolarLimit >= 70) return { label: "Good", color: "text-blue-600 bg-blue-100" };
    if (avgSolarLimit >= 50) return { label: "Moderate", color: "text-yellow-600 bg-yellow-100" };
    return { label: "Low", color: "text-red-600 bg-red-100" };
  };

  // Determine safe mode status
  const getSafeModeStatus = () => {
    if (safeModePercentage <= 1) return { label: "Minimal", color: "text-green-600" };
    if (safeModePercentage <= 5) return { label: "Low", color: "text-blue-600" };
    if (safeModePercentage <= 15) return { label: "Moderate", color: "text-yellow-600" };
    return { label: "High", color: "text-red-600" };
  };

  const efficiencyRating = getEfficiencyRating();
  const safeModeStatus = getSafeModeStatus();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Efficiency Metrics
        </CardTitle>
        <CardDescription>
          System performance analysis based on {totalRecords.toLocaleString()} data points
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {/* Solar Utilization */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-500" />
                Solar Utilization
              </span>
              <Badge className={efficiencyRating.color}>
                {efficiencyRating.label}
              </Badge>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Avg. Power Limit</span>
                <span className="font-medium">{avgSolarLimit.toFixed(1)}%</span>
              </div>
              <Progress value={avgSolarLimit} className="h-2" />
            </div>
            <p className="text-xs text-muted-foreground">
              {avgSolarLimit >= 90
                ? "Solar is operating at near-full capacity"
                : avgSolarLimit >= 70
                  ? "Good solar utilization with some limiting"
                  : "Solar output is being limited to prevent reverse feeding"}
            </p>
          </div>

          {/* Safe Mode Frequency */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium flex items-center gap-2">
                <Shield className="h-4 w-4 text-blue-500" />
                Safe Mode Frequency
              </span>
              <span className={`text-sm font-medium ${safeModeStatus.color}`}>
                {safeModeStatus.label}
              </span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Time in Safe Mode</span>
                <span className="font-medium">{safeModePercentage.toFixed(1)}%</span>
              </div>
              <Progress value={safeModePercentage} className="h-2" />
            </div>
            <p className="text-xs text-muted-foreground">
              {safeModePercentage <= 1
                ? "System rarely enters safe mode"
                : safeModePercentage <= 5
                  ? "Occasional safe mode activations"
                  : "Frequent safe mode may indicate communication issues"}
            </p>
          </div>

          {/* System Health Summary */}
          <div className="space-y-3">
            <span className="text-sm font-medium flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-primary" />
              System Health
            </span>
            <div className="space-y-2">
              {avgSolarLimit >= 70 && safeModePercentage <= 5 ? (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span>Operating optimally</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-yellow-600">
                  <AlertTriangle className="h-4 w-4" />
                  <span>Room for optimization</span>
                </div>
              )}

              {avgSolarLimit < 70 && (
                <p className="text-xs text-muted-foreground">
                  Consider reviewing DG reserve settings to maximize solar output
                </p>
              )}

              {safeModePercentage > 5 && (
                <p className="text-xs text-muted-foreground">
                  Check device communications and network stability
                </p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
