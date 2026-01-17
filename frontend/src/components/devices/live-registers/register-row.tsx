"use client";

/**
 * Register Row Component
 *
 * Single row displaying a register with its value and optional write capability.
 * Shows both raw Modbus value and scaled value (after scale/offset operations).
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Check, X, Loader2 } from "lucide-react";
import type { RegisterRowProps } from "./types";

// Format value for display
function formatValue(value: number, decimals?: number): string {
  const d = decimals ?? 2;
  return value.toFixed(d);
}

// Format the adjustment formula showing scale and/or offset with operation order
function getScaleFormula(
  scale?: number,
  offset?: number,
  scaleOrder?: "multiply_first" | "add_first"
): string | null {
  const scaleVal = scale ?? 1;
  const offsetVal = offset ?? 0;
  const hasScale = scaleVal !== 1;
  const hasOffset = offsetVal !== 0;

  // No transformation if both are defaults
  if (!hasScale && !hasOffset) return null;

  const order = scaleOrder ?? "multiply_first";

  // If only one operation, show simple formula
  if (hasScale && !hasOffset) {
    return `value × ${scaleVal}`;
  }
  if (!hasScale && hasOffset) {
    return offsetVal >= 0 ? `value + ${offsetVal}` : `value - ${Math.abs(offsetVal)}`;
  }

  // Both operations - show in configured order
  if (order === "multiply_first") {
    // (value × scale) + offset
    return `(value × ${scaleVal}) ${offsetVal >= 0 ? "+" : "-"} ${Math.abs(offsetVal)}`;
  } else {
    // (value + offset) × scale
    return `(value ${offsetVal >= 0 ? "+" : "-"} ${Math.abs(offsetVal)}) × ${scaleVal}`;
  }
}

export function RegisterRow({
  register,
  section,
  value,
  pendingWrite,
  writeStatus,
  onWriteValue,
  onPendingWriteChange,
}: RegisterRowProps) {
  const isWritable =
    register.access === "write" || register.access === "readwrite";

  // Handle write submit
  const handleWriteSubmit = () => {
    if (pendingWrite && pendingWrite.trim() !== "") {
      onWriteValue(pendingWrite);
    }
  };

  // Handle key press (Enter to submit)
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleWriteSubmit();
    }
  };

  // Get scale formula for tooltip
  const scaleFormula = getScaleFormula(register.scale, register.offset, register.scale_order);

  // Check if scaling is applied (raw !== scaled)
  const hasScaling = scaleFormula !== null;

  return (
    <tr className="hover:bg-muted/30">
      {/* Address */}
      <td className="px-3 py-2 font-mono text-xs">{register.address}</td>

      {/* Name */}
      <td className="px-3 py-2">
        <div>
          <span className="font-medium">{register.name}</span>
          {register.description && (
            <p className="text-xs text-muted-foreground truncate max-w-xs">
              {register.description}
            </p>
          )}
          {/* Show scale formula if applicable */}
          {scaleFormula && (
            <p className="text-xs text-blue-600 font-mono">
              {scaleFormula}
            </p>
          )}
        </div>
      </td>

      {/* Type Badge */}
      <td className="px-3 py-2">
        <Badge
          variant="outline"
          className={`text-xs ${
            register.type === "holding"
              ? "bg-amber-50 text-amber-700 border-amber-200"
              : "bg-blue-50 text-blue-700 border-blue-200"
          }`}
        >
          {register.type}
        </Badge>
      </td>

      {/* Value (raw from Modbus) */}
      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
        {value ? (
          formatValue(value.raw_value, 0)
        ) : (
          <span className="text-muted-foreground">--</span>
        )}
      </td>

      {/* Adjusted Value (after scale/offset operations) */}
      <td className="px-3 py-2 text-right font-mono">
        {value ? (
          <span className={hasScaling ? "text-green-700 font-medium" : ""}>
            {formatValue(value.scaled_value, register.decimals)}
          </span>
        ) : (
          <span className="text-muted-foreground">--</span>
        )}
      </td>

      {/* Unit */}
      <td className="px-3 py-2 text-muted-foreground text-sm">
        {register.unit || ""}
      </td>

      {/* Actions */}
      <td className="px-3 py-2">
        {isWritable ? (
          <div className="flex items-center gap-1 justify-end">
            <Input
              type="number"
              value={pendingWrite ?? ""}
              onChange={(e) => onPendingWriteChange(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={value ? formatValue(value.scaled_value, register.decimals) : "Value"}
              className="w-20 h-8 text-xs"
              min={register.min}
              max={register.max}
              disabled={writeStatus === "pending"}
            />
            <Button
              size="sm"
              variant={
                writeStatus === "success"
                  ? "default"
                  : writeStatus === "error"
                  ? "destructive"
                  : "outline"
              }
              onClick={handleWriteSubmit}
              disabled={!pendingWrite || writeStatus === "pending"}
              className="h-8 w-16 text-xs"
            >
              {writeStatus === "pending" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : writeStatus === "success" ? (
                <Check className="h-3 w-3" />
              ) : writeStatus === "error" ? (
                <X className="h-3 w-3" />
              ) : (
                "Write"
              )}
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Read only</span>
        )}
      </td>
    </tr>
  );
}
