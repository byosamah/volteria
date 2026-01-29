"use client";

/**
 * Text Widget
 *
 * Displays custom text with configurable size, color, and alignment.
 * Useful for labels, titles, and annotations on the dashboard.
 */

import { memo } from "react";
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

interface TextWidgetProps {
  widget: Widget;
  liveData: LiveData | null;
  isEditMode: boolean;
  onSelect: () => void;
}

interface TextWidgetConfig {
  text?: string;
  text_size?: "xs" | "sm" | "base" | "lg" | "xl" | "2xl" | "3xl";
  text_color?: string;
  text_align?: "left" | "center" | "right";
}

const TEXT_SIZE_CLASSES: Record<string, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
  "3xl": "text-3xl",
};

const TEXT_ALIGN_CLASSES: Record<string, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export const TextWidget = memo(function TextWidget({
  widget,
  isEditMode,
  onSelect,
}: TextWidgetProps) {
  const config = widget.config as TextWidgetConfig;

  const text = config.text || "";
  const textSize = config.text_size || "base";
  const textColor = config.text_color || undefined;
  const textAlign = config.text_align || "left";

  const hasContent = text.trim().length > 0;

  return (
    <div
      className={cn(
        "h-full w-full flex items-center p-3",
        isEditMode && "cursor-pointer",
        TEXT_ALIGN_CLASSES[textAlign]
      )}
      onClick={isEditMode ? onSelect : undefined}
    >
      {hasContent ? (
        <p
          className={cn(
            "w-full whitespace-pre-wrap break-words",
            TEXT_SIZE_CLASSES[textSize]
          )}
          style={textColor ? { color: textColor } : undefined}
        >
          {text}
        </p>
      ) : isEditMode ? (
        <p className="w-full text-sm text-muted-foreground text-center">
          Click to add text
        </p>
      ) : null}
    </div>
  );
});
