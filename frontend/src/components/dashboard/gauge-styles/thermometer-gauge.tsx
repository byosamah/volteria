"use client";

/**
 * Thermometer Gauge
 *
 * Classic thermometer style with bulb at bottom and rising fill.
 * Modern flat design with scale marks.
 */

interface ThermometerGaugeProps {
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

export function ThermometerGauge({
  percentage,
  value,
  unit,
  minValue,
  maxValue,
  label,
  fillColor,
  showValue,
  showMinMax,
}: ThermometerGaugeProps) {
  // Tube dimensions
  const tubeTop = 8;
  const tubeBottom = 72;
  const tubeHeight = tubeBottom - tubeTop;

  // Calculate fill height (from bulb up)
  const fillHeight = (percentage / 100) * tubeHeight;
  const fillTop = tubeBottom - fillHeight;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center min-h-0">
      <svg viewBox="0 0 50 100" className="w-full h-full flex-1" preserveAspectRatio="xMidYMid meet">
        <defs>
          {/* Gradient for glass effect */}
          <linearGradient id="thermGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.3)" />
            <stop offset="50%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.1)" />
          </linearGradient>
        </defs>

        {/* Thermometer tube background */}
        <rect
          x="20"
          y={tubeTop}
          width="10"
          height={tubeHeight}
          rx="5"
          fill="#e5e7eb"
        />

        {/* Bulb background */}
        <circle cx="25" cy="82" r="10" fill="#e5e7eb" />

        {/* Fill in bulb (always full) */}
        <circle cx="25" cy="82" r="8" fill={fillColor} />

        {/* Fill in tube */}
        <rect
          x="21"
          y={fillTop}
          width="8"
          height={fillHeight + 12}
          rx="4"
          fill={fillColor}
          style={{ transition: "y 0.5s ease-out, height 0.5s ease-out" }}
        />

        {/* Glass overlay */}
        <rect
          x="20"
          y={tubeTop}
          width="10"
          height={tubeHeight}
          rx="5"
          fill="url(#thermGradient)"
        />

        {/* Scale marks */}
        <g stroke="#9ca3af" strokeWidth="1">
          <line x1="31" y1={tubeTop + 2} x2="35" y2={tubeTop + 2} />
          <line x1="31" y1={tubeTop + tubeHeight * 0.25} x2="33" y2={tubeTop + tubeHeight * 0.25} />
          <line x1="31" y1={tubeTop + tubeHeight * 0.5} x2="35" y2={tubeTop + tubeHeight * 0.5} />
          <line x1="31" y1={tubeTop + tubeHeight * 0.75} x2="33" y2={tubeTop + tubeHeight * 0.75} />
          <line x1="31" y1={tubeBottom - 2} x2="35" y2={tubeBottom - 2} />
        </g>

        {/* Min/Max labels */}
        {showMinMax && (
          <g>
            <text x="38" y={tubeBottom} className="fill-muted-foreground" style={{ fontSize: "7px" }}>
              {minValue}
            </text>
            <text x="38" y={tubeTop + 5} className="fill-muted-foreground" style={{ fontSize: "7px" }}>
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
          <p className="text-xs text-muted-foreground truncate px-1">{label}</p>
        )}
      </div>
    </div>
  );
}
