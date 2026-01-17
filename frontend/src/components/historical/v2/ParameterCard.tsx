"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COLOR_PALETTE, CHART_TYPE_OPTIONS } from "./constants";
import type { AxisParameter, ChartType } from "./types";

interface ParameterCardProps {
  parameter: AxisParameter;
  onRemove: () => void;
  onColorChange: (color: string) => void;
  onChartTypeChange: (chartType: ChartType) => void;
  isDragging?: boolean;
}

export function ParameterCard({
  parameter,
  onRemove,
  onColorChange,
  onChartTypeChange,
  isDragging,
}: ParameterCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: parameter.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`
        flex items-center gap-2 p-2 rounded-md border bg-muted/40 cursor-grab active:cursor-grabbing
        ${isDragging ? "opacity-50 shadow-lg" : "hover:bg-muted/60"}
      `}
    >
      {/* Drag handle indicator */}
      <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />

      {/* Color indicator - clickable to edit */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="w-4 h-4 rounded-full flex-shrink-0 ring-offset-2 hover:ring-2 hover:ring-primary/50 transition-all"
            style={{ backgroundColor: parameter.color }}
            onClick={(e) => e.stopPropagation()}
            title="Click to change color"
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="grid grid-cols-5 gap-1">
            {COLOR_PALETTE.map((color) => (
              <button
                key={color}
                onClick={() => onColorChange(color)}
                className={`
                  w-6 h-6 rounded-md transition-transform hover:scale-110
                  ${parameter.color === color ? "ring-2 ring-offset-2 ring-primary" : ""}
                `}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="mt-2 pt-2 border-t">
            <input
              type="color"
              value={parameter.color}
              onChange={(e) => onColorChange(e.target.value)}
              className="w-full h-8 rounded cursor-pointer"
            />
          </div>
        </PopoverContent>
      </Popover>

      {/* Parameter info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{parameter.registerName}</p>
        <p className="text-xs text-muted-foreground truncate">
          {parameter.siteName} › {parameter.deviceName} {parameter.unit && `• ${parameter.unit}`}
        </p>
      </div>

      {/* Chart type selector */}
      <Select value={parameter.chartType} onValueChange={(v) => onChartTypeChange(v as ChartType)}>
        <SelectTrigger className="h-7 w-[75px] text-xs px-2" onClick={(e) => e.stopPropagation()}>
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          {CHART_TYPE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Remove button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// Non-draggable version for available parameters list
interface AvailableParameterCardProps {
  register: {
    id: string;
    name: string;
    unit: string;
    deviceId: string;
    deviceName: string;
    siteId: string;
    siteName: string;
  };
  onAddToLeft: () => void;
  onAddToRight: () => void;
  disabled?: boolean;
}

export function AvailableParameterCard({
  register,
  onAddToLeft,
  onAddToRight,
  disabled,
}: AvailableParameterCardProps) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-md border bg-card hover:bg-muted/50 transition-colors">
      {/* Parameter info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{register.name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {register.siteName} › {register.deviceName} {register.unit && `• ${register.unit}`}
        </p>
      </div>

      {/* Add buttons */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onAddToLeft}
          disabled={disabled}
        >
          +L
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onAddToRight}
          disabled={disabled}
        >
          +R
        </Button>
      </div>
    </div>
  );
}
