"use client";

/**
 * Alarm Definition Form Component
 *
 * Reusable form for creating and editing alarm definitions.
 * Used in controller templates, device templates, and site configuration.
 *
 * Features:
 * - Alarm identification (ID, name, description)
 * - Source configuration (type and key)
 * - Threshold conditions builder
 * - Default enabled state and cooldown
 */

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AlarmConditionBuilder } from "./alarm-condition-builder";
import type { AlarmDefinition, AlarmCondition, AlarmSourceType } from "@/lib/types";

// Props for the alarm definition form
interface AlarmDefinitionFormProps {
  alarm: AlarmDefinition;
  index: number;
  onChange: (index: number, alarm: AlarmDefinition) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
  showSourceConfig?: boolean; // Whether to show source type/key (false for overrides)
}

// Source type options
const sourceTypeOptions: { value: AlarmSourceType; label: string }[] = [
  { value: "device_info", label: "Device Info" },
  { value: "heartbeat", label: "Heartbeat" },
  { value: "modbus_register", label: "Modbus Register" },
  { value: "calculated_field", label: "Calculated Field" },
];

/**
 * Alarm Definition Form
 *
 * A collapsible card for editing a single alarm definition.
 * Shows alarm details and threshold conditions.
 */
export function AlarmDefinitionForm({
  alarm,
  index,
  onChange,
  onRemove,
  disabled = false,
  showSourceConfig = true,
}: AlarmDefinitionFormProps) {
  const [isOpen, setIsOpen] = useState(true);

  // Update a single field
  const updateField = <K extends keyof AlarmDefinition>(
    field: K,
    value: AlarmDefinition[K]
  ) => {
    if (disabled) return;
    onChange(index, { ...alarm, [field]: value });
  };

  // Update conditions
  const updateConditions = (conditions: AlarmCondition[]) => {
    if (disabled) return;
    onChange(index, { ...alarm, conditions });
  };

  return (
    <Card className="border-l-4 border-l-amber-500">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            {/* Collapsible trigger with alarm name */}
            <CollapsibleTrigger className="flex items-center gap-2 hover:text-primary">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
              <span className="font-medium">{alarm.name || "New Alarm"}</span>
              <Badge variant="outline" className="text-xs">
                {alarm.conditions.length} condition
                {alarm.conditions.length !== 1 ? "s" : ""}
              </Badge>
              {!alarm.enabled_by_default && (
                <Badge variant="secondary" className="text-xs">
                  Disabled by default
                </Badge>
              )}
            </CollapsibleTrigger>

            {/* Remove button */}
            {!disabled && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => onRemove(index)}
              >
                Remove
              </Button>
            )}
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {/* Basic Info Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Alarm ID</Label>
                <Input
                  value={alarm.id}
                  onChange={(e) =>
                    updateField(
                      "id",
                      e.target.value.toLowerCase().replace(/\s+/g, "_")
                    )
                  }
                  placeholder="e.g., high_cpu_temp"
                  className="h-9 font-mono text-sm"
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={alarm.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="e.g., High CPU Temperature"
                  className="h-9"
                  disabled={disabled}
                />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input
                value={alarm.description}
                onChange={(e) => updateField("description", e.target.value)}
                placeholder="Brief description of what this alarm monitors..."
                className="h-9"
                disabled={disabled}
              />
            </div>

            {/* Source Config Row - only shown when creating/editing templates */}
            {showSourceConfig && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Source Type</Label>
                  <select
                    value={alarm.source_type}
                    onChange={(e) =>
                      updateField("source_type", e.target.value as AlarmSourceType)
                    }
                    className="h-9 w-full px-2 rounded border bg-background text-sm"
                    disabled={disabled}
                  >
                    {sourceTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Source Key</Label>
                  <Input
                    value={alarm.source_key}
                    onChange={(e) => updateField("source_key", e.target.value)}
                    placeholder="e.g., cpu_temp_celsius"
                    className="h-9 font-mono text-sm"
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Cooldown (seconds)</Label>
                  <Input
                    type="number"
                    value={alarm.cooldown_seconds}
                    onChange={(e) =>
                      updateField("cooldown_seconds", parseInt(e.target.value) || 0)
                    }
                    className="h-9"
                    min={0}
                    disabled={disabled}
                  />
                </div>
              </div>
            )}

            {/* Enabled by Default - only shown when creating/editing templates */}
            {showSourceConfig && (
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={`enabled-${index}`}
                  checked={alarm.enabled_by_default}
                  onCheckedChange={(checked) =>
                    updateField("enabled_by_default", !!checked)
                  }
                  disabled={disabled}
                />
                <Label
                  htmlFor={`enabled-${index}`}
                  className="text-sm cursor-pointer"
                >
                  Enabled by default when added to site
                </Label>
              </div>
            )}

            {/* Threshold Conditions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Threshold Conditions</Label>
              </div>
              <AlarmConditionBuilder
                conditions={alarm.conditions}
                onChange={updateConditions}
                disabled={disabled}
              />
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// Props for the alarm definitions list
interface AlarmDefinitionsListProps {
  alarms: AlarmDefinition[];
  onChange: (alarms: AlarmDefinition[]) => void;
  disabled?: boolean;
  showSourceConfig?: boolean;
}

// Empty alarm definition template
const emptyAlarmDefinition: AlarmDefinition = {
  id: "",
  name: "",
  description: "",
  source_type: "device_info",
  source_key: "",
  conditions: [],
  enabled_by_default: true,
  cooldown_seconds: 300,
};

/**
 * Alarm Definitions List
 *
 * Manages a list of alarm definitions with add/edit/remove functionality.
 */
export function AlarmDefinitionsList({
  alarms,
  onChange,
  disabled = false,
  showSourceConfig = true,
}: AlarmDefinitionsListProps) {
  // Add new alarm definition
  const addAlarm = () => {
    onChange([
      ...alarms,
      {
        ...emptyAlarmDefinition,
        id: `alarm_${Date.now()}`,
        conditions: [{ operator: ">", value: 0, severity: "warning", message: "" }],
      },
    ]);
  };

  // Update an alarm definition
  const updateAlarm = (index: number, alarm: AlarmDefinition) => {
    onChange(alarms.map((a, i) => (i === index ? alarm : a)));
  };

  // Remove an alarm definition
  const removeAlarm = (index: number) => {
    onChange(alarms.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Define alarms with threshold conditions. These can be customized per-site.
      </p>

      {alarms.length > 0 && (
        <div className="space-y-3">
          {alarms.map((alarm, index) => (
            <AlarmDefinitionForm
              key={index}
              alarm={alarm}
              index={index}
              onChange={updateAlarm}
              onRemove={removeAlarm}
              disabled={disabled}
              showSourceConfig={showSourceConfig}
            />
          ))}
        </div>
      )}

      {!disabled && (
        <Button type="button" variant="outline" size="sm" onClick={addAlarm}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-3 w-3 mr-1"
          >
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          Add Alarm Definition
        </Button>
      )}
    </div>
  );
}
