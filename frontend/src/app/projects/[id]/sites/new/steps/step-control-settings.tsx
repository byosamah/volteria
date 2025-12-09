"use client";

/**
 * Step 4: Control Settings
 *
 * Configure control parameters:
 * - DG Reserve (kW): Minimum power to keep on generators
 * - Control Interval (ms): How often the control loop runs
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StepProps } from "../wizard-types";

export function StepControlSettings({ formData, updateField }: StepProps) {
  return (
    <div className="space-y-6">
      {/* DG Reserve */}
      <div className="space-y-2">
        <Label htmlFor="dg-reserve">
          DG Reserve (kW) <span className="text-red-500">*</span>
        </Label>
        <Input
          id="dg-reserve"
          type="number"
          min={0}
          step={1}
          value={formData.dgReserveKw}
          onChange={(e) => updateField("dgReserveKw", Number(e.target.value))}
          className="min-h-[44px]"
        />
        <p className="text-xs text-muted-foreground">
          Minimum power (in kW) to maintain on diesel generators.
          Set to 0 for maximum solar utilization.
        </p>
        {/* Helpful info box */}
        <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
          <div className="flex items-start gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <p className="text-xs text-amber-800">
              <strong>Tip:</strong> A DG reserve of 20-50 kW provides a safety buffer
              for sudden load increases. Setting to 0 maximizes solar but may cause
              brief reverse feeding during load transitions.
            </p>
          </div>
        </div>
      </div>

      {/* Control Interval */}
      <div className="space-y-2">
        <Label htmlFor="control-interval">
          Control Interval (ms) <span className="text-red-500">*</span>
        </Label>
        <Input
          id="control-interval"
          type="number"
          min={100}
          max={10000}
          step={100}
          value={formData.controlIntervalMs}
          onChange={(e) => updateField("controlIntervalMs", Number(e.target.value))}
          className="min-h-[44px]"
        />
        <p className="text-xs text-muted-foreground">
          How often the control loop checks and adjusts power (100-10,000 ms).
          Default: 1000 ms (1 second).
        </p>

        {/* Visual interval guide */}
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div
            onClick={() => updateField("controlIntervalMs", 500)}
            className={`
              p-2 rounded border cursor-pointer text-center transition-all
              ${formData.controlIntervalMs === 500
                ? "border-primary bg-primary/10"
                : "border-muted hover:border-muted-foreground/50"
              }
            `}
          >
            <div className="font-medium">500 ms</div>
            <div className="text-muted-foreground">Fast</div>
          </div>
          <div
            onClick={() => updateField("controlIntervalMs", 1000)}
            className={`
              p-2 rounded border cursor-pointer text-center transition-all
              ${formData.controlIntervalMs === 1000
                ? "border-primary bg-primary/10"
                : "border-muted hover:border-muted-foreground/50"
              }
            `}
          >
            <div className="font-medium">1000 ms</div>
            <div className="text-muted-foreground">Standard</div>
          </div>
          <div
            onClick={() => updateField("controlIntervalMs", 2000)}
            className={`
              p-2 rounded border cursor-pointer text-center transition-all
              ${formData.controlIntervalMs === 2000
                ? "border-primary bg-primary/10"
                : "border-muted hover:border-muted-foreground/50"
              }
            `}
          >
            <div className="font-medium">2000 ms</div>
            <div className="text-muted-foreground">Slow</div>
          </div>
        </div>
      </div>

      {/* Summary info */}
      <div className="p-4 rounded-lg bg-muted/50 border">
        <h4 className="text-sm font-medium mb-2">What these settings mean:</h4>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>
            • With <strong>{formData.dgReserveKw} kW</strong> DG reserve, generators will
            maintain at least this power output at all times.
          </li>
          <li>
            • The system will check and adjust every <strong>{formData.controlIntervalMs} ms</strong>{" "}
            ({(formData.controlIntervalMs / 1000).toFixed(1)} seconds).
          </li>
          <li>
            • Faster intervals = quicker response, but more Modbus communication.
          </li>
        </ul>
      </div>
    </div>
  );
}
