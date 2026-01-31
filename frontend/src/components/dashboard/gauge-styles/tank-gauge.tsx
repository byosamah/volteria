"use client";

/**
 * Tank Gauge
 *
 * Displays value as liquid level in a tank container.
 * Supports vertical/horizontal orientation and cylinder/rectangular shapes.
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
  orientation,
  shape,
}: TankGaugeProps) {
  if (orientation === "horizontal") {
    return (
      <HorizontalTank
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

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1">
      <svg viewBox="0 0 60 100" className="w-full h-full max-w-[80px] max-h-[160px]">
        <defs>
          {/* Gradient for 3D effect */}
          <linearGradient id={`tankGradient-${isCylinder ? 'cyl' : 'rect'}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(0,0,0,0.1)" />
            <stop offset="50%" stopColor="rgba(255,255,255,0.1)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.1)" />
          </linearGradient>
          {/* Clip path for fill */}
          <clipPath id="verticalTankClip">
            {isCylinder ? (
              <>
                <ellipse cx="30" cy="90" rx="25" ry="6" />
                <rect x="5" y="10" width="50" height="80" />
                <ellipse cx="30" cy="10" rx="25" ry="6" />
              </>
            ) : (
              <rect x="5" y="5" width="50" height="90" rx="4" />
            )}
          </clipPath>
        </defs>

        {/* Tank body background */}
        {isCylinder ? (
          <g>
            {/* Cylinder body */}
            <rect x="5" y="10" width="50" height="80" fill="#e5e7eb" />
            {/* Top ellipse */}
            <ellipse cx="30" cy="10" rx="25" ry="6" fill="#d1d5db" />
            {/* Bottom ellipse */}
            <ellipse cx="30" cy="90" rx="25" ry="6" fill="#e5e7eb" />
          </g>
        ) : (
          <rect x="5" y="5" width="50" height="90" rx="4" fill="#e5e7eb" />
        )}

        {/* Fill level */}
        <g clipPath="url(#verticalTankClip)">
          <rect
            x="5"
            y={95 - (percentage * 0.85)}
            width="50"
            height={percentage * 0.85}
            fill={fillColor}
            style={{ transition: "y 0.5s ease-out, height 0.5s ease-out" }}
          />
        </g>

        {/* Liquid surface line (for cylinder) */}
        {isCylinder && percentage > 0 && (
          <ellipse
            cx="30"
            cy={95 - (percentage * 0.85)}
            rx="25"
            ry="4"
            fill={fillColor}
            style={{
              transition: "cy 0.5s ease-out",
              filter: "brightness(1.1)"
            }}
          />
        )}

        {/* 3D overlay */}
        <rect x="5" y="10" width="50" height="80" fill={`url(#tankGradient-${isCylinder ? 'cyl' : 'rect'})`} />

        {/* Min/Max labels */}
        {showMinMax && (
          <g>
            <text x="58" y="92" className="fill-muted-foreground" style={{ fontSize: "6px" }}>
              {minValue}
            </text>
            <text x="58" y="14" className="fill-muted-foreground" style={{ fontSize: "6px" }}>
              {maxValue}
            </text>
          </g>
        )}
      </svg>

      {/* Value and label below */}
      <div className="text-center">
        {showValue && (
          <p className="text-sm font-semibold">
            {value} <span className="text-xs text-muted-foreground">{unit}</span>
          </p>
        )}
        {label && (
          <p className="text-xs text-muted-foreground truncate max-w-full">{label}</p>
        )}
      </div>
    </div>
  );
}

function HorizontalTank({
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

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1">
      <svg viewBox="0 0 100 50" className="w-full h-full max-w-[180px] max-h-[90px]">
        <defs>
          {/* Gradient for 3D effect */}
          <linearGradient id="hTankGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.15)" />
            <stop offset="50%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.1)" />
          </linearGradient>
          {/* Clip path for fill */}
          <clipPath id="horizontalTankClip">
            {isCylinder ? (
              <>
                <ellipse cx="10" cy="25" rx="6" ry="20" />
                <rect x="10" y="5" width="80" height="40" />
                <ellipse cx="90" cy="25" rx="6" ry="20" />
              </>
            ) : (
              <rect x="5" y="5" width="90" height="40" rx="4" />
            )}
          </clipPath>
        </defs>

        {/* Tank body background */}
        {isCylinder ? (
          <g>
            {/* Cylinder body */}
            <rect x="10" y="5" width="80" height="40" fill="#e5e7eb" />
            {/* Left ellipse */}
            <ellipse cx="10" cy="25" rx="6" ry="20" fill="#d1d5db" />
            {/* Right ellipse */}
            <ellipse cx="90" cy="25" rx="6" ry="20" fill="#e5e7eb" />
          </g>
        ) : (
          <rect x="5" y="5" width="90" height="40" rx="4" fill="#e5e7eb" />
        )}

        {/* Fill level */}
        <g clipPath="url(#horizontalTankClip)">
          <rect
            x="5"
            y="5"
            width={(percentage * 0.9)}
            height="40"
            fill={fillColor}
            style={{ transition: "width 0.5s ease-out" }}
          />
        </g>

        {/* Liquid edge (for cylinder) */}
        {isCylinder && percentage > 0 && (
          <ellipse
            cx={5 + (percentage * 0.9)}
            cy="25"
            rx="4"
            ry="18"
            fill={fillColor}
            style={{
              transition: "cx 0.5s ease-out",
              filter: "brightness(1.1)"
            }}
          />
        )}

        {/* 3D overlay */}
        <rect x="10" y="5" width="80" height="40" fill="url(#hTankGradient)" />

        {/* Min/Max labels */}
        {showMinMax && (
          <g>
            <text x="5" y="48" className="fill-muted-foreground" style={{ fontSize: "6px" }}>
              {minValue}
            </text>
            <text x="88" y="48" textAnchor="end" className="fill-muted-foreground" style={{ fontSize: "6px" }}>
              {maxValue}
            </text>
          </g>
        )}
      </svg>

      {/* Value and label below */}
      <div className="text-center">
        {showValue && (
          <p className="text-sm font-semibold">
            {value} <span className="text-xs text-muted-foreground">{unit}</span>
          </p>
        )}
        {label && (
          <p className="text-xs text-muted-foreground truncate max-w-full">{label}</p>
        )}
      </div>
    </div>
  );
}
