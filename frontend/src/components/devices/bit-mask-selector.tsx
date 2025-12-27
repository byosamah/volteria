"use client";

/**
 * Bit Mask Selector Component
 *
 * A visual bit selector for configuring which bits to extract from a Modbus register.
 * Features:
 * - Enable/disable toggle
 * - Hex input field with live validation
 * - Visual bit grid (clickable squares)
 * - Bidirectional sync between hex and bit checkboxes
 * - Supports 16-bit and 32-bit registers
 */

import { useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface BitMaskSelectorProps {
  /** Whether masking is enabled */
  enabled: boolean;
  /** Callback when enabled state changes */
  onEnabledChange: (enabled: boolean) => void;
  /** Current hex value (e.g., "0xFF00" or "FF00") */
  hexValue: string;
  /** Callback when hex value changes */
  onHexChange: (hex: string) => void;
  /** Array of bit states (true = selected) */
  bits: boolean[];
  /** Callback when bits change */
  onBitsChange: (bits: boolean[]) => void;
  /** Number of bits (16 for uint16/int16, 32 for uint32/int32) */
  bitCount: 16 | 32;
}

export function BitMaskSelector({
  enabled,
  onEnabledChange,
  hexValue,
  onHexChange,
  bits,
  onBitsChange,
  bitCount,
}: BitMaskSelectorProps) {
  /**
   * Convert hex string to bits array
   * MSB is at index 0, LSB is at index (bitCount-1)
   */
  const hexToBits = useCallback(
    (hex: string): boolean[] => {
      // Remove "0x" or "0X" prefix if present
      const cleanHex = hex.replace(/^0[xX]/, "");
      // Parse as hex, default to 0 if invalid
      const num = parseInt(cleanHex, 16) || 0;
      // Convert to bits array (MSB first)
      return Array.from({ length: bitCount }, (_, i) =>
        Boolean((num >> (bitCount - 1 - i)) & 1)
      );
    },
    [bitCount]
  );

  /**
   * Convert bits array to hex string
   */
  const bitsToHex = useCallback(
    (bitsArr: boolean[]): string => {
      let num = 0;
      bitsArr.forEach((bit, i) => {
        if (bit) num |= 1 << (bitCount - 1 - i);
      });
      // Format as hex with 0x prefix, padded to correct length
      const hexDigits = bitCount / 4; // 4 bits per hex digit
      return "0x" + num.toString(16).toUpperCase().padStart(hexDigits, "0");
    },
    [bitCount]
  );

  /**
   * Handle hex input change - update both hex value and bits
   */
  const handleHexChange = (value: string) => {
    onHexChange(value);
    // Try to sync bits from hex (only if it looks like valid hex)
    const cleanValue = value.replace(/^0[xX]/, "");
    if (/^[0-9a-fA-F]*$/.test(cleanValue)) {
      onBitsChange(hexToBits(value));
    }
  };

  /**
   * Toggle a single bit - update both bits and hex value
   */
  const toggleBit = (index: number) => {
    const newBits = [...bits];
    newBits[index] = !newBits[index];
    onBitsChange(newBits);
    onHexChange(bitsToHex(newBits));
  };

  /**
   * Select all bits
   */
  const selectAll = () => {
    const allSelected = new Array(bitCount).fill(true);
    onBitsChange(allSelected);
    onHexChange(bitsToHex(allSelected));
  };

  /**
   * Clear all bits
   */
  const clearAll = () => {
    const allCleared = new Array(bitCount).fill(false);
    onBitsChange(allCleared);
    onHexChange(bitsToHex(allCleared));
  };

  // Calculate how many bits are currently selected
  const selectedCount = bits.filter(Boolean).length;

  return (
    <div className="space-y-3">
      {/* Enable/Disable Toggle */}
      <div className="flex items-center justify-between">
        <Label className="cursor-pointer" htmlFor="mask-toggle">
          Bit Mask
        </Label>
        <Switch
          id="mask-toggle"
          checked={enabled}
          onCheckedChange={onEnabledChange}
        />
      </div>

      {/* Mask configuration (only shown when enabled) */}
      {enabled && (
        <div className="space-y-3 border rounded-md p-3 bg-muted/20">
          {/* Hex Input */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Hex Value</Label>
              <span className="text-xs text-muted-foreground">
                {selectedCount} of {bitCount} bits selected
              </span>
            </div>
            <Input
              value={hexValue}
              onChange={(e) => handleHexChange(e.target.value)}
              placeholder={`e.g., 0x${bitCount === 16 ? "FF00" : "FFFF0000"}`}
              className="min-h-[44px] font-mono"
            />
          </div>

          {/* Quick actions */}
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={selectAll}
              className="text-primary hover:underline"
            >
              Select all
            </button>
            <span className="text-muted-foreground">|</span>
            <button
              type="button"
              onClick={clearAll}
              className="text-primary hover:underline"
            >
              Clear all
            </button>
          </div>

          {/* Visual Bit Selector */}
          <div className="space-y-2">
            {/* MSB/LSB labels */}
            <div className="flex justify-between text-xs text-muted-foreground px-1">
              <span>MSB</span>
              <span>LSB</span>
            </div>

            {/* Bit grid - 8 bits per row */}
            <div className="space-y-1">
              {Array.from({ length: bitCount / 8 }).map((_, rowIdx) => (
                <div key={rowIdx} className="flex gap-1 justify-center">
                  {Array.from({ length: 8 }).map((_, colIdx) => {
                    const bitIndex = rowIdx * 8 + colIdx;
                    const bitNumber = bitCount - 1 - bitIndex; // Bit position (MSB first)
                    const isSelected = bits[bitIndex];

                    return (
                      <button
                        key={bitIndex}
                        type="button"
                        onClick={() => toggleBit(bitIndex)}
                        className={cn(
                          "w-8 h-8 rounded border text-xs font-mono transition-colors",
                          "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-input hover:bg-muted"
                        )}
                        title={`Bit ${bitNumber}${isSelected ? " (selected)" : ""}`}
                      >
                        {bitNumber}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Row labels for 32-bit registers */}
            {bitCount === 32 && (
              <div className="flex justify-center gap-8 text-xs text-muted-foreground">
                <span>High Word (bits 31-16)</span>
                <span>Low Word (bits 15-0)</span>
              </div>
            )}

            {/* Help text */}
            <p className="text-xs text-muted-foreground text-center pt-1">
              Click bits to toggle. Selected bits will be extracted from the raw value.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
