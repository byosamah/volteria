"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { ParameterCard } from "./ParameterCard";
import type { AxisParameter, ChartType } from "./types";

interface AxisDropZoneProps {
  id: string;
  title: string;
  parameters: AxisParameter[];
  onRemoveParameter: (parameterId: string) => void;
  onUpdateParameter: (parameterId: string, updates: Partial<AxisParameter>) => void;
  onClearAll: () => void;
  maxParameters: number;
}

export function AxisDropZone({
  id,
  title,
  parameters,
  onRemoveParameter,
  onUpdateParameter,
  onClearAll,
  maxParameters,
}: AxisDropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  const parameterIds = parameters.map((p) => p.id);
  const isFull = parameters.length >= maxParameters;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {parameters.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-destructive"
            onClick={onClearAll}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={`
          flex-1 min-h-[200px] rounded-lg border-2 border-dashed p-2 transition-colors
          ${isOver && !isFull ? "border-primary bg-primary/5" : "border-muted"}
          ${isFull ? "border-amber-500/50 bg-amber-500/5" : ""}
        `}
      >
        {parameters.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm text-center p-4">
            Drag parameters here<br />or click +L/+R buttons
          </div>
        ) : (
          <SortableContext items={parameterIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {parameters.map((param) => (
                <ParameterCard
                  key={param.id}
                  parameter={param}
                  onRemove={() => onRemoveParameter(param.id)}
                  onColorChange={(color) => onUpdateParameter(param.id, { color })}
                  onChartTypeChange={(chartType: ChartType) => onUpdateParameter(param.id, { chartType })}
                />
              ))}
            </div>
          </SortableContext>
        )}

        {/* Capacity indicator */}
        {parameters.length > 0 && (
          <div className="mt-2 pt-2 border-t border-dashed">
            <p className={`text-xs ${isFull ? "text-amber-500" : "text-muted-foreground"}`}>
              {parameters.length}/{maxParameters} parameters
              {isFull && " (max reached)"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
