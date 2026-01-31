"use client";

/**
 * Tank Gauge
 *
 * Displays value as liquid level in a tank container.
 * Supports vertical cylinder and rectangular shapes.
 * Modern flat design with subtle 3D depth.
 */

interface TankGaugeProps {
  percentage: number;
  value: string;
  unit: string;
  minValue: number;
  maxValue: number;
  label?: string;
  fillColor: string;
  showValue: boolean;
  showMinMax: boolean;
  orientation: "vertical" | "horizontal";
  shape: "cylinder" | "rectangular";
}

export function TankGauge({
  percentage,
  value,
  unit,
  minValue,
  maxValue,
  label,
  fillColor,
  showValue,
  showMinMax,
  shape,
}: TankGaugeProps) {
  // Only vertical orientation is supported now
  return (
    <VerticalTank
      percentage={percentage}
      value={value}
      unit={unit}
      minValue={minValue}
      maxValue={maxValue}
      label={label}
      fillColor={fillColor}
      showValue={showValue}
      showMinMax={showMinMax}
      shape={shape}
    />
  );
}

interface TankProps {
  percentage: number;
  value: string;
  unit: string;
  minValue: number;
  maxValue: number;
  label?: string;
  fillColor: string;
  showValue: boolean;
  showMinMax: boolean;
  shape: "cylinder" | "rectangular";
}

function VerticalTank({
  percentage,
  value,
  unit,
  minValue,
  maxValue,
  label,
  fillColor,
  showValue,
  showMinMax,
  shape,
}: TankProps) {
  const isCylinder = shape === "cylinder";

  // Tank dimensions in viewBox coordinates
  const tankLeft = 10;
  const tankRight = 50;
  const tankTop = 8;
  const tankBottom = 88;
  const tankWidth = tankRight - tankLeft;
  const tankHeight = tankBottom - tankTop;

  // Fill height calculation
  const fillHeight = (percentage / 100) * tankHeight;
  const fillTop = tankBottom - fillHeight;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center min-h-0">
      <svg viewBox="0 0 70 100" className="w-full h-full flex-1" preserveAspectRatio="xMidYMid meet">
        <defs>
          {/* Gradient for 3D effect */}
          <linearGradient id="tankGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(0,0,0,0.1)" />
            <stop offset="50%" stopColor="rgba(255,255,255,0.1)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.1)" />
          </linearGradient>
          {/* Clip path for fill */}
          <clipPath id="tankClip">
            {isCylinder ? (
              <>
                <ellipse cx="30" cy={tankBottom} rx={tankWidth / 2} ry="5" />
                <rect x={tankLeft} y={tankTop} width={tankWidth} height={tankHeight} />
                <ellipse cx="30" cy={tankTop} rx={tankWidth / 2} ry="5" />
              </>
            ) : (
              <rect x={tankLeft} y={tankTop} width={tankWidth} height={tankHeight} rx="3" />
            )}
          </clipPath>
        </defs>

        {/* Tank body background */}
        {isCylinder ? (
          <g>
            {/* Cylinder body */}
            <rect x={tankLeft} y={tankTop} width={tankWidth} height={tankHeight} fill="#e5e7eb" />
            {/* Top ellipse */}
            <ellipse cx="30" cy={tankTop} rx={tankWidth / 2} ry="5" fill="#d1d5db" />
            {/* Bottom ellipse */}
            <ellipse cx="30" cy={tankBottom} rx={tankWidth / 2} ry="5" fill="#e5e7eb" />
          </g>
        ) : (
          <rect x={tankLeft} y={tankTop} width={tankWidth} height={tankHeight} rx="3" fill="#e5e7eb" />
        )}

        {/* Fill level */}
        <g clipPath="url(#tankClip)">
          <rect
            x={tankLeft}
            y={fillTop}
            width={tankWidth}
            height={fillHeight + 5}
            fill={fillColor}
            style={{ transition: "y 0.5s ease-out, height 0.5s ease-out" }}
          />
        </g>

        {/* Liquid surface line (for cylinder) */}
        {isCylinder && percentage > 0 && percentage < 100 && (
          <ellipse
            cx="30"
            cy={fillTop}
            rx={tankWidth / 2 - 1}
            ry="4"
            fill={fillColor}
            style={{
              transition: "cy 0.5s ease-out",
              filter: "brightness(1.15)"
            }}
          />
        )}

        {/* 3D overlay */}
        <rect x={tankLeft} y={tankTop} width={tankWidth} height={tankHeight} fill="url(#tankGradient)" />

        {/* Min/Max labels on the right side */}
        {showMinMax && (
          <g>
            <text x="58" y={tankBottom + 3} className="fill-muted-foreground" style={{ fontSize: "7px" }}>
              {minValue}
            </text>
            <text x="58" y={tankTop + 5} className="fill-muted-foreground" style={{ fontSize: "7px" }}>
              {maxValue}
            </text>
          </g>
        )}
      </svg>

      {/* Value and label below */}
      <div className="text-center w-full">
        {showValue && (
          <p className="text-sm font-semibold">
            {value} <span className="text-xs text-muted-foreground">{unit}</span>
          </p>
        )}
        {label && (
          <p className="text-sm text-muted-foreground truncate px-1">{label}</p>
        )}
      </div>
    </div>
  );
}
