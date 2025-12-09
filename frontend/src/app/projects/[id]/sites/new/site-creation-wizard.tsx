"use client";

/**
 * Site Creation Wizard
 *
 * Multi-step wizard for creating a new site with all configuration options.
 * Uses useReducer for state management across 7 steps.
 */

import { useReducer, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import Link from "next/link";

import { WizardStepIndicator } from "./wizard-step-indicator";
import {
  type WizardState,
  type WizardAction,
  type WizardFormData,
  initialWizardState,
  WIZARD_STEPS,
  TOTAL_STEPS,
} from "./wizard-types";

// Step components
import { StepBasicInfo } from "./steps/step-basic-info";
import { StepControlMethod } from "./steps/step-control-method";
import { StepGridOperation } from "./steps/step-grid-operation";
import { StepControlSettings } from "./steps/step-control-settings";
import { StepLoggingSettings } from "./steps/step-logging-settings";
import { StepSafeMode } from "./steps/step-safe-mode";
import { StepReview } from "./steps/step-review";

// ============================================
// REDUCER
// ============================================

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, currentStep: action.step };

    case "NEXT_STEP":
      return {
        ...state,
        currentStep: Math.min(state.currentStep + 1, TOTAL_STEPS),
      };

    case "PREV_STEP":
      return {
        ...state,
        currentStep: Math.max(state.currentStep - 1, 1),
      };

    case "UPDATE_FIELD":
      return {
        ...state,
        formData: { ...state.formData, [action.field]: action.value },
      };

    case "UPDATE_MULTIPLE_FIELDS":
      return {
        ...state,
        formData: { ...state.formData, ...action.fields },
      };

    case "SET_STEP_ERROR":
      return {
        ...state,
        stepErrors: { ...state.stepErrors, [action.step]: action.error },
      };

    case "SET_SUBMITTING":
      return { ...state, isSubmitting: action.isSubmitting };

    case "SET_SUBMIT_ERROR":
      return { ...state, submitError: action.error };

    case "RESET":
      return initialWizardState;

    default:
      return state;
  }
}

// ============================================
// VALIDATION
// ============================================

function validateStep(step: number, formData: WizardFormData): string | null {
  switch (step) {
    case 1: // Basic Information
      if (!formData.name.trim()) return "Site name is required";
      if (formData.name.trim().length < 2) return "Site name must be at least 2 characters";
      return null;

    case 2: // Control Method
      if (!formData.controlMethod) return "Please select a control method";
      return null;

    case 3: // Grid & Operation
      if (!formData.gridConnection) return "Please select grid connection type";
      if (!formData.operationMode) return "Please select an operation mode";
      return null;

    case 4: // Control Settings
      if (formData.dgReserveKw < 0) return "DG Reserve cannot be negative";
      if (formData.controlIntervalMs < 100) return "Control interval must be at least 100ms";
      if (formData.controlIntervalMs > 10000) return "Control interval cannot exceed 10,000ms";
      return null;

    case 5: // Logging Settings
      if (formData.loggingLocalIntervalMs < 100) return "Local logging interval must be at least 100ms";
      if (formData.loggingLocalRetentionDays < 1) return "Local retention must be at least 1 day";
      if (formData.loggingLocalRetentionDays > 90) return "Local retention cannot exceed 90 days";
      return null;

    case 6: // Safe Mode
      if (formData.safeModeEnabled) {
        if (formData.safeModeType === "time_based" && formData.safeModeTimeoutS < 5) {
          return "Timeout must be at least 5 seconds";
        }
        if (formData.safeModeType === "rolling_average") {
          if (formData.safeModeRollingWindowMin < 1) return "Rolling window must be at least 1 minute";
          if (formData.safeModeThresholdPct < 0 || formData.safeModeThresholdPct > 100) {
            return "Threshold must be between 0 and 100%";
          }
        }
      }
      return null;

    case 7: // Review
      return null; // No validation needed, all validated in previous steps

    default:
      return null;
  }
}

// ============================================
// COMPONENT
// ============================================

interface SiteCreationWizardProps {
  projectId: string;
}

