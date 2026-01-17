"use client";

import { cn } from "@/lib/utils";
import type { AggregationType, AggregationGroup, AggregationMethod } from "./types";

interface AggregationSelectorProps {
  value: AggregationType;
  onChange: (value: AggregationType) => void;
  isAuto: boolean;
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

export function AggregationSelector({ value, onChange, isAuto }: AggregationSelectorProps) {
  const { group: selectedGroup, method: selectedMethod } = parseAggregation(value);

  const handleGroupChange = (newGroup: AggregationGroup) => {
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
          {(["raw", "hourly", "daily"] as AggregationGroup[]).map((group) => (
            <button
              key={group}
              onClick={() => handleGroupChange(group)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200",
                selectedGroup === group
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {group === "raw" ? "Raw" : group === "hourly" ? "Hourly" : "Daily"}
            </button>
          ))}
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
