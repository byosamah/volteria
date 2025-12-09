/**
 * Site Creation Wizard Types
 *
 * TypeScript interfaces for the multi-step site creation wizard.
 * Used across all step components and the main wizard container.
 */

// ============================================
// FORM DATA TYPES
// ============================================

/**
 * Control method options
 * - onsite_controller: Raspberry Pi runs control logic locally (works offline)
 * - gateway_api: Server sends commands through Netbiter gateway (requires internet)
 */
export type ControlMethod = "onsite_controller" | "gateway_api";

/**
 * Control method backup options
 * - none: No backup method
 * - gateway_backup: Switch to gateway if on-site controller fails
 * - controller_backup: Switch to controller if gateway fails (future)
 */
export type ControlMethodBackup = "none" | "gateway_backup" | "controller_backup";

/**
 * Grid connection types
 * - off_grid: Diesel generators + solar (currently only supported)
 * - on_grid: Grid-connected system (coming soon)
 */
export type GridConnection = "on_grid" | "off_grid";

/**
 * Operation mode options (for off-grid)
 * - zero_dg_reverse: Prevent reverse feeding to DG (currently only option)
 * - peak_shaving: Reduce peak demand (coming soon)
 * - manual: Manual control (coming soon)
 */
export type OperationMode = "zero_dg_reverse" | "peak_shaving" | "manual";

/**
 * Safe mode type options
 * - time_based: Activates after X seconds of communication loss
 * - rolling_average: Only if solar exceeds threshold % of load
 */
export type SafeModeType = "time_based" | "rolling_average";

/**
 * All form data collected across wizard steps
 */
export interface WizardFormData {
  // Step 1: Basic Information
  name: string;
  location: string;
  description: string;

  // Step 2: Control Method
  controlMethod: ControlMethod;
  controlMethodBackup: ControlMethodBackup;

  // Step 3: Grid & Operation Mode
  gridConnection: GridConnection;
  operationMode: OperationMode;

  // Step 4: Control Settings
  dgReserveKw: number;
  controlIntervalMs: number;

  // Step 5: Logging Settings
  loggingLocalIntervalMs: number;
  loggingLocalRetentionDays: number;
  loggingCloudEnabled: boolean;
  loggingGatewayEnabled: boolean;

  // Step 6: Safe Mode Settings
  safeModeEnabled: boolean;
  safeModeType: SafeModeType;
  safeModeTimeoutS: number;
  safeModeRollingWindowMin: number;
  safeModeThresholdPct: number;
  safeModePowerLimitKw: number;
}

// ============================================
// WIZARD STATE
// ============================================

/**
 * Complete wizard state including navigation and submission
 */
export interface WizardState {
  // Current step (1-7)
  currentStep: number;

  // Form data
  formData: WizardFormData;

  // Per-step validation errors (null if valid)
  stepErrors: Record<number, string | null>;

  // Submission state
  isSubmitting: boolean;
  submitError: string | null;
}

// ============================================
// REDUCER ACTIONS
// ============================================

export type WizardAction =
  | { type: "SET_STEP"; step: number }
  | { type: "NEXT_STEP" }
  | { type: "PREV_STEP" }
  | { type: "UPDATE_FIELD"; field: keyof WizardFormData; value: WizardFormData[keyof WizardFormData] }
  | { type: "UPDATE_MULTIPLE_FIELDS"; fields: Partial<WizardFormData> }
  | { type: "SET_STEP_ERROR"; step: number; error: string | null }
  | { type: "SET_SUBMITTING"; isSubmitting: boolean }
  | { type: "SET_SUBMIT_ERROR"; error: string | null }
  | { type: "RESET" };

// ============================================
// DEFAULT VALUES
// ============================================

export const defaultFormData: WizardFormData = {
  // Step 1: Basic Info
  name: "",
  location: "",
  description: "",

  // Step 2: Control Method
  controlMethod: "onsite_controller",
  controlMethodBackup: "none",

  // Step 3: Grid & Operation
  gridConnection: "off_grid",
  operationMode: "zero_dg_reverse",

  // Step 4: Control Settings
  dgReserveKw: 50,
  controlIntervalMs: 1000,

  // Step 5: Logging Settings
  loggingLocalIntervalMs: 1000,
  loggingLocalRetentionDays: 7,
  loggingCloudEnabled: true,
  loggingGatewayEnabled: false,

  // Step 6: Safe Mode
  safeModeEnabled: true,
  safeModeType: "rolling_average",
  safeModeTimeoutS: 30,
  safeModeRollingWindowMin: 3,
  safeModeThresholdPct: 80,
  safeModePowerLimitKw: 0,
};

export const initialWizardState: WizardState = {
  currentStep: 1,
  formData: defaultFormData,
  stepErrors: {},
  isSubmitting: false,
  submitError: null,
};

// ============================================
// STEP DEFINITIONS
// ============================================

export interface StepDefinition {
  number: number;
  title: string;
  shortTitle: string;
  description: string;
}

export const WIZARD_STEPS: StepDefinition[] = [
  {
    number: 1,
    title: "Basic Information",
    shortTitle: "Basic",
    description: "Site name, location, and description",
  },
  {
    number: 2,
    title: "Control Method",
    shortTitle: "Control",
    description: "How the site will be controlled",
  },
  {
    number: 3,
    title: "Grid & Operation",
    shortTitle: "Grid",
    description: "Grid connection and operation mode",
  },
  {
    number: 4,
    title: "Control Settings",
    shortTitle: "Settings",
    description: "DG reserve and control intervals",
  },
  {
    number: 5,
    title: "Logging Settings",
    shortTitle: "Logging",
    description: "Data logging configuration",
  },
  {
    number: 6,
    title: "Safe Mode",
    shortTitle: "Safe Mode",
    description: "Communication failure protection",
  },
  {
    number: 7,
    title: "Review & Create",
    shortTitle: "Review",
    description: "Review settings and create site",
  },
];

export const TOTAL_STEPS = WIZARD_STEPS.length;

// ============================================
// STEP COMPONENT PROPS
// ============================================

/**
 * Props passed to each step component
 */
export interface StepProps {
  formData: WizardFormData;
  updateField: <K extends keyof WizardFormData>(field: K, value: WizardFormData[K]) => void;
  error: string | null;
}

/**
 * Props for the review step (needs additional navigation)
 */
export interface ReviewStepProps extends StepProps {
  onEditStep: (step: number) => void;
}