export function SiteCreationWizard({ projectId }: SiteCreationWizardProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);

  const { currentStep, formData, stepErrors, isSubmitting, submitError } = state;

  // Update a single field
  const updateField = useCallback(
    <K extends keyof WizardFormData>(field: K, value: WizardFormData[K]) => {
      dispatch({ type: "UPDATE_FIELD", field, value });
      // Clear error when field is updated
      dispatch({ type: "SET_STEP_ERROR", step: currentStep, error: null });
    },
    [currentStep]
  );

  // Navigate to next step (with validation)
  const handleNext = useCallback(() => {
    const error = validateStep(currentStep, formData);
    if (error) {
      dispatch({ type: "SET_STEP_ERROR", step: currentStep, error });
      return;
    }
    dispatch({ type: "SET_STEP_ERROR", step: currentStep, error: null });
    dispatch({ type: "NEXT_STEP" });
  }, [currentStep, formData]);

  // Navigate to previous step
  const handleBack = useCallback(() => {
    dispatch({ type: "PREV_STEP" });
  }, []);

  // Navigate to specific step (for clicking on completed steps or edit links)
  const handleStepClick = useCallback((step: number) => {
    if (step < currentStep) {
      dispatch({ type: "SET_STEP", step });
    }
  }, [currentStep]);

  // Submit the form
  const handleSubmit = useCallback(async () => {
    dispatch({ type: "SET_SUBMITTING", isSubmitting: true });
    dispatch({ type: "SET_SUBMIT_ERROR", error: null });

    try {
      const supabase = createClient();

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("You must be logged in to create a site");
      }

      // Build insert data from formData
      const insertData = {
        project_id: projectId,
        name: formData.name.trim(),
        location: formData.location.trim() || null,
        description: formData.description.trim() || null,

        // Control method (new fields)
        control_method: formData.controlMethod,
        control_method_backup: formData.controlMethodBackup,
        grid_connection: formData.gridConnection,

        // Control settings
        operation_mode: formData.operationMode,
        dg_reserve_kw: formData.dgReserveKw,
        control_interval_ms: formData.controlIntervalMs,

        // Logging settings
        logging_local_interval_ms: formData.loggingLocalIntervalMs,
        logging_local_retention_days: formData.loggingLocalRetentionDays,
        logging_cloud_interval_ms: 5000, // Default cloud sync interval
        logging_cloud_enabled: formData.loggingCloudEnabled,
        logging_gateway_enabled: formData.loggingGatewayEnabled,

        // Safe mode settings
        safe_mode_enabled: formData.safeModeEnabled,
        safe_mode_type: formData.safeModeType,
        safe_mode_timeout_s: formData.safeModeTimeoutS,
        safe_mode_rolling_window_min: formData.safeModeRollingWindowMin,
        safe_mode_threshold_pct: formData.safeModeThresholdPct,
        safe_mode_power_limit_kw: formData.safeModePowerLimitKw || null,

        // System fields
        controller_status: "offline",
        is_active: true,
        created_by: user.id,
      };

      const { data, error } = await supabase
        .from("sites")
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      // Success - show toast and redirect
      toast.success("Site created successfully!");
      router.push(`/projects/${projectId}/sites/${data.id}`);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to create site";
      dispatch({ type: "SET_SUBMIT_ERROR", error: errorMessage });
      toast.error(errorMessage);
    } finally {
      dispatch({ type: "SET_SUBMITTING", isSubmitting: false });
    }
  }, [projectId, formData, router]);

  // Get current step info
  const currentStepInfo = WIZARD_STEPS[currentStep - 1];
  const currentError = stepErrors[currentStep];

  // Render step content
  const renderStepContent = () => {
    const stepProps = {
      formData,
      updateField,
      error: currentError,
    };

    switch (currentStep) {
      case 1:
        return <StepBasicInfo {...stepProps} />;
      case 2:
        return <StepControlMethod {...stepProps} />;
      case 3:
        return <StepGridOperation {...stepProps} />;
      case 4:
        return <StepControlSettings {...stepProps} />;
      case 5:
        return <StepLoggingSettings {...stepProps} />;
      case 6:
        return <StepSafeMode {...stepProps} />;
      case 7:
        return <StepReview {...stepProps} onEditStep={handleStepClick} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-4">
        <Link
          href={`/projects/${projectId}`}
          className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Create New Site</h1>
          <p className="text-muted-foreground">
            Step {currentStep} of {TOTAL_STEPS}: {currentStepInfo?.title}
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <WizardStepIndicator
        currentStep={currentStep}
        onStepClick={handleStepClick}
      />

      {/* Main content card */}
      <Card>
        <CardHeader>
          <CardTitle>{currentStepInfo?.title}</CardTitle>
          <CardDescription>{currentStepInfo?.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Step content */}
          {renderStepContent()}

          {/* Error message */}
          {currentError && (
            <div className="mt-4 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
              {currentError}
            </div>
          )}

          {/* Submit error (for step 7) */}
          {submitError && currentStep === TOTAL_STEPS && (
            <div className="mt-4 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
              {submitError}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation buttons */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={currentStep === 1}
          className="min-h-[44px]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 mr-2"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </Button>

        {currentStep < TOTAL_STEPS ? (
          <Button onClick={handleNext} className="min-h-[44px]">
            Next
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4 ml-2"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="min-h-[44px]"
          >
            {isSubmitting ? (
              <>
                <svg
                  className="animate-spin h-4 w-4 mr-2"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Creating...
              </>
            ) : (
              <>
                Create Site
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4 ml-2"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
