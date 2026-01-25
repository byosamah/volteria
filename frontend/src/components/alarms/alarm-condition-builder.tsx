"use client";

/**
 * Alarm Condition Builder Component
 *
 * Reusable component for building threshold conditions for alarms.
 * Each condition has: operator, value, severity, and message.
 *
 * Used in:
 * - Controller template alarm definitions
 * - Device template alarm definitions
 * - Site alarm override configuration
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AlarmCondition, AlarmSeverity, ThresholdOperator } from "@/lib/types";

// Props for a single condition row
interface ConditionRowProps {
  condition: AlarmCondition;
  index: number;
  onChange: (index: number, field: keyof AlarmCondition, value: unknown) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

// Severity colors for visual indication
const severityColors: Record<AlarmSeverity, string> = {
  info: "bg-blue-100 text-blue-800 border-blue-200",
  warning: "bg-yellow-100 text-yellow-800 border-yellow-200",
  minor: "bg-amber-100 text-amber-800 border-amber-200",
  major: "bg-orange-100 text-orange-800 border-orange-200",
  critical: "bg-red-100 text-red-800 border-red-200",
};

/**
 * Single condition row with operator, value, severity, and message
 */
export function AlarmConditionRow({
  condition,
  index,
  onChange,
  onRemove,
  disabled = false,
}: ConditionRowProps) {
  return (
    <div className="flex flex-wrap gap-2 items-center p-2 bg-muted/30 rounded-lg">
      {/* Operator selector */}
      <select
        value={condition.operator}
        onChange={(e) => onChange(index, "operator", e.target.value as ThresholdOperator)}
        className="h-9 px-2 rounded border bg-background text-sm w-16"
        disabled={disabled}
      >
        <option value=">">&gt;</option>
        <option value=">=">&gt;=</option>
        <option value="<">&lt;</option>
        <option value="<=">&lt;=</option>
        <option value="==">==</option>
        <option value="!=">!=</option>
      </select>

      {/* Threshold value */}
      <Input
        type="number"
        value={condition.value}
        onChange={(e) => onChange(index, "value", parseFloat(e.target.value) || 0)}
        className="h-9 w-20"
        placeholder="Value"
        disabled={disabled}
      />

      {/* Severity selector */}
      <select
        value={condition.severity}
        onChange={(e) => onChange(index, "severity", e.target.value as AlarmSeverity)}
        className={`h-9 px-2 rounded border text-sm w-24 ${severityColors[condition.severity]}`}
        disabled={disabled}
      >
        <option value="info">Info</option>
        <option value="warning">Warning</option>
        <option value="minor">Minor</option>
        <option value="major">Major</option>
        <option value="critical">Critical</option>
      </select>

      {/* Alert message */}
      <Input
        value={condition.message}
        onChange={(e) => onChange(index, "message", e.target.value)}
        className="h-9 flex-1 min-w-[150px]"
        placeholder="Alert message..."
        disabled={disabled}
      />

      {/* Remove button */}
      {!disabled && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0 text-destructive hover:text-destructive"
          onClick={() => onRemove(index)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-4 w-4"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </Button>
      )}
    </div>
  );
}

// Props for the condition builder
interface AlarmConditionBuilderProps {
  conditions: AlarmCondition[];
  onChange: (conditions: AlarmCondition[]) => void;
  disabled?: boolean;
}

// Empty condition template
const emptyCondition: AlarmCondition = {
  operator: ">",
  value: 0,
  severity: "warning",
  message: "",
};

/**
 * Alarm Condition Builder
 *
 * Manages a list of threshold conditions for an alarm definition.
 * Supports adding, editing, and removing conditions.
 */
export function AlarmConditionBuilder({
  conditions,
  onChange,
  disabled = false,
}: AlarmConditionBuilderProps) {
  // Add new condition
  const addCondition = () => {
    onChange([...conditions, { ...emptyCondition }]);
  };

  // Update a condition field
  const updateCondition = (
    index: number,
    field: keyof AlarmCondition,
    value: unknown
  ) => {
    const newConditions = [...conditions];
    newConditions[index] = { ...newConditions[index], [field]: value };
    onChange(newConditions);
  };

  // Remove a condition
  const removeCondition = (index: number) => {
    onChange(conditions.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {conditions.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No conditions defined. Add at least one condition.
        </p>
      ) : (
        conditions.map((condition, index) => (
          <AlarmConditionRow
            key={index}
            condition={condition}
            index={index}
            onChange={updateCondition}
            onRemove={removeCondition}
            disabled={disabled}
          />
        ))
      )}

      {!disabled && (
        <Button type="button" variant="outline" size="sm" onClick={addCondition}>
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
          Add Condition
        </Button>
      )}
    </div>
  );
}
