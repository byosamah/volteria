/**
 * Dashboard Icon Library
 *
 * Fixed set of industrial icons for site dashboard visualizations.
 * Categories: generation, storage, distribution, load, measurement, infrastructure
 */

import {
  Zap,
  Sun,
  Wind,
  Battery,
  Building2,
  Factory,
  Gauge,
  Activity,
  Cable,
  Power,
  Thermometer,
  Droplets,
  Fan,
  Server,
  Radio,
  PlugZap,
  type LucideIcon,
} from "lucide-react";

export interface DashboardIcon {
  id: string;
  name: string;
  icon: LucideIcon;
  category: "generation" | "storage" | "distribution" | "load" | "measurement" | "infrastructure";
  description: string;
}

export const DASHBOARD_ICONS: DashboardIcon[] = [
  // Power Generation
  {
    id: "generator",
    name: "Diesel Generator",
    icon: Zap,
    category: "generation",
    description: "Diesel or gas generator unit",
  },
  {
    id: "solar_panel",
    name: "Solar Panel",
    icon: Sun,
    category: "generation",
    description: "Photovoltaic panel array",
  },
  {
    id: "solar_inverter",
    name: "Solar Inverter",
    icon: Sun,
    category: "generation",
    description: "DC to AC solar inverter",
  },
  {
    id: "wind_turbine",
    name: "Wind Turbine",
    icon: Wind,
    category: "generation",
    description: "Wind power generator",
  },

  // Storage
  {
    id: "battery",
    name: "Battery Storage",
    icon: Battery,
    category: "storage",
    description: "Battery energy storage system",
  },

  // Distribution
  {
    id: "transformer",
    name: "Transformer",
    icon: Power,
    category: "distribution",
    description: "Electrical transformer",
  },
  {
    id: "switchgear",
    name: "Switchgear",
    icon: PlugZap,
    category: "distribution",
    description: "Electrical switchgear panel",
  },
  {
    id: "busbar",
    name: "Busbar",
    icon: Cable,
    category: "distribution",
    description: "Electrical busbar",
  },

  // Loads
  {
    id: "load_generic",
    name: "Generic Load",
    icon: Activity,
    category: "load",
    description: "General electrical load",
  },
  {
    id: "building",
    name: "Building",
    icon: Building2,
    category: "load",
    description: "Building or facility load",
  },
  {
    id: "factory",
    name: "Industrial Load",
    icon: Factory,
    category: "load",
    description: "Industrial or factory load",
  },
  {
    id: "hvac",
    name: "HVAC System",
    icon: Fan,
    category: "load",
    description: "Heating, ventilation, and air conditioning",
  },
  {
    id: "pump",
    name: "Pump",
    icon: Droplets,
    category: "load",
    description: "Water or fluid pump",
  },

  // Measurement
  {
    id: "meter",
    name: "Power Meter",
    icon: Gauge,
    category: "measurement",
    description: "Electrical power meter",
  },
  {
    id: "sensor",
    name: "Sensor",
    icon: Thermometer,
    category: "measurement",
    description: "Environmental or electrical sensor",
  },

  // Infrastructure
  {
    id: "grid",
    name: "Utility Grid",
    icon: Radio,
    category: "infrastructure",
    description: "Utility grid connection point",
  },
  {
    id: "controller",
    name: "Controller",
    icon: Server,
    category: "infrastructure",
    description: "Site controller or PLC",
  },
];

// Helper to get icon by ID
export function getIconById(iconId: string): DashboardIcon | undefined {
  return DASHBOARD_ICONS.find((icon) => icon.id === iconId);
}

// Helper to get icons by category
export function getIconsByCategory(category: DashboardIcon["category"]): DashboardIcon[] {
  return DASHBOARD_ICONS.filter((icon) => icon.category === category);
}

// All categories for grouping
export const ICON_CATEGORIES: { id: DashboardIcon["category"]; name: string }[] = [
  { id: "generation", name: "Power Generation" },
  { id: "storage", name: "Energy Storage" },
  { id: "distribution", name: "Distribution" },
  { id: "load", name: "Loads" },
  { id: "measurement", name: "Measurement" },
  { id: "infrastructure", name: "Infrastructure" },
];
