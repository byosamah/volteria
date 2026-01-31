"use client";

/**
 * Bar Gauge
 *
 * Simple progress bar style gauge.
 * Supports horizontal and vertical orientations.
 */

interface BarGaugeProps {
  percentage: number;
  value: string;
  unit: string;
  minValue: number;
  maxValue: number;
  label?: string;
  fillColor: string;
  showValue: boolean;
  showMinMax: boolean;
  orientation: "horizontal" | "vertical";
}

export function BarGauge({
  percentage,
  value,
  unit,
  minValue,
  maxValue,
  label,
  fillColor,
  showValue,
  showMinMax,
  orientation,
}: BarGaugeProps) {
  if (orientation === "vertical") {
    return (
      <VerticalBar
        percentage={percentage}
        value={value}
        unit={unit}
        minValue={minValue}
        maxValue={maxValue}
        label={label}
        fillColor={fillColor}
        showValue={showValue}
        showMinMax={showMinMax}
      />
    );
  }

  return (
    <HorizontalBar
      percentage={percentage}
      value={value}
      unit={unit}
      minValue={minValue}
      maxValue={maxValue}
      label={label}
      fillColor={fillColor}
      showValue={showValue}
      showMinMax={showMinMax}
    />
  );
}

interface BarProps {
  percentage: number;
  value: string;
  unit: string;
  minValue: number;
  maxValue: number;
  label?: string;
  fillColor: string;
  showValue: boolean;
  showMinMax: boolean;
}

function HorizontalBar({
  percentage,
  value,
  unit,
  minValue,
  maxValue,
  label,
  fillColor,
  showValue,
  showMinMax,
}: BarProps) {
  return (
    <div className="w-full h-full flex flex-col justify-center gap-1 px-2">
      {/* Label and value */}
      <div className="flex items-center justify-between">
        {label && (
          <p className="text-xs text-muted-foreground truncate">{label}</p>
        )}
        {showValue && (
          <p className="text-sm font-semibold ml-auto whitespace-nowrap">
            {value} <span className="text-xs text-muted-foreground">{unit}</span>
          </p>
        )}
      </div>

      {/* Bar container */}
      <div className="w-full">
        <div className="relative h-5 bg-gray-200 rounded-full overflow-hidden">
          {/* Fill */}
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${percentage}%`,
              backgroundColor: fillColor,
              transition: "width 0.5s ease-out",
            }}
          />
        </div>

        {/* Min/Max labels */}
        {showMinMax && (
          <div className="flex justify-between mt-0.5">
            <span className="text-[10px] text-muted-foreground">{minValue}</span>
            <span className="text-[10px] text-muted-foreground">{maxValue}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function VerticalBar({
  percentage,
  value,
  unit,
  minValue,
  maxValue,
  label,
  fillColor,
  showValue,
  showMinMax,
}: BarProps) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center min-h-0 gap-1">
      <div className="flex items-end gap-2 flex-1 min-h-0 w-full justify-center">
        {/* Min/Max column */}
        {showMinMax && (
          <div className="flex flex-col justify-between h-full py-1 text-right">
            <span className="text-[10px] text-muted-foreground">{maxValue}</span>
            <span className="text-[10px] text-muted-foreground">{minValue}</span>
          </div>
        )}

        {/* Bar container */}
        <div className="relative w-8 h-full bg-gray-200 rounded-full overflow-hidden">
          {/* Fill */}
          <div
            className="absolute inset-x-0 bottom-0 rounded-full"
            style={{
              height: `${percentage}%`,
              backgroundColor: fillColor,
              transition: "height 0.5s ease-out",
            }}
          />
        </div>
      </div>

      {/* Value and label below */}
      <div className="text-center w-full">
        {showValue && (
          <p className="text-sm font-semibold">
            {value} <span className="text-xs text-muted-foreground">{unit}</span>
          </p>
        )}
        {label && (
          <p className="text-xs text-muted-foreground truncate px-1">{label}</p>
        )}
      </div>
    </div>
  );
}
