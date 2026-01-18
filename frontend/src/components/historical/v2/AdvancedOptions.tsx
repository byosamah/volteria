"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Plus, Trash2, Calculator, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { COLOR_PALETTE } from "./constants";
import type { ReferenceLine, CalculatedField, AxisParameter } from "./types";

// Maximum allowed for each type
const MAX_REFERENCE_LINES = 3;
const MAX_CALCULATED_FIELDS = 3;

interface AdvancedOptionsProps {
  referenceLines: ReferenceLine[];
  onReferenceLinesChange: (lines: ReferenceLine[]) => void;
  calculatedFields: CalculatedField[];
  onCalculatedFieldsChange: (fields: CalculatedField[]) => void;
  parameters: AxisParameter[];
}

export function AdvancedOptions({
  referenceLines,
  onReferenceLinesChange,
  calculatedFields,
  onCalculatedFieldsChange,
  parameters,
}: AdvancedOptionsProps) {
  const [refLinesOpen, setRefLinesOpen] = useState(false);
  const [calcFieldsOpen, setCalcFieldsOpen] = useState(false);

  // Check limits
  const canAddRefLine = referenceLines.length < MAX_REFERENCE_LINES;
  const canAddCalcField = calculatedFields.length < MAX_CALCULATED_FIELDS;

  // Add reference line
  const addReferenceLine = () => {
    if (!canAddRefLine) return;
    const newLine: ReferenceLine = {
      id: `ref-${Date.now()}`,
      label: `Reference ${referenceLines.length + 1}`,
      value: 0,
      color: COLOR_PALETTE[referenceLines.length % COLOR_PALETTE.length],
      axis: "left",
    };
    onReferenceLinesChange([...referenceLines, newLine]);
  };

  // Update reference line
  const updateReferenceLine = (id: string, updates: Partial<ReferenceLine>) => {
    onReferenceLinesChange(
      referenceLines.map((line) =>
        line.id === id ? { ...line, ...updates } : line
      )
    );
  };

  // Remove reference line
  const removeReferenceLine = (id: string) => {
    onReferenceLinesChange(referenceLines.filter((line) => line.id !== id));
  };

  // Add calculated field
  const addCalculatedField = () => {
    if (!canAddCalcField) return;
    const newField: CalculatedField = {
      id: `calc-${Date.now()}`,
      name: `Calculated ${calculatedFields.length + 1}`,
      formula: "",
      color: COLOR_PALETTE[(calculatedFields.length + 5) % COLOR_PALETTE.length],
      axis: "left",
    };
    onCalculatedFieldsChange([...calculatedFields, newField]);
  };

  // Update calculated field
  const updateCalculatedField = (id: string, updates: Partial<CalculatedField>) => {
    onCalculatedFieldsChange(
      calculatedFields.map((field) =>
        field.id === id ? { ...field, ...updates } : field
      )
    );
  };

  // Remove calculated field
  const removeCalculatedField = (id: string) => {
    onCalculatedFieldsChange(calculatedFields.filter((field) => field.id !== id));
  };

  return (
    <div className="space-y-2">
      {/* Reference Lines */}
      <Collapsible open={refLinesOpen} onOpenChange={setRefLinesOpen}>
        <div className="border rounded-lg">
          <CollapsibleTrigger asChild>
            <button className="flex items-center justify-between w-full p-4 text-left hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <Ruler className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Reference Lines</span>
                <span className="text-xs bg-muted px-2 py-0.5 rounded">
                  {referenceLines.length}/{MAX_REFERENCE_LINES}
                </span>
              </div>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  refLinesOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4 space-y-3">
              {/* Explanation */}
              <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                Add horizontal threshold lines to the chart. Fill in the form below and the line appears automatically.
              </p>

              {referenceLines.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No reference lines added yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {referenceLines.map((line) => (
                    <div
                      key={line.id}
                      className="flex items-center gap-2 p-2 bg-muted/30 rounded-md"
                    >
                      <Input
                        value={line.label}
                        onChange={(e) =>
                          updateReferenceLine(line.id, { label: e.target.value })
                        }
                        placeholder="Label"
                        className="flex-1 h-8"
                      />
                      <Input
                        type="number"
                        value={line.value}
                        onChange={(e) =>
                          updateReferenceLine(line.id, {
                            value: parseFloat(e.target.value) || 0,
                          })
                        }
                        placeholder="Value"
                        className="w-24 h-8"
                      />
                      <DebouncedColorPicker
                        value={line.color}
                        onChange={(color) =>
                          updateReferenceLine(line.id, { color })
                        }
                      />
                      <Select
                        value={line.axis}
                        onValueChange={(value: "left" | "right") =>
                          updateReferenceLine(line.id, { axis: value })
                        }
                      >
                        <SelectTrigger className="w-[120px] h-8">
                          <SelectValue placeholder="Select axis" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="left">Left Axis</SelectItem>
                          <SelectItem value="right">Right Axis</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => removeReferenceLine(line.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={addReferenceLine}
                disabled={!canAddRefLine}
              >
                <Plus className="h-4 w-4 mr-1" />
                {canAddRefLine ? "Add Reference Line" : "Maximum reached (3)"}
              </Button>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Calculated Fields - Disabled until implemented */}
      <Collapsible open={calcFieldsOpen} onOpenChange={setCalcFieldsOpen}>
        <div className="border rounded-lg opacity-60">
          <CollapsibleTrigger asChild>
            <button className="flex items-center justify-between w-full p-4 text-left hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <Calculator className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Calculated Fields</span>
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">Coming soon</span>
              </div>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  calcFieldsOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4 space-y-3">
              {/* Explanation */}
              <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                Create formulas to combine parameters (e.g., Total = Param1 + Param2).
                <span className="block mt-1 text-amber-600 font-medium">This feature is under development and will be available soon.</span>
              </p>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}

// Debounced color picker - smooth dragging, chart updates after 300ms pause
function DebouncedColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Sync input value when prop changes externally
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.value = value;
    }
  }, [value]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <input
      ref={inputRef}
      type="color"
      defaultValue={value}
      onInput={(e) => {
        const color = e.currentTarget.value;
        // Debounce - only update after 300ms of no dragging
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => {
          onChange(color);
        }, 300);
      }}
      className="h-8 w-8 rounded cursor-pointer border"
    />
  );
}
