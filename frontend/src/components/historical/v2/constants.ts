/**
 * Constants for Historical Data V2 Component
 */

// Maximum parameters allowed on chart
export const MAX_PARAMETERS = 10;

// Maximum date range in days
export const MAX_DATE_RANGE_DAYS = 7;

// Predefined color palette for parameters (softer, more vibrant variants)
export const COLOR_PALETTE = [
  "#60a5fa", // Softer blue
  "#4ade80", // Softer green
  "#fb923c", // Softer orange
  "#a78bfa", // Softer purple
  "#f87171", // Softer red
  "#22d3ee", // Softer cyan
  "#fbbf24", // Softer amber
  "#f472b6", // Softer pink
  "#2dd4bf", // Softer teal
  "#818cf8", // Softer indigo
];

// Aggregation groups for modern UI
export const AGGREGATION_GROUPS = {
  raw: { label: "Raw", shortLabel: "Raw" },
  hourly: { label: "Hourly", shortLabel: "1H" },
  daily: { label: "Daily", shortLabel: "1D" },
} as const;

// Aggregation methods within each group
export const AGGREGATION_METHODS = {
  avg: { label: "Average", icon: "avg" },
  min: { label: "Minimum", icon: "min" },
  max: { label: "Maximum", icon: "max" },
} as const;

// Full aggregation options
export const AGGREGATION_OPTIONS = [
  { value: "raw", group: "raw", method: null, label: "Raw Data", shortLabel: "Raw" },
  { value: "hourly_avg", group: "hourly", method: "avg", label: "Hourly Avg", shortLabel: "Avg" },
  { value: "hourly_min", group: "hourly", method: "min", label: "Hourly Min", shortLabel: "Min" },
  { value: "hourly_max", group: "hourly", method: "max", label: "Hourly Max", shortLabel: "Max" },
  { value: "daily_avg", group: "daily", method: "avg", label: "Daily Avg", shortLabel: "Avg" },
  { value: "daily_min", group: "daily", method: "min", label: "Daily Min", shortLabel: "Min" },
  { value: "daily_max", group: "daily", method: "max", label: "Daily Max", shortLabel: "Max" },
] as const;

// Auto-select thresholds (in hours)
export const AGGREGATION_THRESHOLDS = {
  raw: 6,           // < 6 hours → raw data
  hourly: 72,       // 6h - 3 days → hourly
  daily: Infinity,  // > 3 days → daily
};

// Chart type options
export const CHART_TYPE_OPTIONS = [
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "bar", label: "Bar" },
] as const;

// Date range preset options
export const DATE_PRESETS = [
  { value: "24h", label: "24h", days: 1 },
  { value: "3d", label: "3d", days: 3 },
  { value: "7d", label: "7d", days: 7 },
] as const;

// Dummy projects for testing (including inactive for filter testing)
export const DUMMY_PROJECTS = [
  { id: "proj1", name: "Solar Farm Alpha", timezone: "America/New_York", is_active: true },
  { id: "proj2", name: "Industrial Complex", timezone: "UTC", is_active: true },
  { id: "proj3", name: "Residential Grid", timezone: "Asia/Dubai", is_active: true },
  { id: "proj4", name: "Old Decommissioned Site", timezone: "UTC", is_active: false },
];

// Dummy sites for testing (including inactive)
export const DUMMY_SITES = [
  { id: "site1", name: "Main Building", project_id: "proj1", is_active: true },
  { id: "site2", name: "Warehouse A", project_id: "proj1", is_active: true },
  { id: "site3", name: "Factory Floor", project_id: "proj2", is_active: true },
  { id: "site4", name: "Office Block", project_id: "proj2", is_active: false },
  { id: "site5", name: "House 1", project_id: "proj3", is_active: true },
];

// Dummy devices for testing (controller is handled separately as hardcoded option)
export const DUMMY_DEVICES = [
  { id: "dev1", name: "Main Meter", site_id: "site1", device_type: "meter", enabled: true },
  { id: "dev2", name: "Inverter 1", site_id: "site1", device_type: "inverter", enabled: true },
  { id: "dev3", name: "Generator 1", site_id: "site1", device_type: "dg", enabled: false },
  { id: "dev4", name: "Load Meter", site_id: "site2", device_type: "meter", enabled: true },
  { id: "dev5", name: "Solar Array", site_id: "site2", device_type: "inverter", enabled: true },
];

// Controller ID constant (matches AvailableParametersList)
export const SITE_CONTROLLER_ID = "site-controller";

