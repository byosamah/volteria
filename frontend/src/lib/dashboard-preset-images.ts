/**
 * Dashboard Preset Images Library
 *
 * Pre-defined images available for dashboard icon widgets.
 * These are stored in /public/images/dashboard/ directory.
 */

export interface PresetImage {
  id: string;
  name: string;
  url: string;
  category: "power" | "status" | "equipment" | "indicator";
  description: string;
}

export const PRESET_IMAGES: PresetImage[] = [
  // Power Generation - High quality icons
  {
    id: "solar_panel",
    name: "Solar Panel",
    url: "/images/dashboard/solar-panel.png",
    category: "power",
    description: "Solar panel array with inverter",
  },
  {
    id: "generator",
    name: "Diesel Generator",
    url: "/images/dashboard/generator.png",
    category: "power",
    description: "Industrial diesel generator",
  },

  // Simple icons (SVG)
  {
    id: "generator_running",
    name: "Generator (Running)",
    url: "/images/dashboard/generator-running.svg",
    category: "power",
    description: "Green generator icon indicating running state",
  },
  {
    id: "generator_off",
    name: "Generator (Off)",
    url: "/images/dashboard/generator-off.svg",
    category: "power",
    description: "Gray generator icon indicating off state",
  },
  {
    id: "solar_active",
    name: "Solar (Active)",
    url: "/images/dashboard/solar-active.svg",
    category: "power",
    description: "Yellow solar panel icon indicating active generation",
  },
  {
    id: "solar_inactive",
    name: "Solar (Inactive)",
    url: "/images/dashboard/solar-inactive.svg",
    category: "power",
    description: "Gray solar panel icon indicating no generation",
  },

  // Status Indicators
  {
    id: "circle_green",
    name: "Green Circle",
    url: "/images/dashboard/circle-green.svg",
    category: "indicator",
    description: "Green circle indicator for OK/running status",
  },
  {
    id: "circle_red",
    name: "Red Circle",
    url: "/images/dashboard/circle-red.svg",
    category: "indicator",
    description: "Red circle indicator for error/stopped status",
  },
  {
    id: "circle_yellow",
    name: "Yellow Circle",
    url: "/images/dashboard/circle-yellow.svg",
    category: "indicator",
    description: "Yellow circle indicator for warning status",
  },
  {
    id: "circle_gray",
    name: "Gray Circle",
    url: "/images/dashboard/circle-gray.svg",
    category: "indicator",
    description: "Gray circle indicator for offline/unknown status",
  },

  // Equipment
  {
    id: "crusher",
    name: "Crusher",
    url: "/images/dashboard/crusher.png",
    category: "equipment",
    description: "Mobile crushing and screening plant",
  },
  {
    id: "ev_charger",
    name: "EV Charger",
    url: "/images/dashboard/ev-charger.png",
    category: "equipment",
    description: "Electric vehicle charging station with solar canopy",
  },
  {
    id: "power_meter",
    name: "Power Meter",
    url: "/images/dashboard/power-meter.png",
    category: "equipment",
    description: "Digital power meter for voltage/current monitoring",
  },

  // Additional Solar
  {
    id: "solar_small",
    name: "Solar Panels (Small)",
    url: "/images/dashboard/solar-small.png",
    category: "power",
    description: "Small 2-panel solar array with inverter",
  },
  {
    id: "solar_large",
    name: "Solar Panels (Large)",
    url: "/images/dashboard/solar-large.png",
    category: "power",
    description: "Large 6-panel solar array with inverter",
  },
  {
    id: "solar_house",
    name: "Solar House",
    url: "/images/dashboard/solar-house.png",
    category: "power",
    description: "House with rooftop solar panels",
  },
];

/**
 * Get preset image by ID
 */
export function getPresetImageById(id: string): PresetImage | undefined {
  return PRESET_IMAGES.find((img) => img.id === id);
}

/**
 * Get preset images by category
 */
export function getPresetImagesByCategory(category: PresetImage["category"]): PresetImage[] {
  return PRESET_IMAGES.filter((img) => img.category === category);
}

/**
 * Image upload guidelines shown in the UI
 */
export const IMAGE_UPLOAD_GUIDELINES = {
  maxDimensions: "1024 x 1024 pixels",
  maxFileSize: "500 KB",
  allowedFormats: "PNG, SVG, JPEG",
  recommendation: "Use PNG or SVG with transparent background for best results",
  aspectRatio: "Square images work best (1:1 ratio)",
};
