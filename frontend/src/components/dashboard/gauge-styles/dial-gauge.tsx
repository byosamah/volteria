"use client";

/**
 * Dial Gauge (Speedometer Style)
 *
 * Circular gauge with an arc background and needle indicator.
 * Modern flat design with smooth CSS transitions.
 */

import { useMemo } from "react";

interface DialGaugeProps {
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

export function DialGauge({
  percentage,
  value,
  unit,
  minValue,
  maxValue,
  label,
  fillColor,
  showValue,
  showMinMax,
}: DialGaugeProps) {
  // Arc configuration - speedometer open at bottom
  const startAngle = 225; // degrees from top (0 = 12 o'clock) - bottom-left (7:30)
  const endAngle = 495; // 270 degree sweep ending at bottom-right (4:30)
  const sweepAngle = endAngle - startAngle; // 270 degrees

  // Calculate arc paths
  const { backgroundPath, fillPath, needleRotation } = useMemo(() => {
    const cx = 50;
    const cy = 45; // Moved up slightly to make room for labels
    const radius = 35;

    // Convert angles to radians (SVG uses clockwise from 3 o'clock)
    const toRadians = (deg: number) => ((deg - 90) * Math.PI) / 180;

    // Calculate arc endpoints
    const startRad = toRadians(startAngle);
    const endRad = toRadians(endAngle);
    const fillEndRad = toRadians(startAngle + (sweepAngle * percentage) / 100);

    const startX = cx + radius * Math.cos(startRad);
    const startY = cy + radius * Math.sin(startRad);
    const endX = cx + radius * Math.cos(endRad);
    const endY = cy + radius * Math.sin(endRad);
    const fillEndX = cx + radius * Math.cos(fillEndRad);
    const fillEndY = cy + radius * Math.sin(fillEndRad);

    // Large arc flag (1 if angle > 180)
    const backgroundLargeArc = sweepAngle > 180 ? 1 : 0;
    const fillAngle = (sweepAngle * percentage) / 100;
    const fillLargeArc = fillAngle > 180 ? 1 : 0;

    const bgPath = `M ${startX} ${startY} A ${radius} ${radius} 0 ${backgroundLargeArc} 1 ${endX} ${endY}`;
    const fPath = percentage > 0
      ? `M ${startX} ${startY} A ${radius} ${radius} 0 ${fillLargeArc} 1 ${fillEndX} ${fillEndY}`
      : "";

    // Needle points to current value angle
    const needleAngle = startAngle + (sweepAngle * percentage) / 100;

    return {
      backgroundPath: bgPath,
      fillPath: fPath,
      needleRotation: needleAngle,
    };
  }, [percentage, startAngle, sweepAngle]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center min-h-0">
      <svg viewBox="0 0 100 95" className="w-full h-full flex-1" preserveAspectRatio="xMidYMid meet">
        {/* Background arc */}
        <path
          d={backgroundPath}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="8"
          strokeLinecap="round"
        />

        {/* Filled arc */}
        <path
          d={fillPath}
          fill="none"
          stroke={fillColor}
          strokeWidth="8"
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.5s ease-out" }}
        />

        {/* Needle */}
        <g transform={`rotate(${needleRotation} 50 45)`} style={{ transition: "transform 0.5s ease-out" }}>
          <line
            x1="50"
            y1="45"
            x2="50"
            y2="15"
            stroke="#374151"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="50" cy="45" r="4" fill="#374151" />
        </g>

        {/* Center value */}
        {showValue && (
          <g>
            <text
              x="50"
              y="58"
              textAnchor="middle"
              className="font-bold fill-foreground"
              style={{ fontSize: "10px" }}
            >
              {value}
            </text>
            {unit && (
              <text
                x="50"
                y="68"
                textAnchor="middle"
                className="fill-muted-foreground"
                style={{ fontSize: "7px" }}
              >
                {unit}
              </text>
            )}
          </g>
        )}

        {/* Min/Max labels - positioned at arc ends (bottom-left=min, bottom-right=max) */}
        {showMinMax && (
          <g>
            <text
              x="18"
              y="78"
              textAnchor="start"
              className="fill-muted-foreground"
              style={{ fontSize: "8px" }}
            >
              {minValue}
            </text>
            <text
              x="82"
              y="78"
              textAnchor="end"
              className="fill-muted-foreground"
              style={{ fontSize: "8px" }}
            >
              {maxValue}
            </text>
          </g>
        )}
      </svg>

      {/* Label below */}
      {label && (
        <p className="text-xs text-muted-foreground text-center truncate w-full px-1">
          {label}
        </p>
      )}
    </div>
  );
}
