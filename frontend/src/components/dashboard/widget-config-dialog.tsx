"use client";

/**
 * Widget Configuration Dialog
 *
 * Modal dialog for configuring widget settings.
 * Shows different form fields based on widget type.
 */

import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DASHBOARD_ICONS } from "@/lib/dashboard-icons";
import { PRESET_IMAGES, IMAGE_UPLOAD_GUIDELINES, getPresetImageById } from "@/lib/dashboard-preset-images";
import { Upload, X, Info, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Color palette for chart parameters (from historical data V2)
const COLOR_PALETTE = [
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

// Get next available color from palette
function getNextColor(usedColors: string[]): string {
  return COLOR_PALETTE.find((c) => !usedColors.includes(c)) || COLOR_PALETTE[0];
}

// Chart parameter interface
interface ChartParameter {
  id: string;
  device_id: string;
  device_name: string;
  register_name: string;
  label?: string;
  unit?: string;
  color: string;
  y_axis: "left" | "right";
  chart_type: "line" | "area" | "bar";
}

interface Widget {
  id: string;
  widget_type: string;
  grid_row: number;
  grid_col: number;
  grid_width: number;
  grid_height: number;
  config: Record<string, unknown>;
  z_index: number;
}

interface Register {
  name: string;
  address: number;
  unit?: string;
  access: string;
  group?: string;
}

interface Device {
  id: string;
  name: string;
  device_type: string;
  is_online: boolean;
  last_seen: string | null;
  device_templates: {
    id: string;
    name: string;
    device_type: string;
    logging_registers?: Register[];
    visualization_registers?: Register[];
  } | null;
}

// All registers (logging + visualization, deduplicated) — for live-data widgets
function getDeviceRegisters(device: Device | undefined): Register[] {
  if (!device?.device_templates) return [];

  const logging = device.device_templates.logging_registers || [];
  const visualization = device.device_templates.visualization_registers || [];

  // Merge both, dedup by name (logging takes priority)
  const seen = new Set<string>();
  const result: Register[] = [];
  for (const reg of [...logging, ...visualization]) {
    if (!reg.name || seen.has(reg.name)) continue;
    if (reg.access && reg.access !== "read" && reg.access !== "readwrite") continue;
    seen.add(reg.name);
    result.push(reg);
  }
  return result;
}

// Logging registers only — for widgets that read historical data (charts)
function getLoggingRegisters(device: Device | undefined): Register[] {
  if (!device?.device_templates) return [];
  const logging = device.device_templates.logging_registers || [];
  return logging.filter(r => !r.access || r.access === "read" || r.access === "readwrite");
}

interface WidgetConfigDialogProps {
  widget: Widget;
  devices: Device[];
  onSave: (config: Record<string, unknown>) => void;
  onClose: () => void;
}

export function WidgetConfigDialog({
  widget,
  devices,
  onSave,
  onClose,
}: WidgetConfigDialogProps) {
  const [config, setConfig] = useState<Record<string, unknown>>(widget.config);

  // Chart configuration state
  const [chartAddingParam, setChartAddingParam] = useState(false);
  const [chartSelectedDeviceId, setChartSelectedDeviceId] = useState<string>("");
  const [chartSelectedRegisterName, setChartSelectedRegisterName] = useState<string>("");

  const updateConfig = (key: string, value: unknown) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  // Get registers for selected device
  const selectedDeviceId = config.device_id as string || config.linked_device_id as string;
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const readableRegisters = getDeviceRegisters(selectedDevice);

  const handleSave = () => {
    onSave(config);
  };

  // Render form based on widget type
  const renderForm = () => {
    switch (widget.widget_type) {
      case "icon":
        return renderIconForm();
      case "value_display":
        return renderValueDisplayForm();
      case "chart":
        return renderChartForm();
      case "alarm_list":
        return renderAlarmListForm();
      case "status_indicator":
        return renderStatusIndicatorForm();
      case "text":
        return renderTextForm();
      case "gauge":
        return renderGaugeForm();
      case "cable":
        return renderCableForm();
      default:
        return <p className="text-muted-foreground">Unknown widget type</p>;
    }
  };

  // Image upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const conditionalFileInputRef = useRef<HTMLInputElement>(null);

  // Get condition device registers
  const conditionDeviceId = config.condition_device_id as string;
  const conditionDevice = devices.find((d) => d.id === conditionDeviceId);
  const conditionRegisters = getDeviceRegisters(conditionDevice);

  // Handle file upload
  const handleFileUpload = async (file: File, isConditional: boolean = false) => {
    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/dashboards/upload-image", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }

      if (isConditional) {
        updateConfig("conditional_custom_image_url", data.url);
        updateConfig("conditional_image_type", "custom");
      } else {
        updateConfig("custom_image_url", data.url);
        updateConfig("image_type", "custom");
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  // Get current image URL for preview
  const getCurrentImageUrl = (isConditional: boolean = false): string | null => {
    const prefix = isConditional ? "conditional_" : "";
    const imageType = config[`${prefix}image_type`] as string;

    if (imageType === "custom") {
      return config[`${prefix}custom_image_url`] as string || null;
    } else if (imageType === "preset") {
      const presetId = config[`${prefix}preset_image_id`] as string;
      const preset = getPresetImageById(presetId);
      return preset?.url || null;
    } else if (!isConditional && config.icon_id) {
      // Legacy icon support - show nothing for preview
      return null;
    }
    return null;
  };

  const renderIconForm = () => {
    const imageType = (config.image_type as string) || (config.icon_id ? "legacy" : "preset");
    const conditionalEnabled = config.conditional_enabled as boolean || false;
    const imageWidth = (config.image_width as number) || 48;
    const imageHeight = (config.image_height as number) || 48;

    return (
      <div className="space-y-4">
        {/* Image Source Type */}
        <div className="space-y-2">
          <Label>Image Source</Label>
          <Select
            value={imageType}
            onValueChange={(v) => {
              updateConfig("image_type", v);
              // Clear other image fields when switching
              if (v === "preset") {
                updateConfig("custom_image_url", undefined);
                updateConfig("icon_id", undefined);
              } else if (v === "custom") {
                updateConfig("preset_image_id", undefined);
                updateConfig("icon_id", undefined);
              } else if (v === "legacy") {
                updateConfig("preset_image_id", undefined);
                updateConfig("custom_image_url", undefined);
              }
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="preset">Preset Images</SelectItem>
              <SelectItem value="custom">Upload Custom Image</SelectItem>
              <SelectItem value="legacy">Legacy Icons</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Preset Image Selection - Visual Grid */}
        {imageType === "preset" && (
          <div className="space-y-2">
            <Label>Select Image</Label>
            <div className="grid grid-cols-4 gap-2 p-2 border rounded-md bg-muted/30 max-h-48 overflow-y-auto">
              {PRESET_IMAGES.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => updateConfig("preset_image_id", img.id)}
                  className={cn(
                    "flex flex-col items-center p-2 rounded-md transition-all",
                    "hover:bg-accent hover:text-accent-foreground",
                    (config.preset_image_id as string) === img.id
                      ? "bg-primary/10 ring-2 ring-primary"
                      : "bg-background"
                  )}
                  title={img.description}
                >
                  <img
                    src={img.url}
                    alt={img.name}
                    className="w-12 h-12 object-contain"
                  />
                  <span className="text-[10px] mt-1 text-center truncate w-full">
                    {img.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom Image Upload */}
        {imageType === "custom" && (
          <div className="space-y-2">
            <Label>Upload Image</Label>
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/svg+xml,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file, false);
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="flex-1"
              >
                <Upload className="h-4 w-4 mr-2" />
                {isUploading ? "Uploading..." : "Choose File"}
              </Button>
              {Boolean(config.custom_image_url) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => updateConfig("custom_image_url", undefined)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            {uploadError && (
              <p className="text-sm text-destructive">{uploadError}</p>
            )}
            <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              <span>
                Max {IMAGE_UPLOAD_GUIDELINES.maxDimensions}, {IMAGE_UPLOAD_GUIDELINES.maxFileSize}.
                {" "}{IMAGE_UPLOAD_GUIDELINES.allowedFormats}.
              </span>
            </div>
          </div>
        )}

        {/* Legacy Icon Selection (backward compatibility) */}
        {imageType === "legacy" && (
          <div className="space-y-2">
            <Label>Icon</Label>
            <Select
              value={(config.icon_id as string) || ""}
              onValueChange={(v) => updateConfig("icon_id", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select icon" />
              </SelectTrigger>
              <SelectContent>
                {DASHBOARD_ICONS.map((icon) => (
                  <SelectItem key={icon.id} value={icon.id}>
                    {icon.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Image Preview (for custom uploads) */}
        {imageType === "custom" && getCurrentImageUrl() && (
          <div className="space-y-2">
            <Label>Preview</Label>
            <div className="border rounded-md p-3 flex items-center justify-center bg-muted/50">
              <img
                src={getCurrentImageUrl() || ""}
                alt="Preview"
                className="max-w-24 max-h-24 object-contain"
              />
            </div>
          </div>
        )}

        {/* Conditional Image Toggle */}
        {(imageType === "preset" || imageType === "custom") && (
          <div className="pt-2 border-t">
            <div className="flex items-center gap-2">
              <Switch
                checked={conditionalEnabled}
                onCheckedChange={(checked) => {
                  updateConfig("conditional_enabled", checked);
                  // Set default operator when enabling
                  if (checked && !config.condition_operator) {
                    updateConfig("condition_operator", ">");
                  }
                }}
              />
              <Label className="font-normal">Enable conditional image</Label>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Show a different image when a condition is met
            </p>
          </div>
        )}

        {/* Conditional Image Settings */}
        {conditionalEnabled && (imageType === "preset" || imageType === "custom") && (
          <div className="space-y-4 p-3 border rounded-md bg-muted/30">
            <p className="text-sm font-medium">Secondary Image (shown when condition is true)</p>

            {/* Conditional Image Type */}
            <div className="space-y-2">
              <Label className="text-xs">Image Source</Label>
              <Select
                value={(config.conditional_image_type as string) || "preset"}
                onValueChange={(v) => updateConfig("conditional_image_type", v)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="preset">Preset</SelectItem>
                  <SelectItem value="custom">Custom Upload</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Conditional Preset Selection - Visual Grid */}
            {(config.conditional_image_type as string) !== "custom" && (
              <div className="space-y-2">
                <Label className="text-xs">Select Image</Label>
                <div className="grid grid-cols-4 gap-1.5 p-2 border rounded-md bg-muted/30 max-h-40 overflow-y-auto">
                  {PRESET_IMAGES.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => updateConfig("conditional_preset_image_id", img.id)}
                      className={cn(
                        "flex flex-col items-center p-1.5 rounded transition-all",
                        "hover:bg-accent hover:text-accent-foreground",
                        (config.conditional_preset_image_id as string) === img.id
                          ? "bg-primary/10 ring-2 ring-primary"
                          : "bg-background"
                      )}
                      title={img.description}
                    >
                      <img
                        src={img.url}
                        alt={img.name}
                        className="w-8 h-8 object-contain"
                      />
                      <span className="text-[9px] mt-0.5 text-center truncate w-full">
                        {img.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Conditional Custom Upload */}
            {(config.conditional_image_type as string) === "custom" && (
              <div className="space-y-2">
                <Label className="text-xs">Upload Image</Label>
                <div className="flex gap-2">
                  <input
                    ref={conditionalFileInputRef}
                    type="file"
                    accept="image/png,image/svg+xml,image/jpeg"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file, true);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => conditionalFileInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex-1"
                  >
                    <Upload className="h-3 w-3 mr-1" />
                    {isUploading ? "..." : "Upload"}
                  </Button>
                </div>
              </div>
            )}

            {/* Conditional Preview */}
            {getCurrentImageUrl(true) && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Preview:</span>
                <img
                  src={getCurrentImageUrl(true) || ""}
                  alt="Conditional preview"
                  className="w-8 h-8 object-contain"
                />
              </div>
            )}

            {/* Condition Builder */}
            <div className="space-y-2 pt-2 border-t">
              <Label className="text-xs">Condition</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Show secondary image when this condition is true
              </p>

              {/* Device Selection */}
              <Select
                value={conditionDeviceId || ""}
                onValueChange={(v) => {
                  updateConfig("condition_device_id", v);
                  updateConfig("condition_register_name", undefined);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select device" />
                </SelectTrigger>
                <SelectContent>
                  {devices.map((device) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Register Selection */}
              {Boolean(conditionDeviceId) && (
                <Select
                  value={(config.condition_register_name as string) || ""}
                  onValueChange={(v) => {
                    updateConfig("condition_register_name", v);
                    // Ensure default operator is set
                    if (!config.condition_operator) {
                      updateConfig("condition_operator", ">");
                    }
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select register" />
                  </SelectTrigger>
                  <SelectContent>
                    {conditionRegisters.map((reg) => (
                      <SelectItem key={reg.name} value={reg.name}>
                        {reg.name} {reg.unit && `(${reg.unit})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Operator and Value */}
              {Boolean(config.condition_register_name) && (
                <div className="flex gap-2">
                  <Select
                    value={(config.condition_operator as string) || ">"}
                    onValueChange={(v) => updateConfig("condition_operator", v)}
                  >
                    <SelectTrigger className="h-9 w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value=">">&gt;</SelectItem>
                      <SelectItem value=">=">&gt;=</SelectItem>
                      <SelectItem value="<">&lt;</SelectItem>
                      <SelectItem value="<=">&lt;=</SelectItem>
                      <SelectItem value="==">==</SelectItem>
                      <SelectItem value="!=">!=</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    placeholder="Value"
                    value={(config.condition_value as number) ?? ""}
                    onChange={(e) => updateConfig("condition_value", parseFloat(e.target.value))}
                    className="h-9 flex-1"
                  />
                </div>
              )}

              {/* Condition Summary */}
              {Boolean(config.condition_device_id) && Boolean(config.condition_register_name) && Boolean(config.condition_operator) && config.condition_value !== undefined && (
                <p className="text-xs text-muted-foreground italic">
                  Show secondary when {String(config.condition_register_name)} {String(config.condition_operator)} {String(config.condition_value)}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Label */}
        <div className="space-y-2 pt-3 border-t">
          <Label>Label</Label>
          <Input
            value={(config.label as string) || ""}
            onChange={(e) => updateConfig("label", e.target.value)}
            placeholder="e.g., DG-1"
          />
        </div>

        {/* Status Indicator Section */}
        <div className="space-y-3 pt-3 border-t">
          <div className="flex items-center gap-2">
            <Switch
              checked={(config.show_status_dot as boolean) ?? false}
              onCheckedChange={(checked) => {
                updateConfig("show_status_dot", checked);
                if (!checked) {
                  updateConfig("linked_device_id", undefined);
                }
              }}
            />
            <Label className="font-normal">Show status indicator dot</Label>
          </div>

          {/* Device selection for status dot */}
          {(config.show_status_dot as boolean) && (
            <div className="space-y-2 pl-7">
              <Label className="text-xs text-muted-foreground">Device to monitor</Label>
              <Select
                value={(config.linked_device_id as string) || ""}
                onValueChange={(v) => updateConfig("linked_device_id", v)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select device" />
                </SelectTrigger>
                <SelectContent>
                  {devices.map((device) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.name} ({device.device_type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Value Display Section */}
        <div className="space-y-3 pt-3 border-t">
          <div className="flex items-center gap-2">
            <Switch
              checked={(config.show_value as boolean) ?? false}
              onCheckedChange={(checked) => {
                updateConfig("show_value", checked);
                if (!checked) {
                  updateConfig("linked_registers", undefined);
                  updateConfig("value_device_id", undefined);
                }
              }}
            />
            <Label className="font-normal">Show register value below image</Label>
          </div>

          {/* Device and Register for value display */}
          {(config.show_value as boolean) && (
            <div className="space-y-2 pl-7">
              <Label className="text-xs text-muted-foreground">Device</Label>
              <Select
                value={(config.value_device_id as string) || (config.linked_device_id as string) || ""}
                onValueChange={(v) => {
                  updateConfig("value_device_id", v);
                  updateConfig("linked_registers", undefined);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select device" />
                </SelectTrigger>
                <SelectContent>
                  {devices.map((device) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Register selection */}
              {(() => {
                const valueDeviceId = (config.value_device_id as string) || (config.linked_device_id as string);
                const valueDevice = devices.find((d) => d.id === valueDeviceId);
                const valueRegisters = getDeviceRegisters(valueDevice);

                if (valueDeviceId && valueRegisters.length > 0) {
                  return (
                    <>
                      <Label className="text-xs text-muted-foreground">Register</Label>
                      <Select
                        value={
                          (config.linked_registers as Array<{ register_name: string }>)?.[0]?.register_name || ""
                        }
                        onValueChange={(v) =>
                          updateConfig("linked_registers", [{ register_name: v, unit: "", decimals: 1 }])
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select register" />
                        </SelectTrigger>
                        <SelectContent>
                          {valueRegisters.map((reg) => (
                            <SelectItem key={reg.name} value={reg.name}>
                              {reg.name} {reg.unit && `(${reg.unit})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  );
                }
                return null;
              })()}
            </div>
          )}
        </div>

        {/* Color (for legacy icons) */}
        {imageType === "legacy" && (
          <div className="space-y-2 pt-3 border-t">
            <Label>Accent Color</Label>
            <Input
              type="color"
              value={(config.color as string) || "#22c55e"}
              onChange={(e) => updateConfig("color", e.target.value)}
              className="h-10 w-full cursor-pointer"
            />
          </div>
        )}
      </div>
    );
  };

  const renderValueDisplayForm = () => {
    return (
      <div className="space-y-4">
        {/* Label */}
        <div className="space-y-2">
          <Label>Label</Label>
          <Input
            value={(config.label as string) || ""}
            onChange={(e) => updateConfig("label", e.target.value)}
            placeholder="e.g., Solar Output"
          />
        </div>

        {/* Device selection */}
        <div className="space-y-2">
          <Label>Device</Label>
          <Select
            value={(config.device_id as string) || "aggregate"}
            onValueChange={(v) => updateConfig("device_id", v === "aggregate" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select device" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="aggregate">Site Aggregate</SelectItem>
              {devices.map((device) => (
                <SelectItem key={device.id} value={device.id}>
                  {device.name} ({device.device_type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Register selection */}
        <div className="space-y-2">
          <Label>Register / Metric</Label>
          {Boolean(config.device_id) ? (
            <Select
              value={(config.register_name as string) || ""}
              onValueChange={(v) => updateConfig("register_name", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select register" />
              </SelectTrigger>
              <SelectContent>
                {readableRegisters.map((reg) => (
                  <SelectItem key={reg.name} value={reg.name}>
                    {reg.name} {reg.unit && `(${reg.unit})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select
              value={(config.register_name as string) || ""}
              onValueChange={(v) => updateConfig("register_name", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select metric" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="total_load_kw">Total Load (kW)</SelectItem>
                <SelectItem value="solar_output_kw">Solar Output (kW)</SelectItem>
                <SelectItem value="dg_power_kw">Generator Power (kW)</SelectItem>
                <SelectItem value="solar_limit_pct">Solar Limit (%)</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Unit override */}
        <div className="space-y-2">
          <Label>Unit (optional override)</Label>
          <Input
            value={(config.unit as string) || ""}
            onChange={(e) => updateConfig("unit", e.target.value)}
            placeholder="e.g., kW"
          />
        </div>

        {/* Decimals */}
        <div className="space-y-2">
          <Label>Decimal Places</Label>
          <Input
            type="number"
            min={0}
            max={4}
            value={(config.decimals as number) ?? 1}
            onChange={(e) => updateConfig("decimals", parseInt(e.target.value) || 0)}
          />
        </div>
      </div>
    );
  };

  const renderChartForm = () => {
    const parameters = (config.parameters as ChartParameter[]) || [];

    // Get devices with logging registers (charts use historical data, not vis registers)
    const devicesWithRegisters = devices.filter(d => {
      const regs = getLoggingRegisters(d);
      return regs.length > 0;
    });

    // Get logging registers for selected device in chart config
    const chartSelectedDevice = devices.find(d => d.id === chartSelectedDeviceId);
    const availableRegisters = getLoggingRegisters(chartSelectedDevice);

    // Add parameter
    const addParameter = () => {
      if (!chartSelectedDeviceId || !chartSelectedRegisterName || !chartSelectedDevice) return;

      const register = availableRegisters.find(r => r.name === chartSelectedRegisterName);
      if (!register) return;

      const usedColors = parameters.map(p => p.color);
      const newParam: ChartParameter = {
        id: `param-${Date.now()}`,
        device_id: chartSelectedDeviceId,
        device_name: chartSelectedDevice.name,
        register_name: chartSelectedRegisterName,
        label: chartSelectedRegisterName,
        unit: register.unit || "",
        color: getNextColor(usedColors),
        y_axis: "left",
        chart_type: "line",
      };

      updateConfig("parameters", [...parameters, newParam]);
      setChartSelectedDeviceId("");
      setChartSelectedRegisterName("");
      setChartAddingParam(false);
    };

    // Remove parameter
    const removeParameter = (paramId: string) => {
      updateConfig("parameters", parameters.filter(p => p.id !== paramId));
    };

    // Update parameter
    const updateParameter = (paramId: string, updates: Partial<ChartParameter>) => {
      updateConfig("parameters", parameters.map(p =>
        p.id === paramId ? { ...p, ...updates } : p
      ));
    };

    return (
      <div className="space-y-4">
        {/* Title */}
        <div className="space-y-2">
          <Label>Chart Title</Label>
          <Input
            value={(config.title as string) || ""}
            onChange={(e) => updateConfig("title", e.target.value)}
            placeholder="e.g., Power Output"
          />
        </div>

        {/* Time range */}
        <div className="space-y-2">
          <Label>Time Range</Label>
            <Select
              value={(config.time_range as string) || "1h"}
              onValueChange={(v) => updateConfig("time_range", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">1 Hour</SelectItem>
                <SelectItem value="6h">6 Hours</SelectItem>
                <SelectItem value="24h">24 Hours</SelectItem>
                <SelectItem value="7d">7 Days</SelectItem>
              </SelectContent>
            </Select>
        </div>

        {/* Aggregation */}
        <div className="space-y-2">
          <Label>Aggregation</Label>
          <div className="flex gap-1">
            {["raw", "hourly", "daily"].map((agg) => (
              <Button
                key={agg}
                type="button"
                variant={(config.aggregation as string || "raw") === agg ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => updateConfig("aggregation", agg)}
              >
                {agg.charAt(0).toUpperCase() + agg.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        {/* Parameters */}
        <div className="space-y-2">
          <Label>Parameters (max 5)</Label>
          <div className="border rounded-md p-3 space-y-2">
            {/* Existing parameters */}
            {parameters.map((param) => (
              <div
                key={param.id}
                className="p-3 bg-muted/50 rounded-md space-y-2"
              >
                {/* Row 1: Color + Device/Register + Remove */}
                <div className="flex items-center gap-3">
                  {/* Color picker */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className="w-6 h-6 rounded-full border-2 border-border flex-shrink-0 hover:scale-110 transition-transform"
                        style={{ backgroundColor: param.color }}
                        title="Click to change color"
                      />
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-2" align="start">
                      <div className="grid grid-cols-5 gap-1">
                        {COLOR_PALETTE.map((color) => (
                          <button
                            key={color}
                            className={cn(
                              "w-6 h-6 rounded-full",
                              param.color === color && "ring-2 ring-offset-2 ring-primary"
                            )}
                            style={{ backgroundColor: color }}
                            onClick={() => updateParameter(param.id, { color })}
                          />
                        ))}
                      </div>
                      <div className="mt-2 pt-2 border-t">
                        <input
                          type="color"
                          value={param.color}
                          onChange={(e) => updateParameter(param.id, { color: e.target.value })}
                          className="w-full h-7 rounded cursor-pointer"
                        />
                      </div>
                    </PopoverContent>
                  </Popover>

                  {/* Device • Register */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {param.device_name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {param.register_name}{param.unit && ` (${param.unit})`}
                    </p>
                  </div>

                  {/* Remove button */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                    onClick={() => removeParameter(param.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Row 2: Chart Type + Y-Axis */}
                <div className="flex items-center gap-4 pl-9">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Type:</span>
                    <Select
                      value={param.chart_type || "line"}
                      onValueChange={(v) => updateParameter(param.id, { chart_type: v as "line" | "area" | "bar" })}
                    >
                      <SelectTrigger className="w-[90px] h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="line">Line</SelectItem>
                        <SelectItem value="area">Area</SelectItem>
                        <SelectItem value="bar">Bar</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Y-Axis:</span>
                    <Select
                      value={param.y_axis}
                      onValueChange={(v) => updateParameter(param.id, { y_axis: v as "left" | "right" })}
                    >
                      <SelectTrigger className="w-[90px] h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="left">Left</SelectItem>
                        <SelectItem value="right">Right</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            ))}

            {/* Add parameter section */}
            {parameters.length < 5 && (
              chartAddingParam ? (
                <div className="space-y-3 p-3 border border-dashed rounded-md bg-muted/30">
                  <div className="grid grid-cols-2 gap-3">
                    {/* Device selector */}
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Device</span>
                      <Select
                        value={chartSelectedDeviceId}
                        onValueChange={(v) => {
                          setChartSelectedDeviceId(v);
                          setChartSelectedRegisterName("");
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select device..." />
                        </SelectTrigger>
                        <SelectContent>
                          {devicesWithRegisters.map((device) => (
                            <SelectItem key={device.id} value={device.id}>
                              {device.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Register selector */}
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Register</span>
                      <Select
                        value={chartSelectedRegisterName}
                        onValueChange={setChartSelectedRegisterName}
                        disabled={!chartSelectedDeviceId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select register..." />
                        </SelectTrigger>
                        <SelectContent>
                          {availableRegisters.map((reg) => (
                            <SelectItem key={reg.name} value={reg.name}>
                              {reg.name} {reg.unit ? `(${reg.unit})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex gap-2 justify-end">
                    <Button
                      type="button"
                      size="sm"
                      onClick={addParameter}
                      disabled={!chartSelectedDeviceId || !chartSelectedRegisterName}
                    >
                      Add
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setChartAddingParam(false);
                        setChartSelectedDeviceId("");
                        setChartSelectedRegisterName("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setChartAddingParam(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Parameter
                </Button>
              )
            )}

            {/* Empty state */}
            {parameters.length === 0 && !chartAddingParam && (
              <p className="text-sm text-muted-foreground text-center py-2">
                No parameters selected. Click &quot;Add Parameter&quot; to start.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderAlarmListForm = () => {
    const severityOptions = ["critical", "major", "warning", "info"];

    return (
      <div className="space-y-4">
        {/* Max items */}
        <div className="space-y-2">
          <Label>Maximum Items</Label>
          <Input
            type="number"
            min={1}
            max={20}
            value={(config.max_items as number) ?? 5}
            onChange={(e) => updateConfig("max_items", parseInt(e.target.value) || 5)}
          />
        </div>

        {/* Severity filter */}
        <div className="space-y-2">
          <Label>Show Severities</Label>
          <div className="space-y-2 border rounded-md p-3">
            {severityOptions.map((severity) => {
              const severities = (config.severities as string[]) || ["critical", "major", "warning"];
              const isSelected = severities.includes(severity);

              return (
                <div key={severity} className="flex items-center gap-2">
                  <Switch
                    checked={isSelected}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        updateConfig("severities", [...severities, severity]);
                      } else {
                        updateConfig(
                          "severities",
                          severities.filter((s) => s !== severity)
                        );
                      }
                    }}
                  />
                  <Label className="font-normal capitalize">{severity}</Label>
                </div>
              );
            })}
          </div>
        </div>

        {/* Show resolved */}
        <div className="flex items-center gap-2">
          <Switch
            checked={(config.show_resolved as boolean) || false}
            onCheckedChange={(checked) => updateConfig("show_resolved", checked)}
          />
          <Label className="font-normal">Show Resolved Alarms</Label>
        </div>
      </div>
    );
  };

  const renderStatusIndicatorForm = () => {
    return (
      <div className="space-y-4">
        {/* Label */}
        <div className="space-y-2">
          <Label>Label</Label>
          <Input
            value={(config.label as string) || ""}
            onChange={(e) => updateConfig("label", e.target.value)}
            placeholder="e.g., Main Controller"
          />
        </div>

        {/* Device selection */}
        <div className="space-y-2">
          <Label>Device</Label>
          <Select
            value={(config.device_id as string) || ""}
            onValueChange={(v) => updateConfig("device_id", v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select device" />
            </SelectTrigger>
            <SelectContent>
              {devices.map((device) => (
                <SelectItem key={device.id} value={device.id}>
                  {device.name} ({device.device_type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Display options */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={(config.show_online_status as boolean) ?? true}
              onCheckedChange={(checked) => updateConfig("show_online_status", checked)}
            />
            <Label className="font-normal">Show Online/Offline Status</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={(config.show_last_seen as boolean) ?? true}
              onCheckedChange={(checked) => updateConfig("show_last_seen", checked)}
            />
            <Label className="font-normal">Show Last Seen Time</Label>
          </div>
        </div>
      </div>
    );
  };

  const renderTextForm = () => {
    return (
      <div className="space-y-4">
        {/* Text content */}
        <div className="space-y-2">
          <Label>Text</Label>
          <textarea
            value={(config.text as string) || ""}
            onChange={(e) => updateConfig("text", e.target.value)}
            placeholder="Enter your text here..."
            className="w-full min-h-[100px] p-3 border rounded-md bg-background text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Text size */}
        <div className="space-y-2">
          <Label>Text Size</Label>
          <Select
            value={(config.text_size as string) || "base"}
            onValueChange={(v) => updateConfig("text_size", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="xs">Extra Small</SelectItem>
              <SelectItem value="sm">Small</SelectItem>
              <SelectItem value="base">Normal</SelectItem>
              <SelectItem value="lg">Large</SelectItem>
              <SelectItem value="xl">Extra Large</SelectItem>
              <SelectItem value="2xl">2X Large</SelectItem>
              <SelectItem value="3xl">3X Large</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Text color */}
        <div className="space-y-2">
          <Label>Text Color</Label>
          <div className="flex gap-2 items-center">
            <Input
              type="color"
              value={(config.text_color as string) || "#000000"}
              onChange={(e) => updateConfig("text_color", e.target.value)}
              className="h-10 w-16 cursor-pointer p-1"
            />
            <Input
              type="text"
              value={(config.text_color as string) || ""}
              onChange={(e) => updateConfig("text_color", e.target.value)}
              placeholder="Default"
              className="flex-1"
            />
            {Boolean(config.text_color) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => updateConfig("text_color", undefined)}
              >
                Reset
              </Button>
            )}
          </div>
        </div>

        {/* Text alignment */}
        <div className="space-y-2">
          <Label>Alignment</Label>
          <Select
            value={(config.text_align as string) || "left"}
            onValueChange={(v) => updateConfig("text_align", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="left">Left</SelectItem>
              <SelectItem value="center">Center</SelectItem>
              <SelectItem value="right">Right</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  };

  // Gauge style options for visual selector
  const GAUGE_STYLES = [
    { id: "dial", name: "Dial", description: "Circular speedometer with needle" },
    { id: "tank_vertical", name: "V-Tank", description: "Vertical cylinder tank" },
    { id: "tank_rectangular", name: "Rect", description: "Rectangular container" },
    { id: "thermometer", name: "Thermo", description: "Thermometer style" },
    { id: "bar_horizontal", name: "H-Bar", description: "Horizontal progress bar" },
    { id: "bar_vertical", name: "V-Bar", description: "Vertical progress bar" },
  ];

  const renderGaugeForm = () => {
    const gaugeStyle = (config.gauge_style as string) || "dial";
    const zonesEnabled = (config.zones_enabled as boolean) || false;

    // Get registers for selected device
    const gaugeDeviceId = config.device_id as string;
    const gaugeDevice = devices.find((d) => d.id === gaugeDeviceId);
    const gaugeRegisters = getDeviceRegisters(gaugeDevice);

    // Mini preview component for style selector
    const GaugePreview = ({ style }: { style: string }) => {
      const previewColor = (config.fill_color as string) || "#22c55e";
      const previewPct = 60; // 60% fill for demo

      switch (style) {
        case "dial":
          // 270° arc from bottom-left to bottom-right, open at bottom
          // Center (20, 20), radius 14
          // Start at (10, 30) bottom-left, end at (30, 30) bottom-right
          // 60% fill ends at approximately (26, 8) upper-right
          return (
            <svg viewBox="0 0 40 36" className="w-10 h-9">
              {/* Background arc - 270° sweep through top */}
              <path d="M 10 30 A 14 14 0 1 1 30 30" fill="none" stroke="#e5e7eb" strokeWidth="4" strokeLinecap="round" />
              {/* Filled arc - 60% (162°) */}
              <path d="M 10 30 A 14 14 0 0 1 26 8" fill="none" stroke={previewColor} strokeWidth="4" strokeLinecap="round" />
              {/* Center dot */}
              <circle cx="20" cy="22" r="2" fill="#374151" />
            </svg>
          );
        case "tank_vertical":
          return (
            <svg viewBox="0 0 24 40" className="w-6 h-10">
              <rect x="4" y="4" width="16" height="32" rx="4" fill="#e5e7eb" />
              <rect x="4" y={4 + 32 * (1 - previewPct / 100)} width="16" height={32 * previewPct / 100} rx="2" fill={previewColor} />
            </svg>
          );
        case "tank_rectangular":
          return (
            <svg viewBox="0 0 24 32" className="w-6 h-8">
              <rect x="2" y="2" width="20" height="28" rx="2" fill="#e5e7eb" />
              <rect x="2" y={2 + 28 * (1 - previewPct / 100)} width="20" height={28 * previewPct / 100} fill={previewColor} />
            </svg>
          );
        case "thermometer":
          return (
            <svg viewBox="0 0 20 40" className="w-5 h-10">
              <rect x="7" y="4" width="6" height="26" rx="3" fill="#e5e7eb" />
              <circle cx="10" cy="34" r="5" fill="#e5e7eb" />
              <rect x="8" y={4 + 26 * (1 - previewPct / 100)} width="4" height={26 * previewPct / 100 + 4} rx="2" fill={previewColor} />
              <circle cx="10" cy="34" r="4" fill={previewColor} />
            </svg>
          );
        case "bar_horizontal":
          return (
            <svg viewBox="0 0 40 12" className="w-10 h-3">
              <rect x="2" y="2" width="36" height="8" rx="4" fill="#e5e7eb" />
              <rect x="2" y="2" width={36 * previewPct / 100} height="8" rx="4" fill={previewColor} />
            </svg>
          );
        case "bar_vertical":
          return (
            <svg viewBox="0 0 12 40" className="w-3 h-10">
              <rect x="2" y="2" width="8" height="36" rx="4" fill="#e5e7eb" />
              <rect x="2" y={2 + 36 * (1 - previewPct / 100)} width="8" height={36 * previewPct / 100} rx="4" fill={previewColor} />
            </svg>
          );
        default:
          return null;
      }
    };

    return (
      <div className="space-y-4">
        {/* Gauge Style Selector */}
        <div className="space-y-2">
          <Label>Gauge Style</Label>
          <div className="grid grid-cols-4 gap-2 p-2 border rounded-md bg-muted/30">
            {GAUGE_STYLES.map((style) => (
              <button
                key={style.id}
                type="button"
                onClick={() => updateConfig("gauge_style", style.id)}
                className={cn(
                  "flex flex-col items-center p-2 rounded-md transition-all",
                  "hover:bg-accent hover:text-accent-foreground",
                  gaugeStyle === style.id
                    ? "bg-primary/10 ring-2 ring-primary"
                    : "bg-background"
                )}
                title={style.description}
              >
                <GaugePreview style={style.id} />
                <span className="text-[10px] mt-1 text-center">{style.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Device Selection */}
        <div className="space-y-2">
          <Label>Device</Label>
          <Select
            value={gaugeDeviceId || ""}
            onValueChange={(v) => {
              updateConfig("device_id", v);
              updateConfig("register_name", undefined);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select device" />
            </SelectTrigger>
            <SelectContent>
              {devices.map((device) => (
                <SelectItem key={device.id} value={device.id}>
                  {device.name} ({device.device_type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Register Selection */}
        {Boolean(gaugeDeviceId) && (
          <div className="space-y-2">
            <Label>Register</Label>
            <Select
              value={(config.register_name as string) || ""}
              onValueChange={(v) => updateConfig("register_name", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select register" />
              </SelectTrigger>
              <SelectContent>
                {gaugeRegisters.map((reg) => (
                  <SelectItem key={reg.name} value={reg.name}>
                    {reg.name} {reg.unit && `(${reg.unit})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Range Section */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Min Value</Label>
            <Input
              type="number"
              value={(config.min_value as number) ?? 0}
              onChange={(e) => updateConfig("min_value", parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-2">
            <Label>Max Value</Label>
            <Input
              type="number"
              value={(config.max_value as number) ?? 100}
              onChange={(e) => updateConfig("max_value", parseFloat(e.target.value) || 100)}
            />
          </div>
        </div>

        {/* Display Options */}
        <div className="space-y-2 pt-3 border-t">
          <Label>Label</Label>
          <Input
            value={(config.label as string) || ""}
            onChange={(e) => updateConfig("label", e.target.value)}
            placeholder="e.g., Fuel Level"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Unit (optional)</Label>
            <Input
              value={(config.unit as string) || ""}
              onChange={(e) => updateConfig("unit", e.target.value)}
              placeholder="e.g., %"
            />
          </div>
          <div className="space-y-2">
            <Label>Decimals</Label>
            <Input
              type="number"
              min={0}
              max={4}
              value={(config.decimals as number) ?? 0}
              onChange={(e) => updateConfig("decimals", parseInt(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              checked={(config.show_value as boolean) !== false}
              onCheckedChange={(checked) => updateConfig("show_value", checked)}
            />
            <Label className="font-normal">Show Value</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={(config.show_min_max as boolean) !== false}
              onCheckedChange={(checked) => updateConfig("show_min_max", checked)}
            />
            <Label className="font-normal">Show Min/Max</Label>
          </div>
        </div>

        {/* Color Section */}
        <div className="space-y-3 pt-3 border-t">
          <div className="flex items-center gap-2">
            <Switch
              checked={zonesEnabled}
              onCheckedChange={(checked) => updateConfig("zones_enabled", checked)}
            />
            <Label className="font-normal">Enable color zones (Low/Normal/High)</Label>
          </div>

          {!zonesEnabled && (
            <div className="space-y-2">
              <Label>Fill Color</Label>
              <div className="flex gap-2 items-center">
                <Input
                  type="color"
                  value={(config.fill_color as string) || "#22c55e"}
                  onChange={(e) => updateConfig("fill_color", e.target.value)}
                  className="h-10 w-16 cursor-pointer p-1"
                />
                <Input
                  type="text"
                  value={(config.fill_color as string) || "#22c55e"}
                  onChange={(e) => updateConfig("fill_color", e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>
          )}

          {zonesEnabled && (
            <div className="space-y-4 p-3 border rounded-md bg-muted/30">
              <p className="text-sm text-muted-foreground">
                Define thresholds for color zones. Value is compared against the actual register value (not percentage).
              </p>

              {/* Zone thresholds */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Low threshold (below = Low)</Label>
                  <Input
                    type="number"
                    value={(config.zone_low_threshold as number) ?? 25}
                    onChange={(e) => updateConfig("zone_low_threshold", parseFloat(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">High threshold (above = High)</Label>
                  <Input
                    type="number"
                    value={(config.zone_high_threshold as number) ?? 75}
                    onChange={(e) => updateConfig("zone_high_threshold", parseFloat(e.target.value))}
                  />
                </div>
              </div>

              {/* Zone colors */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Low Color</Label>
                  <Input
                    type="color"
                    value={(config.zone_low_color as string) || "#22c55e"}
                    onChange={(e) => updateConfig("zone_low_color", e.target.value)}
                    className="h-8 w-full cursor-pointer p-0.5"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Normal Color</Label>
                  <Input
                    type="color"
                    value={(config.zone_normal_color as string) || "#eab308"}
                    onChange={(e) => updateConfig("zone_normal_color", e.target.value)}
                    className="h-8 w-full cursor-pointer p-0.5"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">High Color</Label>
                  <Input
                    type="color"
                    value={(config.zone_high_color as string) || "#ef4444"}
                    onChange={(e) => updateConfig("zone_high_color", e.target.value)}
                    className="h-8 w-full cursor-pointer p-0.5"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Cable form
  const renderCableForm = () => {
    const pathStyle = (config.pathStyle as string) || "straight";
    const color = (config.color as string) || "#6b7280";
    const thickness = (config.thickness as number) || 3;
    const animated = (config.animated as boolean) || false;
    const animationSpeed = (config.animationSpeed as string) || "medium";
    const animationDeviceId = (config.animationSource as { deviceId?: string; registerName?: string })?.deviceId || "";
    const animationRegisterName = (config.animationSource as { deviceId?: string; registerName?: string })?.registerName || "";

    // Get registers for animation device
    const animationDevice = devices.find((d) => d.id === animationDeviceId);
    const animationRegisters = getDeviceRegisters(animationDevice);

    return (
      <div className="space-y-4">
        {/* Path Style */}
        <div className="space-y-2">
          <Label>Cable Style</Label>
          <Select
            value={pathStyle}
            onValueChange={(v) => updateConfig("pathStyle", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="straight">Straight Line</SelectItem>
              <SelectItem value="curved">Curved</SelectItem>
              <SelectItem value="orthogonal">Right Angles</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Color */}
        <div className="space-y-2">
          <Label>Color</Label>
          <div className="flex gap-2">
            <Input
              type="color"
              value={color}
              onChange={(e) => updateConfig("color", e.target.value)}
              className="w-12 h-10 p-1 cursor-pointer"
            />
            <Input
              type="text"
              value={color}
              onChange={(e) => updateConfig("color", e.target.value)}
              placeholder="#6b7280"
              className="flex-1"
            />
          </div>
        </div>

        {/* Thickness */}
        <div className="space-y-2">
          <Label>Thickness ({thickness}px)</Label>
          <input
            type="range"
            min={1}
            max={8}
            value={thickness}
            onChange={(e) => updateConfig("thickness", parseInt(e.target.value))}
            className="w-full"
          />
        </div>

        {/* Animation Toggle */}
        <div className="flex items-center justify-between">
          <Label htmlFor="cable-animated">Animated Flow</Label>
          <Switch
            id="cable-animated"
            checked={animated}
            onCheckedChange={(v) => updateConfig("animated", v)}
          />
        </div>

        {/* Animation Options (when enabled) */}
        {animated && (
          <div className="space-y-4 pl-4 border-l-2 border-muted">
            {/* Animation Speed */}
            <div className="space-y-2">
              <Label>Animation Speed</Label>
              <Select
                value={animationSpeed}
                onValueChange={(v) => updateConfig("animationSpeed", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slow">Slow</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="fast">Fast</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Animation Direction Source (optional) */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Direction Source</Label>
                <Popover>
                  <PopoverTrigger>
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </PopoverTrigger>
                  <PopoverContent className="text-sm">
                    <p>Optionally link to a register value.</p>
                    <p className="mt-1 text-muted-foreground">
                      Positive values = forward flow, negative = reverse.
                    </p>
                  </PopoverContent>
                </Popover>
              </div>
              <Select
                value={animationDeviceId || "none"}
                onValueChange={(v) => {
                  if (v === "none") {
                    updateConfig("animationSource", undefined);
                  } else {
                    updateConfig("animationSource", { deviceId: v, registerName: "" });
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No direction source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No direction source</SelectItem>
                  {devices.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Register selection (when device selected) */}
            {animationDeviceId && (
              <div className="space-y-2">
                <Label>Register</Label>
                <Select
                  value={animationRegisterName || ""}
                  onValueChange={(v) => {
                    updateConfig("animationSource", {
                      deviceId: animationDeviceId,
                      registerName: v,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select register" />
                  </SelectTrigger>
                  <SelectContent>
                    {animationRegisters.map((r) => (
                      <SelectItem key={r.name} value={r.name}>
                        {r.name} {r.unit && `(${r.unit})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {/* Position info (read-only) */}
        <div className="text-xs text-muted-foreground mt-4 pt-4 border-t">
          <p>To reposition endpoints, drag the circles in edit mode.</p>
          <p className="mt-1">
            Start: ({(config.startX as number)?.toFixed(1) || "0"}, {(config.startY as number)?.toFixed(1) || "0"}) →
            End: ({(config.endX as number)?.toFixed(1) || "0"}, {(config.endY as number)?.toFixed(1) || "0"})
          </p>
        </div>
      </div>
    );
  };

  // Widget type titles
  const titles: Record<string, string> = {
    icon: "Configure Image Widget",
    value_display: "Configure Value Display",
    chart: "Configure Chart",
    alarm_list: "Configure Alarm List",
    status_indicator: "Configure Status Indicator",
    text: "Configure Text Widget",
    gauge: "Configure Gauge Widget",
    cable: "Configure Cable",
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={cn("sm:max-w-lg", widget.widget_type === "chart" && "sm:max-w-3xl")}>
        <DialogHeader>
          <DialogTitle>{titles[widget.widget_type] || "Configure Widget"}</DialogTitle>
          <DialogDescription>Configure the widget settings below.</DialogDescription>
        </DialogHeader>

        <div className="py-4 max-h-[60vh] overflow-y-auto overflow-x-hidden">{renderForm()}</div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
