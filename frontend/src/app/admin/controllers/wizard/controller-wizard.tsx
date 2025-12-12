"use client";

/**
 * Controller Setup Wizard Component
 *
 * Multi-step wizard with 7 steps:
 * 1. Hardware Info - Enter serial number, select hardware type
 * 2. Flash Image - Write Raspberry Pi OS to SD card (Balena Etcher)
 * 3. Software Setup - Run setup script (+ NVMe boot config if applicable)
 * 4. Network Setup - WiFi/Ethernet configuration
 * 5. Cloud Connection - Generate & download config.yaml
 * 6. Verify Online - Wait for heartbeat
 * 7. Run Tests - Simulated device tests
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// Step components
import { StepHardwareInfo } from "./steps/step-hardware-info";
import { StepDownloadImage } from "./steps/step-download-image";
import { StepFlashInstructions } from "./steps/step-flash-instructions";
import { StepNetworkSetup } from "./steps/step-network-setup";
import { StepCloudConnection } from "./steps/step-cloud-connection";
import { StepVerifyOnline } from "./steps/step-verify-online";
import { StepRunTests } from "./steps/step-run-tests";

// Step definitions
// NOTE: Step 2 and 3 were swapped to match the physical process:
// First flash the OS to SD card, THEN run the setup script
const STEPS = [
  { number: 1, name: "Hardware Info", description: "Enter controller details" },
  { number: 2, name: "Flash Image", description: "Write image to SD card" },
  { number: 3, name: "Software Setup", description: "Install controller software" },
  { number: 4, name: "Network Setup", description: "Connect to network" },
  { number: 5, name: "Cloud Connection", description: "Configure cloud access" },
  { number: 6, name: "Verify Online", description: "Confirm controller is online" },
  { number: 7, name: "Run Tests", description: "Test controller functionality" },
];

interface HardwareType {
  id: string;
  name: string;
  hardware_type: string;
}

interface ExistingController {
  id: string;
  serial_number: string;
  hardware_type_id: string;
  firmware_version: string | null;
  notes: string | null;
  wizard_step: number | null;
  status: string;
}

interface ControllerWizardProps {
  hardwareTypes: HardwareType[];
  existingController: ExistingController | null;
}

export function ControllerWizard({ hardwareTypes, existingController }: ControllerWizardProps) {
  const router = useRouter();
  const supabase = createClient();

  // Controller data state
  const [controllerId, setControllerId] = useState<string | null>(existingController?.id || null);
  const [controllerData, setControllerData] = useState({
    serial_number: existingController?.serial_number || "",
    hardware_type_id: existingController?.hardware_type_id || "",
    firmware_version: existingController?.firmware_version || "",
    notes: existingController?.notes || "",
  });

  // Wizard state
  const [currentStep, setCurrentStep] = useState(existingController?.wizard_step || 1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [stepConfirmed, setStepConfirmed] = useState(false);

  // Initialize completed steps based on existing wizard_step
  useEffect(() => {
    if (existingController?.wizard_step) {
      const completed = [];
      for (let i = 1; i < existingController.wizard_step; i++) {
        completed.push(i);
      }
      setCompletedSteps(completed);
    }
  }, [existingController]);

  // Save wizard progress to database
  const saveWizardProgress = async (step: number) => {
    if (!controllerId) return;

    const { error } = await supabase
      .from("controllers")
      .update({
        wizard_step: step,
      })
      .eq("id", controllerId);

    if (error) {
      console.error("Error saving wizard progress:", error);
    }
  };

  // Handle step 1 completion (create controller)
  const handleCreateController = async (data: typeof controllerData) => {
    setLoading(true);
    try {
      // Validate required fields
      if (!data.serial_number.trim()) {
        toast.error("Serial number is required");
        return false;
      }
      if (!data.hardware_type_id) {
        toast.error("Hardware type is required");
        return false;
      }

      // First check if a controller with this serial number already exists
      const { data: existingCheck } = await supabase
        .from("controllers")
        .select("id, wizard_step, status")
        .eq("serial_number", data.serial_number.trim())
        .maybeSingle();

      if (existingCheck) {
        // Controller already exists - offer to resume or show error
        if (existingCheck.wizard_step !== null) {
          // Has incomplete wizard - redirect to resume it
          toast.info("Controller already exists. Resuming setup wizard...");
          router.push(`/admin/controllers/wizard?id=${existingCheck.id}`);
          return false;
        } else {
          // Wizard already completed
          toast.error(
            `Serial number already registered (status: ${existingCheck.status}). ` +
            "Use a different serial number or edit the existing controller."
          );
          return false;
        }
      }

      // Create controller in database
      const { data: newController, error } = await supabase
        .from("controllers")
        .insert({
          serial_number: data.serial_number.trim(),
          hardware_type_id: data.hardware_type_id,
          firmware_version: data.firmware_version.trim() || null,
          notes: data.notes.trim() || null,
          status: "draft",
          wizard_step: 1,
          wizard_started_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (error) {
        // This should rarely happen now since we check first
        if (error.code === "23505") {
          toast.error("Serial number already exists. Please refresh and try again.");
        } else {
          toast.error(error.message || "Failed to create controller");
        }
        return false;
      }

      setControllerId(newController.id);
      setControllerData(data);
      toast.success("Controller registered successfully");
      return true;
    } catch (err) {
      console.error("Error creating controller:", err);
      toast.error("An unexpected error occurred");
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Handle moving to next step
  const handleNextStep = async () => {
    // Prevent double-clicks
    if (loading) return;

    if (currentStep === 1 && !controllerId) {
      // Step 1 requires creating the controller first
      const success = await handleCreateController(controllerData);
      if (!success) return;
    }

    // Mark current step as completed
    if (!completedSteps.includes(currentStep)) {
      setCompletedSteps([...completedSteps, currentStep]);
    }

    // Move to next step
    const nextStep = currentStep + 1;
    setCurrentStep(nextStep);
    setStepConfirmed(false);

    // Save progress
    await saveWizardProgress(nextStep);
  };

  // Handle going back
  const handlePrevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      setStepConfirmed(false);
    }
  };

  // Handle save and exit
  const handleSaveAndExit = async () => {
    if (controllerId) {
      await saveWizardProgress(currentStep);
      toast.success("Progress saved. You can continue later.");
    }
    router.push("/admin/controllers");
  };

  // Handle wizard completion
  const handleWizardComplete = async (passed: boolean) => {
    if (!controllerId) return;

    const newStatus = passed ? "ready" : "failed";

    const { error } = await supabase
      .from("controllers")
      .update({
        status: newStatus,
        wizard_step: null, // Clear wizard step on completion
      })
      .eq("id", controllerId);

    if (error) {
      toast.error("Failed to update controller status");
      return;
    }

    if (passed) {
      toast.success("Controller setup complete! Status: Ready");
    } else {
      toast.error("Controller tests failed. Status: Failed");
    }

    router.push("/admin/controllers");
  };

  // Render current step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <StepHardwareInfo
            hardwareTypes={hardwareTypes}
            data={controllerData}
            onChange={setControllerData}
            isExisting={!!existingController}
          />
        );
      case 2:
        // Step 2: Flash Image (write OS to SD card first)
        return (
          <StepFlashInstructions
            onConfirm={setStepConfirmed}
            confirmed={stepConfirmed}
          />
        );
      case 3:
        // Step 3: Software Setup (run setup script after OS is flashed)
        // Find the selected hardware type to pass to Step 3
        // This allows Step 3 to show hardware-specific instructions (e.g., NVMe boot)
        const selectedHardware = hardwareTypes.find(
          (h) => h.id === controllerData.hardware_type_id
        );
        return (
          <StepDownloadImage
            onConfirm={setStepConfirmed}
            confirmed={stepConfirmed}
            hardwareType={selectedHardware?.hardware_type || ""}
          />
        );
      case 4:
        return (
          <StepNetworkSetup
            onConfirm={setStepConfirmed}
            confirmed={stepConfirmed}
          />
        );
      case 5:
        return (
          <StepCloudConnection
            controllerId={controllerId}
            serialNumber={controllerData.serial_number}
            onConfirm={setStepConfirmed}
            confirmed={stepConfirmed}
          />
        );
      case 6:
        return (
          <StepVerifyOnline
            controllerId={controllerId}
            onVerified={() => setStepConfirmed(true)}
            verified={stepConfirmed}
          />
        );
      case 7:
        return (
          <StepRunTests
            controllerId={controllerId}
            onComplete={handleWizardComplete}
          />
        );
      default:
        return null;
    }
  };

  // Check if can proceed to next step
  const canProceed = () => {
    if (currentStep === 1) {
      return controllerData.serial_number && controllerData.hardware_type_id;
    }
    if (currentStep === 7) {
      return false; // Step 7 has its own completion flow
    }
    return stepConfirmed;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Controller Setup Wizard</h1>
          <p className="text-muted-foreground">
            Follow these steps to set up a new controller
          </p>
        </div>
        <Button variant="outline" onClick={handleSaveAndExit}>
          Save & Exit
        </Button>
      </div>

      {/* Progress Indicator */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            {STEPS.map((step, index) => (
              <div key={step.number} className="flex items-center">
                {/* Step indicator */}
                <div className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors ${
                      completedSteps.includes(step.number)
                        ? "bg-green-500 border-green-500 text-white"
                        : currentStep === step.number
                        ? "bg-primary border-primary text-primary-foreground"
                        : "bg-muted border-muted-foreground/30 text-muted-foreground"
                    }`}
                  >
                    {completedSteps.includes(step.number) ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="w-5 h-5"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      step.number
                    )}
                  </div>
                  <span className="text-xs mt-1 text-center max-w-[80px] hidden md:block">
                    {step.name}
                  </span>
                </div>

                {/* Connector line */}
                {index < STEPS.length - 1 && (
                  <div
                    className={`h-0.5 w-8 md:w-12 lg:w-16 mx-1 ${
                      completedSteps.includes(step.number)
                        ? "bg-green-500"
                        : "bg-muted-foreground/30"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Current Step Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm">
              {currentStep}
            </span>
            {STEPS[currentStep - 1].name}
          </CardTitle>
          <p className="text-muted-foreground">
            {STEPS[currentStep - 1].description}
          </p>
        </CardHeader>
        <CardContent>{renderStepContent()}</CardContent>
      </Card>

      {/* Navigation Buttons */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={handlePrevStep}
          disabled={currentStep === 1}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4 mr-2"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </Button>

        {currentStep < 7 && (
          <Button onClick={handleNextStep} disabled={!canProceed() || loading}>
            {loading ? "Saving..." : "Continue"}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4 ml-2"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Button>
        )}
      </div>
    </div>
  );
}
