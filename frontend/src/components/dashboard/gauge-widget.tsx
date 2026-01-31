"use client";

/**
 * Gauge Widget
 *
 * Displays register values as visual gauges with multiple styles:
 * - dial: Circular speedometer with needle
 * - tank_vertical: Vertical cylinder (fuel tank)
 * - tank_horizontal: Horizontal cylinder
 * - tank_rectangular: Square/rectangular container
 * - thermometer: Classic thermometer bar
 * - bar_horizontal: Simple horizontal progress bar
 * - bar_vertical: Simple vertical progress bar
 */

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { DialGauge } from "./gauge-styles/dial-gauge";
import { TankGauge } from "./gauge-styles/tank-gauge";
import { ThermometerGauge } from "./gauge-styles/thermometer-gauge";
import { BarGauge } from "./gauge-styles/bar-gauge";

interface LiveData {
  timestamp: string;
  registers: Record<string, Record<string, { value: number | null; unit: string | null; timestamp: string | null }>>;
  device_status: Record<string, { is_online: boolean; last_seen: string | null }>;
}

interface Widget {
  id: string;
  widget_type: string;
  grid_row: number;
  grid_col: number;
  grid_width: number;
  grid_height: number;
  config: Record<string, unknown>;
  z_index: number;
}

export interface GaugeWidgetConfig {
  gauge_style?: "dial" | "tank_vertical" | "tank_horizontal" | "tank_rectangular" | "thermometer" | "bar_horizontal" | "bar_vertical";
  device_id?: string;
  register_name?: string;
  min_value?: number;
  max_value?: number;
  label?: string;
  unit?: string;
  decimals?: number;
  show_value?: boolean;
  show_min_max?: boolean;
  fill_color?: string;
  zones_enabled?: boolean;
  zone_low_threshold?: number;
  zone_high_threshold?: number;
  zone_low_color?: string;
  zone_normal_color?: string;
  zone_high_color?: string;
}

interface GaugeWidgetProps {
  widget: Widget;
  liveData: LiveData | null;
  isEditMode: boolean;
  onSelect: () => void;
}

export const GaugeWidget = memo(function GaugeWidget({ widget, liveData, isEditMode, onSelect }: GaugeWidgetProps) {
  const config = widget.config as GaugeWidgetConfig;

  const gaugeStyle = config.gauge_style || "dial";
  const minValue = config.min_value ?? 0;
  const maxValue = config.max_value ?? 100;
  const decimals = config.decimals ?? 0;
  const showValue = config.show_value !== false;
  const showMinMax = config.show_min_max !== false;
  const defaultFillColor = "#22c55e"; // green-500

  // Get value from live data
  let value: number | null = null;
  let unit = config.unit || "";

  if (config.device_id && config.register_name && liveData?.registers[config.device_id]) {
    const regData = liveData.registers[config.device_id][config.register_name];
    if (regData) {
      value = regData.value;
      unit = config.unit || regData.unit || "";
    }
  }

  // Calculate percentage (clamped 0-100)
  const percentage = useMemo(() => {
    if (value === null) return 0;
    const range = maxValue - minValue;
    if (range === 0) return 0;
    const pct = ((value - minValue) / range) * 100;
    return Math.max(0, Math.min(100, pct));
  }, [value, minValue, maxValue]);

  // Determine fill color based on zones
  const fillColor = useMemo(() => {
    if (!config.zones_enabled || value === null) {
      return config.fill_color || defaultFillColor;
    }

    const lowThreshold = config.zone_low_threshold ?? 25;
    const highThreshold = config.zone_high_threshold ?? 75;
    const lowColor = config.zone_low_color || "#22c55e"; // green
    const normalColor = config.zone_normal_color || "#eab308"; // yellow
    const highColor = config.zone_high_color || "#ef4444"; // red

    if (value < lowThreshold) return lowColor;
    if (value > highThreshold) return highColor;
    return normalColor;
  }, [config.zones_enabled, config.zone_low_threshold, config.zone_high_threshold,
      config.zone_low_color, config.zone_normal_color, config.zone_high_color,
      config.fill_color, value]);

  // Format display value
  const displayValue = value !== null ? value.toFixed(decimals) : "--";

  // Common props for all gauge styles
  const gaugeProps = {
    percentage,
    value: displayValue,
    unit,
    minValue,
    maxValue,
    label: config.label,
    fillColor,
    showValue,
    showMinMax,
  };

  // Render the appropriate gauge style
  const renderGauge = () => {
    switch (gaugeStyle) {
      case "dial":
        return <DialGauge {...gaugeProps} />;
      case "tank_vertical":
        return <TankGauge {...gaugeProps} orientation="vertical" shape="cylinder" />;
      case "tank_horizontal":
        return <TankGauge {...gaugeProps} orientation="horizontal" shape="cylinder" />;
      case "tank_rectangular":
        return <TankGauge {...gaugeProps} orientation="vertical" shape="rectangular" />;
      case "thermometer":
        return <ThermometerGauge {...gaugeProps} />;
      case "bar_horizontal":
        return <BarGauge {...gaugeProps} orientation="horizontal" />;
      case "bar_vertical":
        return <BarGauge {...gaugeProps} orientation="vertical" />;
      default:
        return <DialGauge {...gaugeProps} />;
    }
  };

  return (
    <div
      className={cn(
        "h-full w-full flex flex-col items-center justify-center p-2",
        isEditMode && "cursor-pointer"
      )}
      onClick={isEditMode ? onSelect : undefined}
    >
      {renderGauge()}

      {/* Empty state in edit mode */}
      {isEditMode && !config.register_name && (
        <p className="text-xs text-muted-foreground mt-2">Click to configure</p>
      )}
    </div>
  );
});
