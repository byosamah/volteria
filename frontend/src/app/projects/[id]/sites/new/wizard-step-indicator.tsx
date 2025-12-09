"use client";

/**
 * Wizard Step Indicator
 *
 * Visual progress indicator showing:
 * - Completed steps (checkmark)
 * - Current step (highlighted)
 * - Upcoming steps (dimmed)
 *
 * Allows clicking on completed steps to navigate back.
 */

import { WIZARD_STEPS, type StepDefinition } from "./wizard-types";

interface WizardStepIndicatorProps {
  currentStep: number;
  onStepClick: (step: number) => void;
}

export function WizardStepIndicator({ currentStep, onStepClick }: WizardStepIndicatorProps) {
  return (
    <div className="w-full">
      {/* Desktop: Horizontal stepper */}
      <div className="hidden sm:flex items-center justify-between">
        {WIZARD_STEPS.map((step, index) => (
          <StepItem
            key={step.number}
            step={step}
            isCompleted={step.number < currentStep}
            isCurrent={step.number === currentStep}
            isClickable={step.number < currentStep}
            onClick={() => onStepClick(step.number)}
            isLast={index === WIZARD_STEPS.length - 1}
          />
        ))}
      </div>

      {/* Mobile: Compact indicator with current step name */}
      <div className="sm:hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">
            Step {currentStep} of {WIZARD_STEPS.length}
          </span>
          <span className="text-sm font-medium">
            {WIZARD_STEPS[currentStep - 1]?.title}
          </span>
        </div>
        {/* Progress bar */}
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((currentStep - 1) / (WIZARD_STEPS.length - 1)) * 100}%` }}
          />
        </div>
        {/* Step dots */}
        <div className="flex justify-between mt-2">
          {WIZARD_STEPS.map((step) => (
            <button
              key={step.number}
              onClick={() => step.number < currentStep && onStepClick(step.number)}
              disabled={step.number >= currentStep}
              className={`
                w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium
                transition-all duration-200
                ${step.number < currentStep
                  ? "bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90"
                  : step.number === currentStep
                    ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                }
              `}
            >
              {step.number < currentStep ? (
                <CheckIcon className="w-3 h-3" />
              ) : (
                step.number
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Individual step item for desktop view
interface StepItemProps {
  step: StepDefinition;
  isCompleted: boolean;
  isCurrent: boolean;
  isClickable: boolean;
  onClick: () => void;
  isLast: boolean;
}

function StepItem({ step, isCompleted, isCurrent, isClickable, onClick, isLast }: StepItemProps) {
  return (
    <div className="flex items-center flex-1">
      {/* Step circle and label */}
      <div className="flex flex-col items-center">
        <button
          onClick={onClick}
          disabled={!isClickable}
          className={`
            w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium
            transition-all duration-200
            ${isCompleted
              ? "bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90"
              : isCurrent
                ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            }
          `}
        >
          {isCompleted ? (
            <CheckIcon className="w-5 h-5" />
          ) : (
            step.number
          )}
        </button>
        <span
          className={`
            mt-2 text-xs font-medium text-center max-w-[80px]
            ${isCurrent ? "text-foreground" : "text-muted-foreground"}
          `}
        >
          {step.shortTitle}
        </span>
      </div>

      {/* Connector line (except for last step) */}
      {!isLast && (
        <div
          className={`
            flex-1 h-0.5 mx-2
            ${isCompleted ? "bg-primary" : "bg-muted"}
          `}
        />
      )}
    </div>
  );
}

// Checkmark icon
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
