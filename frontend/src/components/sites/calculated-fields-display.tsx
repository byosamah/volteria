"use client";

/**
 * Calculated Fields Display Component
 *
 * Displays computed calculated field values on the site dashboard.
 * Shows real-time values from controller computations.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CalculationScope, CalculationType } from "@/lib/types";

// Interface for a calculated field value
interface CalculatedFieldValue {
  field_id: string;
  name: string;
  value: number | null;
  unit: string | null;
  scope: CalculationScope;
  calculation_type: CalculationType;
  last_updated: string | null;
}

// Props for the display component
interface CalculatedFieldsDisplayProps {
  fields: CalculatedFieldValue[];
  isLoading?: boolean;
  compact?: boolean; // Use compact layout for smaller displays
}

// Scope icons
const scopeIcons: Record<CalculationScope, React.ReactNode> = {
  controller: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-4 w-4"
    >
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  ),
  device: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-4 w-4"
    >
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
};

// Format value with appropriate precision
function formatValue(value: number | null, unit: string | null): string {
  if (value === null || value === undefined) return "—";

  // Format based on magnitude
  let formatted: string;
  if (Math.abs(value) >= 1000) {
    formatted = value.toLocaleString("en-US", {
      maximumFractionDigits: 1,
    });
  } else if (Math.abs(value) >= 1) {
    formatted = value.toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    });
  } else {
    formatted = value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    });
  }

  return unit ? `${formatted} ${unit}` : formatted;
}

// Format time since last update
function formatTimeSince(timestamp: string | null): string {
  if (!timestamp) return "Never";

  const now = new Date();
  const updated = new Date(timestamp);
  const diffMs = now.getTime() - updated.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

/**
 * Calculated Fields Display
 *
 * Shows calculated field values in a grid layout.
 */
export function CalculatedFieldsDisplay({
  fields,
  isLoading = false,
  compact = false,
}: CalculatedFieldsDisplayProps) {
  // Group fields by scope
  const controllerFields = fields.filter((f) => f.scope === "controller");
  const deviceFields = fields.filter((f) => f.scope === "device");

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Calculated Values</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 rounded-lg bg-muted animate-pulse"
              />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // No fields
  if (fields.length === 0) {
    return null; // Don't show empty section
  }

  // Render a single field card
  const renderField = (field: CalculatedFieldValue) => (
    <div
      key={field.field_id}
      className={`p-3 rounded-lg border bg-background ${
        compact ? "flex items-center justify-between" : ""
      }`}
    >
      <div className={compact ? "flex items-center gap-2" : ""}>
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          {scopeIcons[field.scope]}
          <span className="text-xs">{field.name}</span>
        </div>
        <div className={`font-semibold ${compact ? "text-lg" : "text-2xl"}`}>
          {formatValue(field.value, field.unit)}
        </div>
      </div>
      {!compact && field.last_updated && (
        <div className="text-xs text-muted-foreground mt-1">
          Updated {formatTimeSince(field.last_updated)}
        </div>
      )}
    </div>
  );

  // Compact layout
  if (compact) {
    return (
      <div className="space-y-2">
        {fields.map(renderField)}
      </div>
    );
  }

  // Full layout with sections
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Calculated Values</CardTitle>
        <CardDescription>
          Real-time computed values from connected devices
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Controller-level fields */}
        {controllerFields.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-xs">
                Site Totals
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {controllerFields.map(renderField)}
            </div>
          </div>
        )}

        {/* Device-level fields */}
        {deviceFields.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="secondary" className="text-xs">
                Per Device
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {deviceFields.map(renderField)}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Mini Calculated Fields Widget
 *
 * A smaller version for sidebar or compact displays.
 * Shows only the most important fields.
 */
interface MiniCalculatedFieldsProps {
  fields: CalculatedFieldValue[];
  maxFields?: number;
}

export function MiniCalculatedFields({
  fields,
  maxFields = 4,
}: MiniCalculatedFieldsProps) {
  // Show only the first N fields
  const displayFields = fields.slice(0, maxFields);

  if (displayFields.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1">
      {displayFields.map((field) => (
        <div
          key={field.field_id}
          className="flex items-center justify-between py-1"
        >
          <span className="text-xs text-muted-foreground">{field.name}</span>
          <span className="text-sm font-medium">
            {formatValue(field.value, field.unit)}
          </span>
        </div>
      ))}
    </div>
  );
}
