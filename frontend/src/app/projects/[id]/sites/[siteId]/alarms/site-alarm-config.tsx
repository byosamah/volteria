"use client";

/**
 * Site Alarm Configuration Component
 *
 * Client component for managing site-level alarm overrides.
 * Displays alarms from controller and device templates with the ability to:
 * - Enable/disable alarms per site
 * - Override threshold conditions
 * - Reset to template defaults
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlarmConditionBuilder } from "@/components/alarms";
import type { AlarmDefinition, AlarmCondition, SiteAlarmOverride } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

// Combined alarm source with template info
interface AlarmSource {
  source_type: "controller_template" | "device_template" | "device";
  source_id: string;
  source_name: string;
  alarms: AlarmDefinition[];
}

// Props for the site alarm config component
interface SiteAlarmConfigProps {
  siteId: string;
  alarmSources: AlarmSource[];
  existingOverrides: SiteAlarmOverride[];
  canEdit: boolean;
}

// Severity colors for visual indication
const severityColors: Record<string, string> = {
  info: "bg-blue-100 text-blue-800 border-blue-200",
  warning: "bg-yellow-100 text-yellow-800 border-yellow-200",
  minor: "bg-amber-100 text-amber-800 border-amber-200",
  major: "bg-orange-100 text-orange-800 border-orange-200",
  critical: "bg-red-100 text-red-800 border-red-200",
};

// Source type labels for display
const sourceTypeLabels: Record<string, string> = {
  controller_template: "Controller",
  device_template: "Device Template",
  device: "Device",
};

/**
 * Site Alarm Configuration
 *
 * Main component for viewing and editing site-level alarm configurations.
 */
