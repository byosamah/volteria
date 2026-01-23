/**
 * Types for Historical Data V2 Component
 */

// Project/Site/Device types (from props)
export interface Project {
  id: string;
  name: string;
  timezone: string | null;
  is_active?: boolean;
}

export interface Site {
  id: string;
  name: string;
  project_id: string;
  is_active?: boolean;
}

export interface Device {
  id: string;
  name: string;
  site_id: string;
  device_type: string | null;
  enabled?: boolean; // devices use "enabled" instead of "is_active"
}

// Simple filter: show active only (applies to all: projects, sites, devices, controllers)
export type ActiveFilter = "active" | "all";

// Register definition from API
export interface RegisterDefinition {
  name: string;
  address: number;
  datatype: string;
  scale: number;
  unit: string;
  access: string;
  preferred_chart_type?: string;
}

// Date range selection
export interface DateRange {
  start: Date;
  end: Date;
}

// Parameter on an axis (either left or right Y-axis)
export interface AxisParameter {
  id: string;
  registerId: string;
  registerName: string;
  deviceId: string;
  deviceName: string;
  siteId: string;
  siteName: string;
  unit: string;
  color: string;
  chartType: "line" | "area" | "bar";
  status?: RegisterStatus;
}

// Register status: active (in current config) or inactive (has data but not in config)
export type RegisterStatus = "active" | "inactive";

// Available register that can be added to chart
export interface AvailableRegister {
  id: string;
  name: string;
  unit: string;
  deviceId: string;
  deviceName: string;
  siteId: string;
  siteName: string;
  preferred_chart_type?: string;
  status?: RegisterStatus;
  firstSeen?: string;  // ISO timestamp (Non-Active only)
  lastSeen?: string;   // ISO timestamp (Non-Active only)
}

// Reference line configuration
export interface ReferenceLine {
  id: string;
  label: string;
  value: number;
  color: string;
  axis: "left" | "right";
}

// Calculated field configuration
export interface CalculatedField {
  id: string;
  name: string;
  formula: string;
  color: string;
  axis: "left" | "right";
}

// Chart data point
export interface ChartDataPoint {
  timestamp: string;
  formattedTime: string;
  [key: string]: string | number | null;
}

// Chart options menu state
export type ChartMenuOption = "csv" | "png";

// Data aggregation type
export type AggregationType =
  | "raw"
  | "hourly_avg" | "hourly_min" | "hourly_max"
  | "daily_avg" | "daily_min" | "daily_max";

// Aggregation group type
export type AggregationGroup = "raw" | "hourly" | "daily";

// Aggregation method type
export type AggregationMethod = "avg" | "min" | "max";

// Data source
export type DataSource = "cloud" | "local";

// Range mode: relative (presets slide to now) vs absolute (custom dates stay fixed)
export type RangeMode = "relative" | "absolute";

// Global chart type (default for new parameters)
export type ChartType = "line" | "area" | "bar";

// Props for the main component
export interface HistoricalDataClientV2Props {
  projects: Project[];
  sites: Site[];
  devices: Device[];
  isSuperAdmin: boolean;
}
