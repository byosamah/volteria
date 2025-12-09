"use client";

/**
 * Step 2: Control Method
 *
 * Select how the site will be controlled:
 * - On-site Local Controller (Raspberry Pi)
 * - Remote Control via Gateway API (Netbiter)
 */

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StepProps, ControlMethod, ControlMethodBackup } from "../wizard-types";

export function StepControlMethod({ formData, updateField }: StepProps) {
  const isOnsiteController = formData.controlMethod === "onsite_controller";

  return (
    <div className="space-y-6">
      {/* Control Method Selection */}
      <div className="space-y-3">
        <Label>
          Control Method <span className="text-red-500">*</span>
        </Label>
        <p className="text-sm text-muted-foreground">
          Choose how the site&apos;s control logic will be executed
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* On-site Controller Option */}
          <button
            type="button"
            onClick={() => updateField("controlMethod", "onsite_controller")}
            className={`
              p-4 rounded-lg border-2 text-left transition-all
              ${formData.controlMethod === "onsite_controller"
                ? "border-primary bg-primary/5"
                : "border-muted hover:border-muted-foreground/50"
              }
            `}
          >
            <div className="flex items-start gap-3">
              <div className={`
                w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5
                ${formData.controlMethod === "onsite_controller"
                  ? "border-primary"
                  : "border-muted-foreground/50"
                }
              `}>
                {formData.controlMethod === "onsite_controller" && (
                  <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {/* Controller Icon */}
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary">
                    <rect width="20" height="14" x="2" y="3" rx="2"/>
                    <line x1="8" x2="16" y1="21" y2="21"/>
                    <line x1="12" x2="12" y1="17" y2="21"/>
                  </svg>
                  <span className="font-semibold">On-site Local Controller</span>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Raspberry Pi runs control logic locally. Works offline with fastest response time.
                </p>
                <div className="flex items-center gap-2 mt-3 text-xs text-green-600">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Recommended for most sites
                </div>
              </div>
            </div>
          </button>

          {/* Gateway API Option */}
          <button
            type="button"
            onClick={() => updateField("controlMethod", "gateway_api")}
            className={`
              p-4 rounded-lg border-2 text-left transition-all
              ${formData.controlMethod === "gateway_api"
                ? "border-primary bg-primary/5"
                : "border-muted hover:border-muted-foreground/50"
              }
            `}
          >
            <div className="flex items-start gap-3">
              <div className={`
                w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5
                ${formData.controlMethod === "gateway_api"
                  ? "border-primary"
                  : "border-muted-foreground/50"
                }
              `}>
                {formData.controlMethod === "gateway_api" && (
                  <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {/* Cloud Icon */}
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-blue-500">
                    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
                  </svg>
                  <span className="font-semibold">Gateway API (Netbiter)</span>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Server sends commands through Netbiter gateway. Requires stable internet connection.
                </p>
                <div className="flex items-center gap-2 mt-3 text-xs text-amber-600">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  Requires internet
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Backup Method */}
      <div className="space-y-2">
        <Label htmlFor="backup-method">Backup Method</Label>
        <Select
          value={formData.controlMethodBackup}
          onValueChange={(value: ControlMethodBackup) => updateField("controlMethodBackup", value)}
        >
          <SelectTrigger id="backup-method" className="min-h-[44px]">
            <SelectValue placeholder="Select backup method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No backup method</SelectItem>
            {isOnsiteController && (
              <SelectItem value="gateway_backup">
                Switch to Gateway API if controller fails
              </SelectItem>
            )}
            {!isOnsiteController && (
              <SelectItem value="controller_backup" disabled>
                Switch to Controller (not yet supported)
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          What happens if the primary control method fails
        </p>
      </div>

      {/* Info box for Gateway API */}
      {!isOnsiteController && (
        <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
          <div className="flex items-start gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-blue-600 mt-0.5">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <div>
              <p className="text-sm font-medium text-blue-800">Gateway API Mode</p>
              <p className="text-sm text-blue-700 mt-1">
                You&apos;ll need to configure your Netbiter gateway after creating the site.
                The gateway must be online and accessible from the internet.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
