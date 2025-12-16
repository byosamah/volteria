"use client";

/**
 * Calculated Fields Form Component
 *
 * Allows selecting which calculated fields to include in a controller template.
 * Shows available system fields and allows toggling them on/off.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { CalculatedFieldDefinition, CalculationScope, CalculationType } from "@/lib/types";

// Props for the calculated fields form
interface CalculatedFieldsFormProps {
  availableFields: CalculatedFieldDefinition[];
  selectedFieldIds: string[];
  onChange: (fieldIds: string[]) => void;
  disabled?: boolean;
}

// Scope labels for display
const scopeLabels: Record<CalculationScope, string> = {
  controller: "Controller",
  device: "Device",
};

// Scope colors for badges
const scopeColors: Record<CalculationScope, string> = {
  controller: "bg-blue-100 text-blue-800 border-blue-200",
  device: "bg-green-100 text-green-800 border-green-200",
};

// Calculation type labels
const calculationTypeLabels: Record<CalculationType, string> = {
  sum: "Sum",
  difference: "Difference",
  cumulative: "Cumulative",
  average: "Average",
  max: "Maximum",
  min: "Minimum",
};

/**
 * Calculated Fields Form
 *
 * Displays a list of available calculated fields with checkboxes.
 * Groups fields by scope (controller vs device).
 */
export function CalculatedFieldsForm({
  availableFields,
  selectedFieldIds,
  onChange,
  disabled = false,
}: CalculatedFieldsFormProps) {
  // Group fields by scope
  const controllerFields = availableFields.filter((f) => f.scope === "controller");
  const deviceFields = availableFields.filter((f) => f.scope === "device");

  // Toggle a field selection
  const toggleField = (fieldId: string) => {
    if (disabled) return;
    if (selectedFieldIds.includes(fieldId)) {
      onChange(selectedFieldIds.filter((id) => id !== fieldId));
    } else {
      onChange([...selectedFieldIds, fieldId]);
    }
  };

  // Render a field item
  const renderField = (field: CalculatedFieldDefinition) => {
    const isSelected = selectedFieldIds.includes(field.id);

    return (
      <div
        key={field.id}
        className={`flex items-start gap-3 p-3 rounded-lg border ${
          isSelected ? "bg-primary/5 border-primary/20" : "bg-background"
        }`}
      >
        <Checkbox
          id={`field-${field.id}`}
          checked={isSelected}
          onCheckedChange={() => toggleField(field.id)}
          disabled={disabled}
          className="mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <Label
            htmlFor={`field-${field.id}`}
            className="text-sm font-medium cursor-pointer flex items-center gap-2"
          >
            {field.name}
            {field.unit && (
              <span className="text-xs text-muted-foreground">({field.unit})</span>
            )}
          </Label>
          {field.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{field.description}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="outline" className="text-xs">
              {calculationTypeLabels[field.calculation_type]}
            </Badge>
            {field.time_window && (
              <Badge variant="secondary" className="text-xs">
                {field.time_window}
              </Badge>
            )}
            {field.device_types && field.device_types.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {field.device_types.join(", ")}
              </Badge>
            )}
          </div>
        </div>
      </div>
    );
  };

  // No fields available
  if (availableFields.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">
            No calculated fields available. System fields will be created when you run migrations.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Select the calculated fields to include. These fields will be computed
        automatically and can be used for monitoring and alarms.
      </p>

      {/* Controller-scope fields */}
      {controllerFields.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium">Controller Fields</CardTitle>
              <Badge variant="outline" className={scopeColors.controller}>
                {scopeLabels.controller}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Aggregated across all devices in the site
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {controllerFields.map(renderField)}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Device-scope fields */}
      {deviceFields.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium">Device Fields</CardTitle>
              <Badge variant="outline" className={scopeColors.device}>
                {scopeLabels.device}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Calculated per device based on device type
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {deviceFields.map(renderField)}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Selection summary */}
      <div className="text-sm text-muted-foreground">
        {selectedFieldIds.length} of {availableFields.length} fields selected
      </div>
    </div>
  );
}
