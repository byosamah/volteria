"use client";

/**
 * Widget Configuration Dialog
 *
 * Modal dialog for configuring widget settings.
 * Shows different form fields based on widget type.
 */

import { useState } from "react";
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
    registers: Array<{
      name: string;
      address: number;
      unit?: string;
      access: string;
    }>;
  } | null;
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
  const deviceRegisters = selectedDevice?.device_templates?.registers || [];

  // Filter readable registers
  const readableRegisters = deviceRegisters.filter(
    (r) => r.access === "read" || r.access === "readwrite"
  );

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

  const renderIconForm = () => {
    return (
      <div className="space-y-4">
        {/* Icon selection */}
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

        {/* Label */}
        <div className="space-y-2">
          <Label>Label</Label>
          <Input
            value={(config.label as string) || ""}
            onChange={(e) => updateConfig("label", e.target.value)}
            placeholder="e.g., DG-1"
          />
        </div>

        {/* Device selection */}
        <div className="space-y-2">
          <Label>Link to Device (optional)</Label>
          <Select
            value={(config.linked_device_id as string) || "none"}
            onValueChange={(v) => updateConfig("linked_device_id", v === "none" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select device" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No device</SelectItem>
              {devices.map((device) => (
                <SelectItem key={device.id} value={device.id}>
                  {device.name} ({device.device_type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Register to display (if device selected) */}
        {Boolean(config.linked_device_id) && readableRegisters.length > 0 && (
          <div className="space-y-2">
            <Label>Display Register</Label>
            <Select
              value={
                (config.linked_registers as Array<{ register_name: string }>)?.[0]?.register_name || ""
              }
              onValueChange={(v) =>
                updateConfig("linked_registers", [{ register_name: v, unit: "", decimals: 1 }])
              }
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
          </div>
        )}

        {/* Color */}
        <div className="space-y-2">
          <Label>Accent Color</Label>
          <Input
            type="color"
            value={(config.color as string) || "#22c55e"}
            onChange={(e) => updateConfig("color", e.target.value)}
            className="h-10 w-full cursor-pointer"
          />
        </div>
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
    icon: "Configure Icon Widget",
    value_display: "Configure Value Display",
    chart: "Configure Chart",
    alarm_list: "Configure Alarm List",
    status_indicator: "Configure Status Indicator",
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titles[widget.widget_type] || "Configure Widget"}</DialogTitle>
        </DialogHeader>

        <div className="py-4 max-h-[60vh] overflow-y-auto">{renderForm()}</div>

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
