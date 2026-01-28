"use client";

/**
 * Icon/Image Widget
 *
 * Displays an icon or image representing equipment with optional live data.
 * Supports:
 * - Legacy Lucide icons
 * - Preset images from library
 * - Custom uploaded images
 * - Conditional image switching based on register values
 * - Configurable image size
 * - Optional status indicator dot
 * - Optional register value display
 */

import { memo } from "react";
import { getIconById } from "@/lib/dashboard-icons";
import { getPresetImageById } from "@/lib/dashboard-preset-images";
import { cn } from "@/lib/utils";

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

interface IconWidgetProps {
  widget: Widget;
  liveData: LiveData | null;
  isEditMode: boolean;
  onSelect: () => void;
}

interface ImageWidgetConfig {
  // Image source
  image_type?: "preset" | "custom" | "legacy";
  preset_image_id?: string;
  custom_image_url?: string;
  icon_id?: string; // Legacy Lucide icon

  // Image size
  image_width?: number;
  image_height?: number;

  // Conditional image
  conditional_enabled?: boolean;
  conditional_image_type?: "preset" | "custom";
  conditional_preset_image_id?: string;
  conditional_custom_image_url?: string;

  // Condition
  condition_device_id?: string;
  condition_register_name?: string;
  condition_operator?: ">" | ">=" | "<" | "<=" | "==" | "!=";
  condition_value?: number;

  // Display options
  label?: string;
  show_status_dot?: boolean;
  linked_device_id?: string;
  show_value?: boolean;
  value_device_id?: string;
  linked_registers?: Array<{ register_name: string; unit?: string; decimals?: number }>;
  color?: string; // For legacy icons
}

/**
 * Evaluate a condition against a value
 */
function evaluateCondition(
  value: number | null,
  operator: string | undefined,
  threshold: number | undefined
): boolean {
  if (value === null || operator === undefined || threshold === undefined) {
    return false;
  }

  switch (operator) {
    case ">": return value > threshold;
    case ">=": return value >= threshold;
    case "<": return value < threshold;
    case "<=": return value <= threshold;
    case "==": return value === threshold;
    case "!=": return value !== threshold;
    default: return false;
  }
}

export const IconWidget = memo(function IconWidget({ widget, liveData, isEditMode, onSelect }: IconWidgetProps) {
  const config = widget.config as ImageWidgetConfig;

  // Determine image type (with backward compatibility)
  const imageType = config.image_type || (config.icon_id ? "legacy" : "preset");

  // Get condition register value
  let conditionValue: number | null = null;
  if (config.conditional_enabled && config.condition_device_id && config.condition_register_name) {
    const conditionRegData = liveData?.registers[config.condition_device_id]?.[config.condition_register_name];
    conditionValue = conditionRegData?.value ?? null;
  }

  // Evaluate condition (default operator to ">" if not set)
  const showSecondary = config.conditional_enabled && evaluateCondition(
    conditionValue,
    config.condition_operator || ">",
    config.condition_value
  );

  // Determine which image to show
  let imageUrl: string | null = null;
  let LegacyIcon: React.ComponentType<{ className?: string }> | null = null;

  if (imageType === "legacy") {
    // Legacy Lucide icon
    const iconDef = getIconById(config.icon_id || "load_generic");
    LegacyIcon = iconDef?.icon || null;
  } else {
    // Preset or custom image
    if (showSecondary) {
      // Show conditional/secondary image
      if (config.conditional_image_type === "custom" && config.conditional_custom_image_url) {
        imageUrl = config.conditional_custom_image_url;
      } else if (config.conditional_preset_image_id) {
        const preset = getPresetImageById(config.conditional_preset_image_id);
        imageUrl = preset?.url || null;
      }
    } else {
      // Show primary image
      if (config.image_type === "custom" && config.custom_image_url) {
        imageUrl = config.custom_image_url;
      } else if (config.preset_image_id) {
        const preset = getPresetImageById(config.preset_image_id);
        imageUrl = preset?.url || null;
      }
    }
  }

  // Dynamic image sizing - scales with widget container
  // (removed fixed imageWidth/imageHeight - using CSS-based responsive sizing)

  // Status dot
  const showStatusDot = config.show_status_dot ?? Boolean(config.linked_device_id);
  const statusDeviceId = config.linked_device_id;
  const deviceStatus = statusDeviceId ? liveData?.device_status[statusDeviceId] : null;
  const isOnline = deviceStatus?.is_online ?? null;

  // Value display
  const showValue = config.show_value ?? Boolean(config.linked_registers?.length);
  const valueDeviceId = config.value_device_id || config.linked_device_id;

  const registerValues = showValue ? (config.linked_registers || []).map((reg) => {
    if (!valueDeviceId || !liveData?.registers[valueDeviceId]) {
      return { name: reg.register_name, value: null, unit: reg.unit || "" };
    }

    const regData = liveData.registers[valueDeviceId][reg.register_name];
    if (!regData) {
      return { name: reg.register_name, value: null, unit: reg.unit || "" };
    }

    const value = regData.value;
    const decimals = reg.decimals ?? 1;
    const formatted = value !== null ? value.toFixed(decimals) : "--";

    return {
      name: reg.register_name,
      value: formatted,
      unit: reg.unit || regData.unit || "",
    };
  }) : [];

  const accentColor = config.color || "#22c55e";

  // Check if widget has any content configured
  const hasContent = imageUrl || LegacyIcon || config.label;

  // Check if we have label or values to show below image
  const hasBottomContent = config.label || (showValue && registerValues.length > 0);

  return (
    <div
      className={cn(
        "h-full w-full relative",
        isEditMode && "cursor-pointer"
      )}
      onClick={isEditMode ? onSelect : undefined}
    >
      {/* Status indicator dot */}
      {showStatusDot && statusDeviceId && isOnline !== null && (
        <div
          className={cn(
            "absolute top-1 right-1 w-2.5 h-2.5 rounded-full z-10",
            isOnline ? "bg-green-500" : "bg-red-500"
          )}
          title={isOnline ? "Online" : "Offline"}
        />
      )}

      {/* Image as background */}
      {imageUrl && (
        <div
          className="absolute"
          style={{
            top: 10,
            bottom: hasBottomContent ? 36 : 4,
            left: 2,
            right: 2,
            backgroundImage: `url(${imageUrl})`,
            backgroundSize: '96% auto',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
          }}
          role="img"
          aria-label={config.label || "Widget image"}
        />
      )}

      {/* Legacy Icon */}
      {LegacyIcon && !imageUrl && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ color: accentColor, bottom: hasBottomContent ? 36 : 0 }}
        >
          <LegacyIcon className="w-2/3 h-2/3 min-w-[24px] min-h-[24px]" />
        </div>
      )}

      {/* Bottom content: Label and Values - solid background, no overlap */}
      {hasBottomContent && (
        <div className="absolute bottom-0 left-0 right-0 text-center px-1 py-1 bg-background">
          {config.label && (
            <p className="text-sm font-medium truncate">
              {config.label}
            </p>
          )}
          {showValue && registerValues.length > 0 && (
            <div>
              {registerValues.slice(0, 2).map((reg, idx) => (
                <p
                  key={idx}
                  className="text-base font-semibold leading-tight"
                  style={{ color: reg.value !== null ? accentColor : undefined }}
                >
                  {reg.value !== null ? (
                    <>
                      {reg.value} <span className="text-xs font-normal text-muted-foreground">{reg.unit}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state in edit mode */}
      {isEditMode && !hasContent && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-xs text-muted-foreground">Click to configure</p>
        </div>
      )}
    </div>
  );
});
