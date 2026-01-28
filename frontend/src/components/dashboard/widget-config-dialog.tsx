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
import { Upload, X, Info } from "lucide-react";
import { cn } from "@/lib/utils";

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

// Helper to get active registers from a device (logging_registers only - these are actively being logged)
function getDeviceRegisters(device: Device | undefined): Register[] {
  if (!device?.device_templates) return [];

  // Only use logging_registers - these are the active/enabled registers
  const logging = device.device_templates.logging_registers || [];

  return logging.filter(r => r.access === "read" || r.access === "readwrite");
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
                onCheckedChange={(checked) => updateConfig("conditional_enabled", checked)}
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
                  onValueChange={(v) => updateConfig("condition_register_name", v)}
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
    const seriesOptions = [
      { register_name: "total_load_kw", label: "Total Load" },
      { register_name: "solar_output_kw", label: "Solar Output" },
      { register_name: "dg_power_kw", label: "Generator Power" },
    ];

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

        {/* Chart type */}
        <div className="space-y-2">
          <Label>Chart Type</Label>
          <Select
            value={(config.chart_type as string) || "line"}
            onValueChange={(v) => updateConfig("chart_type", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="line">Line Chart</SelectItem>
              <SelectItem value="area">Area Chart</SelectItem>
              <SelectItem value="bar">Bar Chart</SelectItem>
            </SelectContent>
          </Select>
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
              <SelectItem value="1h">Last 1 Hour</SelectItem>
              <SelectItem value="6h">Last 6 Hours</SelectItem>
              <SelectItem value="24h">Last 24 Hours</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Data series */}
        <div className="space-y-2">
          <Label>Data Series (select metrics to display)</Label>
          <div className="space-y-2 border rounded-md p-3">
            {seriesOptions.map((option) => {
              const series = (config.series as Array<{ register_name: string; label: string }>) || [];
              const isSelected = series.some((s) => s.register_name === option.register_name);

              return (
                <div key={option.register_name} className="flex items-center gap-2">
                  <Switch
                    checked={isSelected}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        updateConfig("series", [...series, option]);
                      } else {
                        updateConfig(
                          "series",
                          series.filter((s) => s.register_name !== option.register_name)
                        );
                      }
                    }}
                  />
                  <Label className="font-normal">{option.label}</Label>
                </div>
              );
            })}
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

  // Widget type titles
  const titles: Record<string, string> = {
    icon: "Configure Image Widget",
    value_display: "Configure Value Display",
    chart: "Configure Chart",
    alarm_list: "Configure Alarm List",
    status_indicator: "Configure Status Indicator",
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{titles[widget.widget_type] || "Configure Widget"}</DialogTitle>
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
