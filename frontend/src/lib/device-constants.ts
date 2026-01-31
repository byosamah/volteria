import { DeviceType } from "./types";

// Canonical device type options (single source of truth)
// Used by: template form, template list filter, template list display
export const DEVICE_TYPE_OPTIONS: { value: DeviceType; label: string }[] = [
  { value: "inverter", label: "Solar Inverter" },
  { value: "wind_turbine", label: "Wind Turbine" },
  { value: "bess", label: "Battery Energy Storage System" },
  { value: "gas_generator_controller", label: "Gas Generator Controller" },
  { value: "diesel_generator_controller", label: "Diesel Generator Controller" },
  { value: "energy_meter", label: "Energy Meter" },
  { value: "capacitor_bank", label: "Capacitor Bank" },
  { value: "fuel_level_sensor", label: "Fuel Level Sensor" },
  { value: "fuel_flow_meter", label: "Fuel Flow Meter" },
  { value: "temperature_humidity_sensor", label: "Temperature & Humidity Sensor" },
  { value: "solar_radiation_sensor", label: "Solar Radiation Sensor" },
  { value: "wind_sensor", label: "Wind Sensor" },
  // Industrial equipment
  { value: "belt_scale", label: "Belt Scale" },
  { value: "other_hardware", label: "Other Hardware" },
];

// Legacy type → modern type mapping (for display grouping)
export const LEGACY_TYPE_MAP: Record<string, DeviceType> = {
  load_meter: "energy_meter",
  dg: "diesel_generator_controller",
  sensor: "temperature_humidity_sensor",
};
