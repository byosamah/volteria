"use client";

/**
 * Controller Readings Form Component
 *
 * Shared form for selecting and configuring controller health readings.
 * Used in both master device template form and site master device edit dialog.
 *
 * Features:
 * - Checkbox to enable/disable each reading
 * - Logging frequency selector
 * - Storage mode selector (Log/Viz Only)
 * - Expandable alarm configuration with warning/critical thresholds
 * - Connection status alarm section
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// =============================================================================
// TYPES
// =============================================================================

// Storage mode for readings
export type StorageMode = "log" | "viz_only";

// Alarm configuration for a reading
export interface ReadingAlarmConfig {
  enabled: boolean;
  warning_threshold: number | null;
  critical_threshold: number | null;
  warning_operator: ">" | "<";
  critical_operator: ">" | "<";
}

// Reading selection with storage mode, logging frequency, and alarm config
export interface ReadingSelection {
  field_id: string;
  name: string;
  unit: string;
  storage_mode: StorageMode;
  logging_frequency_seconds: number;
  enabled: boolean;
  alarm_config: ReadingAlarmConfig;
}

// Online/Offline status alarm config
export interface StatusAlarmConfig {
  enabled: boolean;
  offline_severity: "warning" | "minor" | "major" | "critical";
}

// Props for the controller readings form
export interface ControllerReadingsFormProps {
  readings: ReadingSelection[];
  onReadingsChange: (readings: ReadingSelection[]) => void;
  statusAlarm: StatusAlarmConfig;
  onStatusAlarmChange: (config: StatusAlarmConfig) => void;
  disabled?: boolean;
  showStatusAlarm?: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

// Logging frequency options (in seconds)
export const LOGGING_FREQUENCY_OPTIONS = [
  { value: 5, label: "5 sec" },
  { value: 10, label: "10 sec" },
  { value: 30, label: "30 sec" },
  { value: 60, label: "1 min" },
  { value: 300, label: "5 min" },
  { value: 600, label: "10 min" },
];

// Default alarm configurations based on reading type
export const getDefaultAlarmConfig = (fieldId: string): ReadingAlarmConfig => {
  switch (fieldId) {
    case "cpu_temp_celsius":
      return {
        enabled: true,
        warning_threshold: 70,
        critical_threshold: 85,
        warning_operator: ">",
        critical_operator: ">",
      };
    case "cpu_usage_pct":
    case "memory_usage_pct":
    case "disk_usage_pct":
      return {
        enabled: true,
        warning_threshold: 80,
        critical_threshold: 95,
        warning_operator: ">",
        critical_operator: ">",
      };
    case "uptime_seconds":
      return {
        enabled: true,
        warning_threshold: 300,
        critical_threshold: 60,
        warning_operator: "<",
        critical_operator: "<",
      };
    default:
      return {
        enabled: false,
        warning_threshold: null,
        critical_threshold: null,
        warning_operator: ">",
        critical_operator: ">",
      };
  }
};

// =============================================================================
// COMPONENT
// =============================================================================

export function ControllerReadingsForm({
  readings,
  onReadingsChange,
  statusAlarm,
  onStatusAlarmChange,
  disabled = false,
  showStatusAlarm = true,
}: ControllerReadingsFormProps) {
  // Track which alarm panels are expanded
  const [expandedAlarms, setExpandedAlarms] = useState<Set<string>>(new Set());

  // Toggle alarm expanded state
  const toggleAlarmExpanded = (fieldId: string) => {
    setExpandedAlarms((prev) => {
      const next = new Set(prev);
      if (next.has(fieldId)) {
        next.delete(fieldId);
      } else {
        next.add(fieldId);
      }
      return next;
    });
  };

  // Toggle a controller reading
  const toggleReading = (fieldId: string) => {
    if (disabled) return;
    onReadingsChange(
      readings.map((f) =>
        f.field_id === fieldId ? { ...f, enabled: !f.enabled } : f
      )
    );
  };

  // Update storage mode for a reading
  const updateStorageMode = (fieldId: string, mode: StorageMode) => {
    if (disabled) return;
    onReadingsChange(
      readings.map((f) =>
        f.field_id === fieldId ? { ...f, storage_mode: mode } : f
      )
    );
  };

  // Update logging frequency for a reading
  const updateLoggingFrequency = (fieldId: string, frequency: number) => {
    if (disabled) return;
    onReadingsChange(
      readings.map((f) =>
        f.field_id === fieldId ? { ...f, logging_frequency_seconds: frequency } : f
      )
    );
  };

  // Update alarm config for a reading
  const updateAlarmConfig = (
    fieldId: string,
    alarmConfig: Partial<ReadingAlarmConfig>
  ) => {
    if (disabled) return;
    onReadingsChange(
      readings.map((f) =>
        f.field_id === fieldId
          ? { ...f, alarm_config: { ...f.alarm_config, ...alarmConfig } }
          : f
      )
    );
  };

  return (
    <div className="space-y-4">
      {/* Readings list */}
      <div className="border rounded-lg divide-y">
        {readings.map((field) => {
          const isExpanded = expandedAlarms.has(field.field_id);
          return (
            <Collapsible
              key={field.field_id}
              open={isExpanded && field.enabled}
              onOpenChange={() => field.enabled && toggleAlarmExpanded(field.field_id)}
            >
              <div className="p-3 hover:bg-muted/30">
                {/* Main row */}
                <div className="flex items-center gap-4">
                  {/* Checkbox */}
                  <Checkbox
                    id={`reading-${field.field_id}`}
                    checked={field.enabled}
                    onCheckedChange={() => toggleReading(field.field_id)}
                    disabled={disabled}
                  />

                  {/* Name and Unit */}
                  <label
                    htmlFor={`reading-${field.field_id}`}
                    className="flex-1 text-sm cursor-pointer"
                  >
                    {field.name}
                    <span className="text-muted-foreground ml-2">
                      ({field.unit})
                    </span>
                  </label>

                  {/* Logging Frequency */}
                  <Select
                    value={field.logging_frequency_seconds.toString()}
                    onValueChange={(value) =>
                      updateLoggingFrequency(field.field_id, parseInt(value))
                    }
                    disabled={!field.enabled || disabled}
                  >
                    <SelectTrigger className="w-[90px] h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LOGGING_FREQUENCY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value.toString()}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Storage Mode Selector */}
                  <Select
                    value={field.storage_mode}
                    onValueChange={(value: StorageMode) =>
                      updateStorageMode(field.field_id, value)
                    }
                    disabled={!field.enabled || disabled}
                  >
                    <SelectTrigger className="w-[100px] h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="log">Log</SelectItem>
                      <SelectItem value="viz_only">Viz Only</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Expand alarm config button */}
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!field.enabled}
                      className="h-8 px-2"
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${
                          isExpanded && field.enabled ? "rotate-180" : ""
                        }`}
                      />
                    </Button>
                  </CollapsibleTrigger>
                </div>

                {/* Alarm configuration (collapsible) */}
                <CollapsibleContent className="mt-3 pl-8 pr-2 space-y-3">
                  <div className="rounded-md border p-3 bg-muted/30">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium">Alarm Configuration</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Enable Alarms</span>
                        <Switch
                          checked={field.alarm_config.enabled}
                          onCheckedChange={(checked) =>
                            updateAlarmConfig(field.field_id, { enabled: checked })
                          }
                          disabled={disabled}
                        />
                      </div>
                    </div>

                    {field.alarm_config.enabled && (
                      <div className="space-y-3">
                        {/* Warning threshold */}
                        <div className="flex items-center gap-3">
                          <span className="w-16 text-sm text-yellow-600 font-medium">Warning</span>
                          <Select
                            value={field.alarm_config.warning_operator}
                            onValueChange={(value: ">" | "<") =>
                              updateAlarmConfig(field.field_id, { warning_operator: value })
                            }
                            disabled={disabled}
                          >
                            <SelectTrigger className="w-16 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value=">">&gt;</SelectItem>
                              <SelectItem value="<">&lt;</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            placeholder="Value"
                            value={field.alarm_config.warning_threshold ?? ""}
                            onChange={(e) =>
                              updateAlarmConfig(field.field_id, {
                                warning_threshold: e.target.value ? parseFloat(e.target.value) : null,
                              })
                            }
                            disabled={disabled}
                            className="w-24 h-8"
                          />
                          <span className="text-sm text-muted-foreground">{field.unit}</span>
                        </div>

                        {/* Critical threshold */}
                        <div className="flex items-center gap-3">
                          <span className="w-16 text-sm text-red-600 font-medium">Critical</span>
                          <Select
                            value={field.alarm_config.critical_operator}
                            onValueChange={(value: ">" | "<") =>
                              updateAlarmConfig(field.field_id, { critical_operator: value })
                            }
                            disabled={disabled}
                          >
                            <SelectTrigger className="w-16 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value=">">&gt;</SelectItem>
                              <SelectItem value="<">&lt;</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            placeholder="Value"
                            value={field.alarm_config.critical_threshold ?? ""}
                            onChange={(e) =>
                              updateAlarmConfig(field.field_id, {
                                critical_threshold: e.target.value ? parseFloat(e.target.value) : null,
                              })
                            }
                            disabled={disabled}
                            className="w-24 h-8"
                          />
                          <span className="text-sm text-muted-foreground">{field.unit}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </div>

      {/* Connection Status Alarm Section */}
      {showStatusAlarm && (
        <>
          {/* Divider */}
          <div className="border-t my-4" />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                Connection Status Alarm
              </h4>
            </div>
            <p className="text-sm text-muted-foreground">
              Alert when controller goes offline.
            </p>

            <div className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4 text-red-600 dark:text-red-400"
                    >
                      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                      <line x1="12" y1="2" x2="12" y2="12" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Controller Offline</p>
                    <p className="text-xs text-muted-foreground">
                      Triggers when no heartbeat received
                    </p>
                  </div>
                </div>
                <Switch
                  checked={statusAlarm.enabled}
                  onCheckedChange={(checked) =>
                    onStatusAlarmChange({ ...statusAlarm, enabled: checked })
                  }
                  disabled={disabled}
                />
              </div>

              {statusAlarm.enabled && (
                <div className="pl-11 space-y-3">
                  {/* Severity */}
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground w-24">Severity</span>
                    <Select
                      value={statusAlarm.offline_severity}
                      onValueChange={(value: "warning" | "minor" | "major" | "critical") =>
                        onStatusAlarmChange({ ...statusAlarm, offline_severity: value })
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger className="w-32 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="warning">
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-yellow-500" />
                            Warning
                          </span>
                        </SelectItem>
                        <SelectItem value="minor">
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                            Minor
                          </span>
                        </SelectItem>
                        <SelectItem value="major">
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-orange-500" />
                            Major
                          </span>
                        </SelectItem>
                        <SelectItem value="critical">
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-red-500" />
                            Critical
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
