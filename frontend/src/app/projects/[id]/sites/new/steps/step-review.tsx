"use client";

/**
 * Step 7: Review & Create
 *
 * Summary of all configured settings with edit links
 * to jump back to specific steps.
 */

import { Badge } from "@/components/ui/badge";
import type { StepProps } from "../wizard-types";

interface StepReviewProps extends StepProps {
  onEditStep: (step: number) => void;
}

export function StepReview({ formData, onEditStep }: StepReviewProps) {
  // Helper to format control method display
  const formatControlMethod = (method: string) => {
    switch (method) {
      case "onsite_controller":
        return "On-site Local Controller";
      case "gateway_api":
        return "Gateway API (Netbiter)";
      default:
        return method;
    }
  };

  // Helper to format backup method display
  const formatBackupMethod = (method: string) => {
    switch (method) {
      case "none":
        return "No backup";
      case "gateway_backup":
        return "Switch to Gateway API";
      case "controller_backup":
        return "Switch to Controller";
      default:
        return method;
    }
  };

  // Helper to format grid connection
  const formatGridConnection = (connection: string) => {
    switch (connection) {
      case "off_grid":
        return "Off-grid (Diesel + Solar)";
      case "on_grid":
        return "On-grid";
      default:
        return connection;
    }
  };

  // Helper to format operation mode
  const formatOperationMode = (mode: string) => {
    switch (mode) {
      case "zero_dg_reverse":
        return "DG Reserve / Zero DG Reverse";
      case "peak_shaving":
        return "Peak Shaving";
      case "manual":
        return "Manual Control";
      default:
        return mode;
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Review your site configuration below. Click &quot;Edit&quot; to make changes to any section.
      </p>

      {/* Section 1: Basic Information */}
      <ReviewSection title="Basic Information" step={1} onEdit={onEditStep}>
        <ReviewItem label="Site Name" value={formData.name} required />
        <ReviewItem label="Location" value={formData.location || "Not specified"} />
        <ReviewItem
          label="Description"
          value={formData.description || "Not specified"}
          truncate
        />
      </ReviewSection>

      {/* Section 2: Control Method */}
      <ReviewSection title="Control Method" step={2} onEdit={onEditStep}>
        <ReviewItem
          label="Primary Method"
          value={formatControlMethod(formData.controlMethod)}
        />
        <ReviewItem
          label="Backup Method"
          value={formatBackupMethod(formData.controlMethodBackup)}
        />
      </ReviewSection>

      {/* Section 3: Grid & Operation */}
      <ReviewSection title="Grid & Operation" step={3} onEdit={onEditStep}>
        <ReviewItem
          label="Grid Connection"
          value={formatGridConnection(formData.gridConnection)}
        />
        <ReviewItem
          label="Operation Mode"
          value={formatOperationMode(formData.operationMode)}
        />
      </ReviewSection>

      {/* Section 4: Control Settings */}
      <ReviewSection title="Control Settings" step={4} onEdit={onEditStep}>
        <ReviewItem
          label="DG Reserve"
          value={`${formData.dgReserveKw} kW`}
        />
        <ReviewItem
          label="Control Interval"
          value={`${formData.controlIntervalMs} ms (${(formData.controlIntervalMs / 1000).toFixed(1)}s)`}
        />
      </ReviewSection>

      {/* Section 5: Logging Settings */}
      <ReviewSection title="Logging Settings" step={5} onEdit={onEditStep}>
        <ReviewItem
          label="Local Logging Interval"
          value={`${formData.loggingLocalIntervalMs} ms`}
        />
        <ReviewItem
          label="Local Retention"
          value={`${formData.loggingLocalRetentionDays} days`}
        />
        <ReviewItem
          label="Cloud Logging"
          value={
            <Badge variant={formData.loggingCloudEnabled ? "default" : "secondary"}>
              {formData.loggingCloudEnabled ? "Enabled" : "Disabled"}
            </Badge>
          }
        />
        {formData.controlMethod === "gateway_api" && (
          <ReviewItem
            label="Gateway Logging"
            value={
              <Badge variant={formData.loggingGatewayEnabled ? "default" : "secondary"}>
                {formData.loggingGatewayEnabled ? "Enabled" : "Disabled"}
              </Badge>
            }
          />
        )}
      </ReviewSection>

      {/* Section 6: Safe Mode */}
      <ReviewSection title="Safe Mode" step={6} onEdit={onEditStep}>
        <ReviewItem
          label="Status"
          value={
            <Badge variant={formData.safeModeEnabled ? "default" : "destructive"}>
              {formData.safeModeEnabled ? "Enabled" : "Disabled"}
            </Badge>
          }
        />
        {formData.safeModeEnabled && (
          <>
            <ReviewItem
              label="Type"
              value={formData.safeModeType === "time_based" ? "Time-based" : "Rolling Average"}
            />
            {formData.safeModeType === "time_based" ? (
              <ReviewItem
                label="Timeout"
                value={`${formData.safeModeTimeoutS} seconds`}
              />
            ) : (
              <>
                <ReviewItem
                  label="Rolling Window"
                  value={`${formData.safeModeRollingWindowMin} minutes`}
                />
                <ReviewItem
                  label="Threshold"
                  value={`${formData.safeModeThresholdPct}%`}
                />
              </>
            )}
            <ReviewItem
              label="Power Limit"
              value={
                formData.safeModePowerLimitKw > 0
                  ? `${formData.safeModePowerLimitKw} kW`
                  : "Stop solar completely (0 kW)"
              }
            />
          </>
        )}
      </ReviewSection>

      {/* Final note */}
      <div className="p-4 rounded-lg bg-green-50 border border-green-200">
        <div className="flex items-start gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <div>
            <p className="text-sm font-medium text-green-800">Ready to Create</p>
            <p className="text-sm text-green-700 mt-1">
              Click &quot;Create Site&quot; below to create your site with these settings.
              You can modify most settings after creation from the site settings page.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// HELPER COMPONENTS
// ============================================

interface ReviewSectionProps {
  title: string;
  step: number;
  onEdit: (step: number) => void;
  children: React.ReactNode;
}

function ReviewSection({ title, step, onEdit, children }: ReviewSectionProps) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/50">
        <h3 className="font-medium">{title}</h3>
        <button
          type="button"
          onClick={() => onEdit(step)}
          className="text-sm text-primary hover:underline flex items-center gap-1"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
            <path d="m15 5 4 4"/>
          </svg>
          Edit
        </button>
      </div>
      <div className="px-4 py-3 space-y-2">
        {children}
      </div>
    </div>
  );
}

interface ReviewItemProps {
  label: string;
  value: React.ReactNode;
  required?: boolean;
  truncate?: boolean;
}

function ReviewItem({ label, value, required, truncate }: ReviewItemProps) {
  return (
    <div className="flex justify-between items-start text-sm">
      <span className="text-muted-foreground">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </span>
      <span className={`font-medium text-right ${truncate ? "max-w-[200px] truncate" : ""}`}>
        {value}
      </span>
    </div>
  );
}