// Dummy registers per device (including controller calculated fields)
export const DUMMY_REGISTERS: Record<string, { id: string; name: string; unit: string; preferred_chart_type?: string }[]> = {
  // Site Controller calculated fields - always available
  "site-controller": [
    { id: "calc1", name: "Total Site Load", unit: "kW", preferred_chart_type: "area" },
    { id: "calc2", name: "Total Solar Generation", unit: "kW", preferred_chart_type: "area" },
    { id: "calc3", name: "Net Power (Load - Solar)", unit: "kW", preferred_chart_type: "line" },
    { id: "calc4", name: "Solar Utilization", unit: "%", preferred_chart_type: "line" },
    { id: "calc5", name: "DG Runtime Today", unit: "h" },
    { id: "calc6", name: "Peak Load Today", unit: "kW" },
  ],
  dev1: [
    { id: "r1", name: "Total Active Power", unit: "kW", preferred_chart_type: "area" },
    { id: "r2", name: "Frequency", unit: "Hz", preferred_chart_type: "line" },
    { id: "r3", name: "L1 Voltage", unit: "V" },
    { id: "r4", name: "L1 Current", unit: "A" },
    { id: "r5", name: "Power Factor", unit: "" },
    { id: "r6", name: "Energy Import", unit: "kWh" },
  ],
  dev2: [
    { id: "r7", name: "Solar Output", unit: "kW", preferred_chart_type: "area" },
    { id: "r8", name: "DC Voltage", unit: "V" },
    { id: "r9", name: "DC Current", unit: "A" },
    { id: "r10", name: "Efficiency", unit: "%", preferred_chart_type: "line" },
    { id: "r11", name: "Temperature", unit: "°C" },
  ],
  dev3: [
    { id: "r12", name: "DG Power", unit: "kW", preferred_chart_type: "area" },
    { id: "r13", name: "Fuel Level", unit: "%" },
    { id: "r14", name: "Engine RPM", unit: "RPM" },
    { id: "r15", name: "Coolant Temp", unit: "°C" },
    { id: "r16", name: "Run Hours", unit: "h" },
  ],
  dev4: [
    { id: "r17", name: "Load Power", unit: "kW", preferred_chart_type: "area" },
    { id: "r18", name: "Reactive Power", unit: "kVAR" },
  ],
  dev5: [
    { id: "r19", name: "Array Output", unit: "kW", preferred_chart_type: "area" },
    { id: "r20", name: "Panel Temp", unit: "°C" },
  ],
};

// Generate dummy chart data
export function generateDummyChartData(
  parameters: { deviceId: string; registerName: string }[],
  startDate: Date,
  endDate: Date
): { timestamp: string; formattedTime: string; [key: string]: string | number | null }[] {
  const data: { timestamp: string; formattedTime: string; [key: string]: string | number | null }[] = [];
  const intervalMs = 15 * 60 * 1000; // 15 minute intervals

  let currentTime = startDate.getTime();
  const endTime = endDate.getTime();

  while (currentTime <= endTime) {
    const date = new Date(currentTime);
    const point: { timestamp: string; formattedTime: string; [key: string]: string | number | null } = {
      timestamp: date.toISOString(),
      formattedTime: formatTime(date, startDate, endDate),
    };

    // Generate values for each parameter
    for (const param of parameters) {
      const key = `${param.deviceId}:${param.registerName}`;
      // Generate realistic-looking data with some variation
      const baseValue = getBaseValue(param.registerName);
      const variation = (Math.sin(currentTime / 3600000) + Math.random() * 0.3) * baseValue * 0.2;
      point[key] = Math.round((baseValue + variation) * 100) / 100;
    }

    data.push(point);
    currentTime += intervalMs;
  }

  return data;
}

// Get base value for different register types
function getBaseValue(registerName: string): number {
  const nameL = registerName.toLowerCase();
  if (nameL.includes("power") || nameL.includes("output")) return 50;
  if (nameL.includes("voltage")) return 230;
  if (nameL.includes("current")) return 15;
  if (nameL.includes("frequency")) return 50;
  if (nameL.includes("temperature") || nameL.includes("temp")) return 45;
  if (nameL.includes("efficiency") || nameL.includes("factor")) return 0.95;
  if (nameL.includes("level") || nameL.includes("percent")) return 75;
  if (nameL.includes("rpm")) return 1500;
  if (nameL.includes("energy")) return 1500;
  if (nameL.includes("hours")) return 2500;
  return 100;
}

// Format time based on date range
function formatTime(date: Date, startDate: Date, endDate: Date): string {
  const rangeDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);

  if (rangeDays <= 1) {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } else if (rangeDays <= 3) {
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
    });
  } else {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }
}

// Get next available color from palette
export function getNextColor(usedColors: string[]): string {
  return COLOR_PALETTE.find((c) => !usedColors.includes(c)) || COLOR_PALETTE[0];
}
