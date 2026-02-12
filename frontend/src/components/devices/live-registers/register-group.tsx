"use client";

/**
 * Register Group Component
 *
 * Collapsible group of registers with a "Request Data" button.
 * Groups can be defined by register.group or auto-chunked.
 *
 * For alarms section: splits each threshold into a separate row
 * showing active/inactive status.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Radio, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { RegisterRow } from "./register-row";
import type { RegisterGroupProps } from "./types";
import { getSeverityColor } from "./types";
import type { AlarmThreshold } from "@/lib/types";

// Check if a threshold condition is met
function isThresholdActive(value: number | string | undefined, threshold: AlarmThreshold): boolean {
  if (value === undefined || typeof value === "string") return false;

  switch (threshold.operator) {
    case ">": return value > threshold.value;
    case ">=": return value >= threshold.value;
    case "<": return value < threshold.value;
    case "<=": return value <= threshold.value;
    case "==": return value === threshold.value;
    case "!=": return value !== threshold.value;
    default: return false;
  }
}

// Format value for display
function formatValue(value: number | string, decimals?: number): string {
  if (typeof value === "string") return value;
  const d = decimals ?? 2;
  return value.toFixed(d);
}

export function RegisterGroup({
  group,
  section,
  isLoading,
  registerValues,
  pendingWrites,
  writeStatus,
  onRequestData,
  onWriteValue,
  onPendingWriteChange,
}: RegisterGroupProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Generate key for a register
  const getRegisterKey = (address: number) => `${section}-${address}`;

  // For alarms section, count total alarm rows (one per threshold)
  const alarmRowCount = section === "alarms"
    ? group.registers.reduce((sum, reg) => {
        const thresholdCount = reg.thresholds?.length || 0;
        return sum + (thresholdCount > 0 ? thresholdCount : 1);
      }, 0)
    : group.registers.length;

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Group Header */}
      <div
        className="flex items-center justify-between p-3 bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="p-1 rounded hover:bg-muted"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          <span className="font-medium">{group.name}</span>
          <span className="text-sm text-muted-foreground">
            ({section === "alarms" ? `${alarmRowCount} alarms` : `${group.registers.length} registers`})
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onRequestData();
          }}
          disabled={isLoading}
          className="min-h-[36px]"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Reading...
            </>
          ) : (
            <>
              <Radio className="h-4 w-4 mr-2" />
              Request Data
            </>
          )}
        </Button>
      </div>

      {/* Registers Table - Different layout for alarms */}
      {isExpanded && section === "alarms" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col className="w-16" />       {/* Addr */}
              <col className="w-auto" />     {/* Name - flexible */}
              <col className="w-20" />       {/* Value */}
              <col className="w-16" />       {/* Unit */}
              <col className="w-24" />       {/* Condition */}
              <col className="w-24" />       {/* Severity */}
              <col className="w-24" />       {/* Status */}
            </colgroup>
            <thead className="bg-muted/30">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Addr</th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
                <th className="px-3 py-2 text-left font-medium">Unit</th>
                <th className="px-3 py-2 text-left font-medium">Condition</th>
                <th className="px-3 py-2 text-left font-medium">Severity</th>
                <th className="px-3 py-2 text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {group.registers.flatMap((register) => {
                const key = getRegisterKey(register.address);
                const regValue = registerValues.get(key);
                const currentValue = regValue?.scaled_value;

                // If no thresholds, show single row with no condition
                if (!register.thresholds || register.thresholds.length === 0) {
                  return (
                    <tr key={`${key}-no-threshold`} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono text-xs">{register.address}</td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{register.name}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {regValue ? formatValue(currentValue!, register.decimals) : "--"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-sm">
                        {register.unit || ""}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-xs" colSpan={3}>
                        No thresholds configured
                      </td>
                    </tr>
                  );
                }

                // One row per threshold
                return register.thresholds.map((threshold, idx) => {
                  const isActive = isThresholdActive(currentValue, threshold);
                  const isFirstRow = idx === 0;

                  return (
                    <tr
                      key={`${key}-threshold-${idx}`}
                      className={`hover:bg-muted/30 ${isActive ? "bg-red-50/50" : ""}`}
                    >
                      {/* Show address and name only on first row of each register */}
                      <td className="px-3 py-2 font-mono text-xs">
                        {isFirstRow ? register.address : ""}
                      </td>
                      <td className="px-3 py-2">
                        {isFirstRow && (
                          <span className="font-medium">{register.name}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {isFirstRow ? (
                          regValue ? formatValue(currentValue!, register.decimals) : "--"
                        ) : ""}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-sm">
                        {isFirstRow ? register.unit || "" : ""}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="font-mono text-xs">
                          {threshold.operator}{threshold.value}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={`text-xs ${getSeverityColor(threshold.severity)}`}
                        >
                          {threshold.severity}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {regValue ? (
                          isActive ? (
                            <Badge className="bg-red-100 text-red-700 border-red-300 gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300 gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              OK
                            </Badge>
                          )
                        ) : (
                          <span className="text-muted-foreground text-xs">--</span>
                        )}
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Standard Registers Table (non-alarms) */}
      {isExpanded && section !== "alarms" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-20">Addr</th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium w-20">Type</th>
                <th className="px-3 py-2 text-right font-medium w-24">Value</th>
                <th className="px-3 py-2 text-right font-medium w-28">Adjusted</th>
                <th className="px-3 py-2 text-left font-medium w-16">Unit</th>
                <th className="px-3 py-2 text-right font-medium w-36">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {group.registers.map((register) => {
                const key = getRegisterKey(register.address);
                return (
                  <RegisterRow
                    key={key}
                    register={register}
                    section={section}
                    value={registerValues.get(key)}
                    pendingWrite={pendingWrites.get(key)}
                    writeStatus={writeStatus.get(key)}
                    onWriteValue={(value) => onWriteValue(register, value)}
                    onPendingWriteChange={(value) =>
                      onPendingWriteChange(key, value)
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
