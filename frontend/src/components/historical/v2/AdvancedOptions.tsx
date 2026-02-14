"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Plus, Trash2, Calculator, Ruler, Minus, AlertTriangle } from "lucide-react";
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
import type { ReferenceLine, CalculatedField, CalculatedFieldOperand, AxisParameter } from "./types";

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

  // Add calculated field with 2 empty operand slots
  const addCalculatedField = () => {
    if (!canAddCalcField) return;
    const newField: CalculatedField = {
      id: `calc-${Date.now()}`,
      name: `Calculated ${calculatedFields.length + 1}`,
      operands: [
        { parameterId: "", operation: "+" },
        { parameterId: "", operation: "+" },
      ],
      unit: "",
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

  // Add operand to a calculated field
  const addOperand = (fieldId: string) => {
    const field = calculatedFields.find((f) => f.id === fieldId);
    if (!field || field.operands.length >= 5) return;
    updateCalculatedField(fieldId, {
      operands: [...field.operands, { parameterId: "", operation: "+" }],
    });
  };

  // Update a specific operand
  const updateOperand = (fieldId: string, index: number, updates: Partial<CalculatedFieldOperand>) => {
    const field = calculatedFields.find((f) => f.id === fieldId);
    if (!field) return;
    const newOperands = field.operands.map((op, i) =>
      i === index ? { ...op, ...updates } : op
    );
    // Auto-set unit from first operand's parameter
    let unit = field.unit;
    if (index === 0 && updates.parameterId) {
      const param = parameters.find((p) => p.id === updates.parameterId);
      if (param) unit = param.unit;
    }
    updateCalculatedField(fieldId, { operands: newOperands, unit });
  };

  // Remove an operand (min 2)
  const removeOperand = (fieldId: string, index: number) => {
    const field = calculatedFields.find((f) => f.id === fieldId);
    if (!field || field.operands.length <= 2) return;
    updateCalculatedField(fieldId, {
      operands: field.operands.filter((_, i) => i !== index),
    });
  };

  // Check if a calculated field has orphaned operands (referencing removed params)
  const hasOrphanedOperands = (field: CalculatedField): boolean => {
    return field.operands.some(
      (op) => op.parameterId && !parameters.find((p) => p.id === op.parameterId)
    );
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

      {/* Calculated Fields */}
      <Collapsible open={calcFieldsOpen} onOpenChange={setCalcFieldsOpen}>
        <div className="border rounded-lg">
          <CollapsibleTrigger asChild>
            <button className="flex items-center justify-between w-full p-4 text-left hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <Calculator className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Calculated Fields</span>
                <span className="text-xs bg-muted px-2 py-0.5 rounded">
                  {calculatedFields.length}/{MAX_CALCULATED_FIELDS}
                </span>
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
              <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                Combine chart parameters with + / - to create derived values (e.g., Total Load = Meter 1 + Meter 2).
              </p>

              {parameters.length < 2 && (
                <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
                  Add at least 2 parameters to the chart first.
                </p>
              )}

              {calculatedFields.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No calculated fields added yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {calculatedFields.map((field) => (
                    <div key={field.id} className="p-3 bg-muted/30 rounded-md space-y-2">
                      {/* Warning if source params removed */}
                      {hasOrphanedOperands(field) && (
                        <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 p-1.5 rounded">
                          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                          <span>Some source parameters were removed from the chart.</span>
                        </div>
                      )}

                      {/* Name */}
                      <Input
                        value={field.name}
                        onChange={(e) => updateCalculatedField(field.id, { name: e.target.value })}
                        placeholder="Field name"
                        className="h-8 font-medium"
                      />

                      {/* Operand rows */}
                      <div className="space-y-1.5">
                        {field.operands.map((operand, idx) => (
                          <div key={idx} className="flex items-center gap-1.5">
                            {/* Operation toggle (+/-) — first operand locked to + */}
                            {idx === 0 ? (
                              <div className="w-8 h-8 flex items-center justify-center text-xs font-bold text-green-600 bg-green-50 rounded border border-green-200">
                                +
                              </div>
                            ) : (
                              <button
                                type="button"
                                className={`w-8 h-8 flex items-center justify-center text-xs font-bold rounded border transition-colors ${
                                  operand.operation === "+"
                                    ? "text-green-600 bg-green-50 border-green-200"
                                    : "text-red-600 bg-red-50 border-red-200"
                                }`}
                                onClick={() => updateOperand(field.id, idx, {
                                  operation: operand.operation === "+" ? "-" : "+",
                                })}
                                title={operand.operation === "+" ? "Switch to subtract" : "Switch to add"}
                              >
                                {operand.operation === "+" ? "+" : "\u2212"}
                              </button>
                            )}

                            {/* Parameter dropdown */}
                            <Select
                              value={operand.parameterId || undefined}
                              onValueChange={(value) => updateOperand(field.id, idx, { parameterId: value })}
                            >
                              <SelectTrigger className="flex-1 h-8 text-xs">
                                <SelectValue placeholder="Select parameter..." />
                              </SelectTrigger>
                              <SelectContent>
                                {parameters.map((p) => (
                                  <SelectItem key={p.id} value={p.id} className="text-xs">
                                    <span className="flex items-center gap-1.5">
                                      <span
                                        className="w-2 h-2 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: p.color }}
                                      />
                                      {p.deviceName} - {p.registerName}
                                      {p.unit && <span className="text-muted-foreground">({p.unit})</span>}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            {/* Remove operand (only if > 2) */}
                            {field.operands.length > 2 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 flex-shrink-0"
                                onClick={() => removeOperand(field.id, idx)}
                              >
                                <Minus className="h-3 w-3 text-muted-foreground" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Add operand button */}
                      {field.operands.length < 5 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs w-full"
                          onClick={() => addOperand(field.id)}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add operand
                        </Button>
                      )}

                      {/* Bottom row: unit, axis, color, delete */}
                      <div className="flex items-center gap-2 pt-1 border-t border-border/30">
                        <Input
                          value={field.unit}
                          onChange={(e) => updateCalculatedField(field.id, { unit: e.target.value })}
                          placeholder="Unit"
                          className="w-16 h-8 text-xs"
                        />
                        <Select
                          value={field.axis}
                          onValueChange={(value: "left" | "right") =>
                            updateCalculatedField(field.id, { axis: value })
                          }
                        >
                          <SelectTrigger className="w-[100px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="left">Left Axis</SelectItem>
                            <SelectItem value="right">Right Axis</SelectItem>
                          </SelectContent>
                        </Select>
                        <DebouncedColorPicker
                          value={field.color}
                          onChange={(color) => updateCalculatedField(field.id, { color })}
                        />
                        <div className="flex-1" />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => removeCalculatedField(field.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={addCalculatedField}
                disabled={!canAddCalcField || parameters.length < 2}
              >
                <Plus className="h-4 w-4 mr-1" />
                {!canAddCalcField ? "Maximum reached (3)" : "Add Calculated Field"}
              </Button>
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
