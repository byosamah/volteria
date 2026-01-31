"use client";

/**
 * Widget Picker
 *
 * Sidebar component for selecting widget types to add to the dashboard.
 * Shows all available widget types with icons and descriptions.
 */

import { Button } from "@/components/ui/button";
import {
  Gauge,
  BarChart3,
  AlertTriangle,
  Activity,
  Zap,
  Type,
  Hash,
  Cable,
} from "lucide-react";

interface WidgetPickerProps {
  onSelect: (widgetType: string) => void;
  disabled?: boolean;
}

const WIDGET_TYPES = [
  {
    id: "icon",
    name: "Icon",
    description: "Visual element with live data",
    icon: Zap,
  },
  {
    id: "value_display",
    name: "Value",
    description: "Single metric display",
    icon: Hash,
  },
  {
    id: "chart",
    name: "Chart",
    description: "Time-series graph",
    icon: BarChart3,
  },
  {
    id: "alarm_list",
    name: "Alarms",
    description: "Recent alarm list",
    icon: AlertTriangle,
  },
  {
    id: "status_indicator",
    name: "Status",
    description: "Device online status",
    icon: Activity,
  },
  {
    id: "text",
    name: "Text",
    description: "Custom text label",
    icon: Type,
  },
  {
    id: "gauge",
    name: "Gauge",
    description: "Tank, dial, or bar gauge",
    icon: Gauge,
  },
  {
    id: "cable",
    name: "Cable",
    description: "Connect widgets visually",
    icon: Cable,
  },
];

export function WidgetPicker({ onSelect, disabled }: WidgetPickerProps) {
  return (
    <div className="space-y-2">
      {WIDGET_TYPES.map((widgetType) => {
        const Icon = widgetType.icon;

        return (
          <Button
            key={widgetType.id}
            variant="outline"
            className="w-full justify-start h-auto py-2 px-3"
            onClick={() => onSelect(widgetType.id)}
            disabled={disabled}
          >
            <Icon className="h-4 w-4 mr-3 shrink-0" />
            <div className="text-left">
              <p className="text-sm font-medium">{widgetType.name}</p>
              <p className="text-xs text-muted-foreground">
                {widgetType.description}
              </p>
            </div>
          </Button>
        );
      })}
    </div>
  );
}
