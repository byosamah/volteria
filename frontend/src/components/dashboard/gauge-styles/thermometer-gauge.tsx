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
  // Calculate fill height (from bulb up)
  const tubeHeight = 70;
  const fillHeight = (percentage / 100) * tubeHeight;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1">
      <svg viewBox="0 0 40 100" className="w-full h-full max-w-[50px] max-h-[160px]">
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
          x="15"
          y="8"
          width="10"
          height={tubeHeight}
          rx="5"
          fill="#e5e7eb"
        />

        {/* Bulb background */}
        <circle cx="20" cy="85" r="12" fill="#e5e7eb" />

        {/* Fill in bulb (always full) */}
        <circle cx="20" cy="85" r="10" fill={fillColor} />

        {/* Fill in tube */}
        <rect
          x="16"
          y={78 - fillHeight}
          width="8"
          height={fillHeight + 2}
          rx="4"
          fill={fillColor}
          style={{ transition: "y 0.5s ease-out, height 0.5s ease-out" }}
        />

        {/* Glass overlay */}
        <rect
          x="15"
          y="8"
          width="10"
          height={tubeHeight}
          rx="5"
          fill="url(#thermGradient)"
        />

        {/* Scale marks */}
        <g stroke="#9ca3af" strokeWidth="1">
          <line x1="26" y1="12" x2="30" y2="12" />
          <line x1="26" y1="28" x2="28" y2="28" />
          <line x1="26" y1="44" x2="30" y2="44" />
          <line x1="26" y1="60" x2="28" y2="60" />
          <line x1="26" y1="76" x2="30" y2="76" />
        </g>

        {/* Min/Max labels */}
        {showMinMax && (
          <g>
            <text x="32" y="80" className="fill-muted-foreground" style={{ fontSize: "6px" }}>
              {minValue}
            </text>
            <text x="32" y="14" className="fill-muted-foreground" style={{ fontSize: "6px" }}>
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
