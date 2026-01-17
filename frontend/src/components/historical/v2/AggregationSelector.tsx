"use client";

import { cn } from "@/lib/utils";
import type { AggregationType, AggregationGroup, AggregationMethod } from "./types";

interface AggregationSelectorProps {
  value: AggregationType;
  onChange: (value: AggregationType) => void;
  isAuto: boolean;
  availableGroups?: AggregationGroup[]; // Groups available for current date range
}

// Parse aggregation type into group and method
function parseAggregation(type: AggregationType): { group: AggregationGroup; method: AggregationMethod | null } {
  if (type === "raw") return { group: "raw", method: null };
  const [group, method] = type.split("_") as [AggregationGroup, AggregationMethod];
  return { group, method };
}

// Build aggregation type from group and method
function buildAggregation(group: AggregationGroup, method: AggregationMethod | null): AggregationType {
  if (group === "raw") return "raw";
  return `${group}_${method || "avg"}` as AggregationType;
}

export function AggregationSelector({
  value,
  onChange,
  isAuto,
  availableGroups = ["raw", "hourly", "daily"],
}: AggregationSelectorProps) {
  const { group: selectedGroup, method: selectedMethod } = parseAggregation(value);

  const handleGroupChange = (newGroup: AggregationGroup) => {
    // Don't allow selecting unavailable groups
    if (!availableGroups.includes(newGroup)) return;

    if (newGroup === "raw") {
      onChange("raw");
    } else {
      // Keep the same method when switching groups, default to avg
      onChange(buildAggregation(newGroup, selectedMethod || "avg"));
    }
  };

  const handleMethodChange = (newMethod: AggregationMethod) => {
    if (selectedGroup !== "raw") {
      onChange(buildAggregation(selectedGroup, newMethod));
    }
  };

  const allGroups: AggregationGroup[] = ["raw", "hourly", "daily"];

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        Aggregation
        {isAuto && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
            Auto
          </span>
        )}
      </label>

      <div className="flex items-center gap-1.5">
        {/* Time period selector */}
        <div className="flex items-center p-0.5 bg-muted/50 rounded-lg">
          {allGroups.map((group) => {
            const isAvailable = availableGroups.includes(group);
            const isSelected = selectedGroup === group;

            return (
              <button
                key={group}
                onClick={() => handleGroupChange(group)}
                disabled={!isAvailable}
                title={
                  !isAvailable
                    ? `${group === "raw" ? "Raw" : group === "hourly" ? "Hourly" : "Daily"} not available for this date range`
                    : undefined
                }
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200",
                  isSelected
                    ? "bg-background text-foreground shadow-sm"
                    : isAvailable
                    ? "text-muted-foreground hover:text-foreground"
                    : "text-muted-foreground/40 cursor-not-allowed line-through"
                )}
              >
                {group === "raw" ? "Raw" : group === "hourly" ? "Hourly" : "Daily"}
              </button>
            );
          })}
        </div>

        {/* Method selector (only when not raw) */}
        {selectedGroup !== "raw" && (
          <div className="flex items-center p-0.5 bg-muted/50 rounded-lg">
            {(["avg", "min", "max"] as AggregationMethod[]).map((method) => (
              <button
                key={method}
                onClick={() => handleMethodChange(method)}
                className={cn(
                  "px-2.5 py-1.5 text-xs font-medium rounded-md transition-all duration-200",
                  selectedMethod === method
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {method === "avg" ? "Avg" : method === "min" ? "Min" : "Max"}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
