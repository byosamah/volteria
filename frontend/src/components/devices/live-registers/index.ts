/**
 * Live Registers Components
 *
 * Export all live registers components for easy importing.
 */

export { LiveRegistersClient } from "./live-registers-client";
export { RegisterSection } from "./register-section";
export { RegisterGroup } from "./register-group";
export { RegisterRow } from "./register-row";

// Types
export type {
  RegisterValue,
  RegisterValuesMap,
  LoadingGroupsSet,
  WriteStatus,
  WriteStatusMap,
  PendingWritesMap,
  RegisterSection as RegisterSectionType,
  RegisterGroup as RegisterGroupType,
  AlarmStatus,
  LiveRegistersClientProps,
  RegisterSectionProps,
  RegisterGroupProps,
  RegisterRowProps,
} from "./types";

export {
  evaluateAlarmStatus,
  getAlarmStatusColor,
  getSeverityColor,
} from "./types";
