"use client";

/**
 * Step 3: Grid & Operation Mode
 *
 * Select grid connection type and operation mode.
 * - On-grid: Coming soon (disabled)
 * - Off-grid: Currently supported
 */

import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { StepProps } from "../wizard-types";

export function StepGridOperation({ formData, updateField }: StepProps) {
  return (
    <div className="space-y-6">
      {/* Grid Connection */}
      <div className="space-y-3">
        <Label>
          Grid Connection <span className="text-red-500">*</span>
        </Label>
        <p className="text-sm text-muted-foreground">
          Select the type of grid connection for this site
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Off-grid Option (Enabled) */}
          <button
            type="button"
            onClick={() => updateField("gridConnection", "off_grid")}
            className={`
              p-4 rounded-lg border-2 text-left transition-all
              ${formData.gridConnection === "off_grid"
                ? "border-primary bg-primary/5"
                : "border-muted hover:border-muted-foreground/50"
              }
            `}
          >
            <div className="flex items-start gap-3">
              <div className={`
                w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5
                ${formData.gridConnection === "off_grid"
                  ? "border-primary"
                  : "border-muted-foreground/50"
                }
              `}>
                {formData.gridConnection === "off_grid" && (
                  <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {/* Off-grid Icon */}
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-orange-500">
                    <circle cx="12" cy="12" r="5"/>
                    <line x1="12" y1="1" x2="12" y2="3"/>
                    <line x1="12" y1="21" x2="12" y2="23"/>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                    <line x1="1" y1="12" x2="3" y2="12"/>
                    <line x1="21" y1="12" x2="23" y2="12"/>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                  </svg>
                  <span className="font-semibold">Off-grid</span>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Diesel generators + solar system. No grid connection.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Prevents reverse feeding to generator
                </p>
              </div>
            </div>
          </button>

          {/* On-grid Option (Disabled - Coming Soon) */}
          <div className="p-4 rounded-lg border-2 border-muted bg-muted/30 opacity-60 cursor-not-allowed">
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {/* On-grid Icon */}
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-muted-foreground">
                    <path d="M18 6 6 18"/>
                    <path d="m6 6 12 12"/>
                  </svg>
                  <span className="font-semibold text-muted-foreground">On-grid</span>
                  <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Grid-connected with solar and optional battery storage.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Operation Mode (for Off-grid) */}
      {formData.gridConnection === "off_grid" && (
        <div className="space-y-3">
          <Label>
            Operation Mode <span className="text-red-500">*</span>
          </Label>
          <p className="text-sm text-muted-foreground">
            Select how the control system should operate
          </p>

          <div className="space-y-3">
            {/* Generator Reserve / Zero Generator Feed (Enabled) */}
            <button
              type="button"
              onClick={() => updateField("operationMode", "zero_generator_feed")}
              className={`
                w-full p-4 rounded-lg border-2 text-left transition-all
                ${formData.operationMode === "zero_generator_feed"
                  ? "border-primary bg-primary/5"
                  : "border-muted hover:border-muted-foreground/50"
                }
              `}
            >
              <div className="flex items-start gap-3">
                <div className={`
                  w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5
                  ${formData.operationMode === "zero_generator_feed"
                    ? "border-primary"
                    : "border-muted-foreground/50"
                  }
                `}>
                  {formData.operationMode === "zero_generator_feed" && (
                    <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                  )}
                </div>
                <div className="flex-1">
                  <span className="font-semibold">Generator Reserve / Zero Generator Feed</span>
                  <p className="text-sm text-muted-foreground mt-1">
                    Limits solar output to prevent reverse power flow to generators.
                    Maintains a configurable generator reserve power level.
                  </p>
                </div>
              </div>
            </button>

            {/* Peak Shaving (Disabled) */}
            <div className="w-full p-4 rounded-lg border-2 border-muted bg-muted/30 opacity-60 cursor-not-allowed">
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-muted-foreground">Peak Shaving</span>
                    <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Reduce peak demand charges by limiting maximum power draw.
                  </p>
                </div>
              </div>
            </div>

            {/* Manual Mode (Disabled) */}
            <div className="w-full p-4 rounded-lg border-2 border-muted bg-muted/30 opacity-60 cursor-not-allowed">
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-muted-foreground">Manual Control</span>
                    <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Manually set solar power limits through the dashboard.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
