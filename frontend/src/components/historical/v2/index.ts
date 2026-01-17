/**
 * Historical Data V2 Components
 *
 * Redesigned historical data viewer with drag-and-drop parameter selection,
 * calendar date picker, and cleaner visual hierarchy.
 */

export { HistoricalDataClientV2 } from "./HistoricalDataClientV2";
export { HistoricalChart } from "./HistoricalChart";
export { ControlsRow } from "./ControlsRow";
export { DateRangeSelector } from "./DateRangeSelector";
export { ParameterSelector } from "./ParameterSelector";
export { ParameterCard, AvailableParameterCard } from "./ParameterCard";
export { AxisDropZone } from "./AxisDropZone";
export { AvailableParametersList } from "./AvailableParametersList";
export { AdvancedOptions } from "./AdvancedOptions";

// Types
export type {
  HistoricalDataClientV2Props,
  Project,
  Site,
  Device,
  RegisterDefinition,
  DateRange,
  AxisParameter,
  AvailableRegister,
  ReferenceLine,
  CalculatedField,
  ChartDataPoint,
  DataSource,
  ChartType,
} from "./types";

// Constants
export {
  MAX_PARAMETERS,
  MAX_DATE_RANGE_DAYS,
  COLOR_PALETTE,
  CHART_TYPE_OPTIONS,
  DATE_PRESETS,
  getNextColor,
} from "./constants";
