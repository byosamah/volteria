"use client";

/**
 * Enumeration Editor Component
 *
 * A dialog for editing value-to-label mappings for Modbus registers.
 * Allows mapping raw register values to human-readable labels.
 * Example: 0 = "Off", 1 = "On", 2 = "Standby"
 */

import { useState, useEffect } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Single enumeration entry (value -> label mapping) */
export interface EnumerationEntry {
  /** Raw register value (stored as string for form handling) */
  key: string;
  /** Human-readable label */
  label: string;
}

interface EnumerationEditorProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Current enumeration values */
  values: EnumerationEntry[];
  /** Callback when values are saved */
  onChange: (values: EnumerationEntry[]) => void;
}

export function EnumerationEditor({
  open,
  onOpenChange,
  values,
  onChange,
}: EnumerationEditorProps) {
  // Local state for editing (only save on "Save" click)
  const [localValues, setLocalValues] = useState<EnumerationEntry[]>([]);

  // Sync local state when dialog opens
  useEffect(() => {
    if (open) {
      // Clone the values array to avoid mutating the original
      setLocalValues(values.length > 0 ? [...values] : [{ key: "", label: "" }]);
    }
  }, [open, values]);

  // Add a new empty row
  const addRow = () => {
    setLocalValues([...localValues, { key: "", label: "" }]);
  };

  // Remove a row by index
  const removeRow = (index: number) => {
    setLocalValues(localValues.filter((_, i) => i !== index));
  };

  // Update a specific field in a row
  const updateRow = (index: number, field: "key" | "label", value: string) => {
    const updated = [...localValues];
    updated[index] = { ...updated[index], [field]: value };
    setLocalValues(updated);
  };

  // Save and close
  const handleSave = () => {
    // Filter out empty rows (both key and label must be filled)
    const validValues = localValues.filter(
      (v) => v.key.trim() !== "" && v.label.trim() !== ""
    );
    onChange(validValues);
    onOpenChange(false);
  };

  // Cancel and close
  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Enumeration Values</DialogTitle>
          <DialogDescription>
            Map raw register values to human-readable labels.
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable table area */}
        <div className="flex-1 overflow-y-auto py-4 min-h-0">
          {localValues.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No values defined. Click &quot;Add Row&quot; to start.
            </div>
          ) : (
            <div className="space-y-2">
              {/* Header */}
              <div className="grid grid-cols-[1fr_1.5fr_40px] gap-2 px-1">
                <div className="text-xs font-medium text-muted-foreground">
                  Value
                </div>
                <div className="text-xs font-medium text-muted-foreground">
                  Label
                </div>
                <div></div>
              </div>

              {/* Rows */}
              {localValues.map((entry, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[1fr_1.5fr_40px] gap-2 items-center"
                >
                  {/* Value input (number) */}
                  <Input
                    type="number"
                    value={entry.key}
                    onChange={(e) => updateRow(index, "key", e.target.value)}
                    className="min-h-[44px]"
                    placeholder="e.g., 0"
                  />
                  {/* Label input (text) */}
                  <Input
                    type="text"
                    value={entry.label}
                    onChange={(e) => updateRow(index, "label", e.target.value)}
                    className="min-h-[44px]"
                    placeholder="e.g., Off"
                  />
                  {/* Delete button */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRow(index)}
                    className="h-10 w-10 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add row button */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRow}
            className="w-full mt-4"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Row
          </Button>

          {/* Help text */}
          <p className="text-xs text-muted-foreground mt-3">
            Values should be numeric (the raw register value). Labels are displayed
            in the UI. Empty rows will be ignored.
          </p>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            className="min-h-[44px] w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            className="min-h-[44px] w-full sm:w-auto"
          >
            Save Values
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