export function SiteAlarmConfig({
  siteId,
  alarmSources,
  existingOverrides,
  canEdit,
}: SiteAlarmConfigProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [overrides, setOverrides] = useState<SiteAlarmOverride[]>(existingOverrides);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(
    new Set(alarmSources.map((s) => s.source_id))
  );

  // Edit dialog state
  const [editingAlarm, setEditingAlarm] = useState<{
    source: AlarmSource;
    alarm: AlarmDefinition;
    override: SiteAlarmOverride | null;
  } | null>(null);
  const [editConditions, setEditConditions] = useState<AlarmCondition[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Get override for a specific alarm
  const getOverride = (
    sourceType: string,
    sourceId: string,
    alarmId: string
  ): SiteAlarmOverride | undefined => {
    return overrides.find(
      (o) =>
        o.source_type === sourceType &&
        o.source_id === sourceId &&
        o.alarm_definition_id === alarmId
    );
  };

  // Check if alarm has customizations
  const isCustomized = (override: SiteAlarmOverride | undefined): boolean => {
    if (!override) return false;
    return override.conditions_override !== null || override.enabled !== null;
  };

  // Get effective enabled state
  const getEffectiveEnabled = (
    alarm: AlarmDefinition,
    override: SiteAlarmOverride | undefined
  ): boolean => {
    if (override?.enabled !== null && override?.enabled !== undefined) {
      return override.enabled;
    }
    return alarm.enabled_by_default;
  };

  // Get effective conditions
  const getEffectiveConditions = (
    alarm: AlarmDefinition,
    override: SiteAlarmOverride | undefined
  ): AlarmCondition[] => {
    if (override?.conditions_override) {
      return override.conditions_override;
    }
    return alarm.conditions;
  };

  // Toggle source expansion
  const toggleSource = (sourceId: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  };

  // Handle alarm enable/disable toggle
  const handleToggleEnabled = async (
    source: AlarmSource,
    alarm: AlarmDefinition,
    enabled: boolean
  ) => {
    if (!canEdit) return;

    setIsSaving(true);
    const supabase = createClient();

    try {
      const existingOverride = getOverride(source.source_type, source.source_id, alarm.id);

      if (existingOverride) {
        // Update existing override
        const { error } = await supabase
          .from("site_alarm_overrides")
          .update({ enabled, updated_at: new Date().toISOString() })
          .eq("id", existingOverride.id);

        if (error) throw error;

        // Update local state
        setOverrides((prev) =>
          prev.map((o) =>
            o.id === existingOverride.id ? { ...o, enabled } : o
          )
        );
      } else {
        // Create new override
        const newOverride = {
          site_id: siteId,
          source_type: source.source_type,
          source_id: source.source_id,
          alarm_definition_id: alarm.id,
          enabled,
          conditions_override: null,
          cooldown_seconds_override: null,
        };

        const { data, error } = await supabase
          .from("site_alarm_overrides")
          .insert(newOverride)
          .select()
          .single();

        if (error) throw error;

        // Update local state
        setOverrides((prev) => [...prev, data as SiteAlarmOverride]);
      }

      // Refresh the page data
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      console.error("Failed to toggle alarm:", err);
    } finally {
      setIsSaving(false);
    }
  };

  // Open edit dialog for threshold conditions
  const openEditDialog = (
    source: AlarmSource,
    alarm: AlarmDefinition
  ) => {
    const override = getOverride(source.source_type, source.source_id, alarm.id);
    const conditions = getEffectiveConditions(alarm, override);
    setEditConditions([...conditions]);
    setEditingAlarm({ source, alarm, override: override || null });
  };

  // Save threshold overrides
  const saveThresholdOverrides = async () => {
    if (!editingAlarm || !canEdit) return;

    setIsSaving(true);
    const supabase = createClient();
    const { source, alarm, override } = editingAlarm;

    try {
      if (override) {
        // Update existing override
        const { error } = await supabase
          .from("site_alarm_overrides")
          .update({
            conditions_override: editConditions,
            updated_at: new Date().toISOString(),
          })
          .eq("id", override.id);

        if (error) throw error;

        // Update local state
        setOverrides((prev) =>
          prev.map((o) =>
            o.id === override.id
              ? { ...o, conditions_override: editConditions }
              : o
          )
        );
      } else {
        // Create new override with conditions
        const newOverride = {
          site_id: siteId,
          source_type: source.source_type,
          source_id: source.source_id,
          alarm_definition_id: alarm.id,
          enabled: null,
          conditions_override: editConditions,
          cooldown_seconds_override: null,
        };

        const { data, error } = await supabase
          .from("site_alarm_overrides")
          .insert(newOverride)
          .select()
          .single();

        if (error) throw error;

        // Update local state
        setOverrides((prev) => [...prev, data as SiteAlarmOverride]);
      }

      // Close dialog and refresh
      setEditingAlarm(null);
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      console.error("Failed to save thresholds:", err);
    } finally {
      setIsSaving(false);
    }
  };

  // Reset alarm to template defaults
  const resetToDefault = async (
    source: AlarmSource,
    alarm: AlarmDefinition
  ) => {
    if (!canEdit) return;

    const override = getOverride(source.source_type, source.source_id, alarm.id);
    if (!override) return;

    setIsSaving(true);
    const supabase = createClient();

    try {
      // Delete the override
      const { error } = await supabase
        .from("site_alarm_overrides")
        .delete()
        .eq("id", override.id);

      if (error) throw error;

      // Update local state
      setOverrides((prev) => prev.filter((o) => o.id !== override.id));

      // Refresh the page data
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      console.error("Failed to reset alarm:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Alarm Sources */}
      {alarmSources.map((source) => {
        const isExpanded = expandedSources.has(source.source_id);

        return (
          <Card key={`${source.source_type}-${source.source_id}`}>
            <Collapsible open={isExpanded} onOpenChange={() => toggleSource(source.source_id)}>
              <CardHeader className="py-4">
                <CollapsibleTrigger className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-3">
                    {/* Expand/collapse icon */}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>

                    <div className="text-left">
                      <CardTitle className="text-base">{source.source_name}</CardTitle>
                      <CardDescription>
                        {sourceTypeLabels[source.source_type]} • {source.alarms.length} alarm
                        {source.alarms.length !== 1 ? "s" : ""}
                      </CardDescription>
                    </div>
                  </div>

                  <Badge variant="outline">
                    {sourceTypeLabels[source.source_type]}
                  </Badge>
                </CollapsibleTrigger>
              </CardHeader>

              <CollapsibleContent>
                <CardContent className="pt-0">
                  <div className="space-y-3">
                    {source.alarms.map((alarm) => {
                      const override = getOverride(
                        source.source_type,
                        source.source_id,
                        alarm.id
                      );
                      const customized = isCustomized(override);
                      const enabled = getEffectiveEnabled(alarm, override);
                      const conditions = getEffectiveConditions(alarm, override);

                      return (
                        <div
                          key={alarm.id}
                          className={`p-4 rounded-lg border ${
                            enabled ? "bg-background" : "bg-muted/30"
                          }`}
                        >
                          {/* Alarm header */}
                          <div className="flex items-start justify-between gap-4 mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <h4 className="font-medium">{alarm.name}</h4>
                                {customized && (
                                  <Badge variant="secondary" className="text-xs">
                                    Customized
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">
                                {alarm.description}
                              </p>
                            </div>

                            {/* Enable/disable toggle */}
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">
                                {enabled ? "Enabled" : "Disabled"}
                              </span>
                              <Switch
                                checked={enabled}
                                onCheckedChange={(checked) =>
                                  handleToggleEnabled(source, alarm, checked)
                                }
                                disabled={!canEdit || isSaving || isPending}
                              />
                            </div>
                          </div>

                          {/* Threshold conditions preview */}
                          {enabled && (
                            <div className="space-y-2">
                              <div className="text-sm font-medium text-muted-foreground">
                                Threshold Conditions
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {conditions.map((condition, idx) => (
                                  <Badge
                                    key={idx}
                                    variant="outline"
                                    className={severityColors[condition.severity]}
                                  >
                                    {condition.operator} {condition.value} → {condition.severity}
                                  </Badge>
                                ))}
                                {conditions.length === 0 && (
                                  <span className="text-sm text-muted-foreground italic">
                                    No conditions defined
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Action buttons */}
                          {canEdit && enabled && (
                            <div className="flex items-center gap-2 mt-4 pt-3 border-t">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openEditDialog(source, alarm)}
                                disabled={isSaving || isPending}
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  className="h-3 w-3 mr-1"
                                >
                                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                </svg>
                                Edit Thresholds
                              </Button>

                              {customized && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => resetToDefault(source, alarm)}
                                  disabled={isSaving || isPending}
                                  className="text-muted-foreground hover:text-foreground"
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    className="h-3 w-3 mr-1"
                                  >
                                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                    <path d="M3 3v5h5" />
                                  </svg>
                                  Reset to Default
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        );
      })}

      {/* Edit Thresholds Dialog */}
      <Dialog open={editingAlarm !== null} onOpenChange={() => setEditingAlarm(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Threshold Conditions</DialogTitle>
            <DialogDescription>
              {editingAlarm?.alarm.name} - {editingAlarm?.source.source_name}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <AlarmConditionBuilder
              conditions={editConditions}
              onChange={setEditConditions}
              disabled={isSaving}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingAlarm(null)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={saveThresholdOverrides}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
