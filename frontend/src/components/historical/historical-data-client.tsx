"use client";

/**
 * Historical Data Client Component
 *
 * Main interactive component for the Historical Data page.
 * Features:
 * - Project/Site cascading selection
 * - Duration and chart type selection
 * - Parameter management with real register data from device templates
 * - Recharts visualization with multi-axis support
 * - Brush component for zoom/pan
 * - Reference lines
 * - Calculated fields
 * - CSV export
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, RefreshCw, Plus, Trash2, Settings2, AlertCircle } from "lucide-react";
import {
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Brush,
  ReferenceLine as RechartReferenceLine,
} from "recharts";

// Types for the component
interface Project {
  id: string;
  name: string;
}

interface Site {
  id: string;
  name: string;
  project_id: string;
}

interface Device {
  id: string;
  name: string;
  site_id: string;
  device_type: string | null;
}

// Register definition from API
interface RegisterDefinition {
  name: string;
  address: number;
  datatype: string;
  scale: number;
  unit: string;
  access: string;
  preferred_chart_type?: string;
}

// Parameter configuration for chart
interface ChartParameter {
  id: string;
  deviceId: string;
  deviceName: string;
  registerName: string;
  unit: string;
  color: string;
  yAxis: "Y1" | "Y2" | "Y3";
  visible: boolean;
  chartType: "line" | "area" | "bar"; // Per-parameter chart type
}

// Reference line configuration
interface ReferenceLine {
  id: string;
  label: string;
  value: number;
  color: string;
  yAxis: "Y1" | "Y2" | "Y3";
}

// Calculated field configuration
interface CalculatedField {
  id: string;
  name: string;
  formula: string;
  color: string;
  yAxis: "Y1" | "Y2" | "Y3";
}

// Chart data point
interface ChartDataPoint {
  timestamp: string;
  formattedTime: string;
  [key: string]: string | number | null;
}

// API response types
interface DeviceReading {
  device_id: string;
  device_name: string;
  register_name: string;
  unit: string | null;
  data: { timestamp: string; value: number }[];
}

interface HistoricalDataResponse {
  deviceReadings: DeviceReading[];
  aggregateData: {
    timestamp: string;
    total_load_kw: number | null;
    solar_output_kw: number | null;
    dg_power_kw: number | null;
    solar_limit_pct: number | null;
    safe_mode_active: boolean;
  }[];
  metadata: {
    totalPoints: number;
    startTime: string;
    endTime: string;
    downsampled: boolean;
  };
}

// Duration options
const DURATION_OPTIONS = [
  { value: "1h", label: "1 Hour" },
  { value: "6h", label: "6 Hours" },
  { value: "24h", label: "24 Hours" },
  { value: "7d", label: "7 Days" },
  { value: "14d", label: "14 Days" },
  { value: "30d", label: "30 Days" },
];

// Chart type options
const CHART_TYPE_OPTIONS = [
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "bar", label: "Bar" },
];

// Predefined color palette for parameters
const COLOR_PALETTE = [
  "#3b82f6", // Blue
  "#22c55e", // Green
  "#f97316", // Orange
  "#8b5cf6", // Purple
  "#ef4444", // Red
  "#06b6d4", // Cyan
  "#f59e0b", // Amber
  "#ec4899", // Pink
  "#14b8a6", // Teal
  "#6366f1", // Indigo
];

interface HistoricalDataClientProps {
  projects: Project[];
  sites: Site[];
  devices: Device[];
  isSuperAdmin: boolean;
}

export function HistoricalDataClient({
  projects,
  sites,
  devices,
  isSuperAdmin,
}: HistoricalDataClientProps) {
  // Selection state
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [duration, setDuration] = useState<string>("24h");

  // Data state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parameters, setParameters] = useState<ChartParameter[]>([]);
  const [referenceLines, setReferenceLines] = useState<ReferenceLine[]>([]);
  const [calculatedFields, setCalculatedFields] = useState<CalculatedField[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [metadata, setMetadata] = useState<HistoricalDataResponse["metadata"] | null>(null);

  // Device registers cache (deviceId -> registers)
  const [deviceRegisters, setDeviceRegisters] = useState<Record<string, RegisterDefinition[]>>({});
  const [loadingRegisters, setLoadingRegisters] = useState<Record<string, boolean>>({});

  // Super admin: local data source toggle
  const [dataSource, setDataSource] = useState<"cloud" | "local">("cloud");

  // Filter sites based on selected project
  const filteredSites = useMemo(() => {
    if (!selectedProjectId) return [];
    return sites.filter((site) => site.project_id === selectedProjectId);
  }, [sites, selectedProjectId]);

  // Filter devices based on selected site
  const filteredDevices = useMemo(() => {
    if (!selectedSiteId) return [];
    return devices.filter((device) => device.site_id === selectedSiteId);
  }, [devices, selectedSiteId]);

  // Handle project change - reset site and devices
  const handleProjectChange = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedSiteId("");
    setParameters([]);
    setChartData([]);
    setMetadata(null);
    setError(null);
  }, []);

  // Handle site change - reset parameters
  const handleSiteChange = useCallback((siteId: string) => {
    setSelectedSiteId(siteId);
    setParameters([]);
    setChartData([]);
    setMetadata(null);
    setError(null);
  }, []);

  // Fetch registers for a device
  const fetchDeviceRegisters = useCallback(async (deviceId: string) => {
    if (deviceRegisters[deviceId] || loadingRegisters[deviceId]) {
      return; // Already loaded or loading
    }

    setLoadingRegisters((prev) => ({ ...prev, [deviceId]: true }));

    try {
      const response = await fetch(`/api/devices/${deviceId}/registers`);
      if (response.ok) {
        const data = await response.json();
        setDeviceRegisters((prev) => ({
          ...prev,
          [deviceId]: data.registers || [],
        }));
      }
    } catch (err) {
      console.error("Failed to fetch device registers:", err);
    } finally {
      setLoadingRegisters((prev) => ({ ...prev, [deviceId]: false }));
    }
  }, [deviceRegisters, loadingRegisters]);

  // Add a new parameter
  const addParameter = useCallback(() => {
    if (parameters.length >= 10) {
      return;
    }

    const usedColors = parameters.map((p) => p.color);
    const nextColor =
      COLOR_PALETTE.find((c) => !usedColors.includes(c)) || COLOR_PALETTE[0];

    const newParam: ChartParameter = {
      id: `param-${Date.now()}`,
      deviceId: "",
      deviceName: "",
      registerName: "",
      unit: "",
      color: nextColor,
      yAxis: "Y1",
      visible: true,
      chartType: "line", // Default chart type
    };

    setParameters((prev) => [...prev, newParam]);
  }, [parameters]);

  // Remove a parameter
  const removeParameter = useCallback((paramId: string) => {
    setParameters((prev) => prev.filter((p) => p.id !== paramId));
  }, []);

  // Update a parameter
  const updateParameter = useCallback(
    (paramId: string, updates: Partial<ChartParameter>) => {
      setParameters((prev) =>
        prev.map((p) => (p.id === paramId ? { ...p, ...updates } : p))
      );
    },
    []
  );

  // Format timestamp for display
  const formatTimestamp = useCallback((timestamp: string, durationValue: string) => {
    const date = new Date(timestamp);

    if (durationValue === "1h" || durationValue === "6h") {
      return date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (durationValue === "24h") {
      return date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else {
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
      });
    }
  }, []);

  // Fetch historical data
  const fetchData = useCallback(async () => {
    if (!selectedSiteId) return;

    // Check if we have valid parameters with both device and register selected
    const validParams = parameters.filter(
      (p) => p.deviceId && p.registerName
    );

    if (validParams.length === 0) {
      setError("Please select at least one device and register");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Build query parameters
      const deviceIds = [...new Set(validParams.map((p) => p.deviceId))].join(",");
      const registers = [...new Set(validParams.map((p) => p.registerName))].join(",");

      const queryParams = new URLSearchParams({
        siteId: selectedSiteId,
        deviceIds,
        registers,
        duration,
        source: "device",
        limit: "5000",
      });

      const response = await fetch(`/api/historical?${queryParams}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch data");
      }

      const data: HistoricalDataResponse = await response.json();

      // Transform data for chart
      // Create a map of timestamp -> values
      const timeMap = new Map<string, ChartDataPoint>();

      for (const reading of data.deviceReadings) {
        const key = `${reading.device_id}:${reading.register_name}`;

        for (const point of reading.data) {
          const existing = timeMap.get(point.timestamp) || {
            timestamp: point.timestamp,
            formattedTime: formatTimestamp(point.timestamp, duration),
          };

          existing[key] = point.value;
          timeMap.set(point.timestamp, existing);
        }
      }

      // Sort by timestamp
      const sortedData = Array.from(timeMap.values()).sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      setChartData(sortedData);
      setMetadata(data.metadata);
    } catch (err) {
      console.error("Failed to fetch historical data:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setIsLoading(false);
    }
  }, [selectedSiteId, parameters, duration, formatTimestamp]);

  // Auto-fetch when parameters change
  useEffect(() => {
    const validParams = parameters.filter((p) => p.deviceId && p.registerName);
    if (validParams.length > 0 && selectedSiteId) {
      fetchData();
    }
  }, [parameters, duration, selectedSiteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Export to CSV
  const exportCSV = useCallback(() => {
    if (chartData.length === 0) return;

    // Build CSV headers
    const headers = ["timestamp"];
    const validParams = parameters.filter((p) => p.deviceId && p.registerName);

    for (const param of validParams) {
      headers.push(`${param.deviceName} - ${param.registerName} (${param.unit})`);
    }

    // Build CSV rows
    const rows = chartData.map((point) => {
      const row = [point.timestamp];
      for (const param of validParams) {
        const key = `${param.deviceId}:${param.registerName}`;
        row.push(String(point[key] ?? ""));
      }
      return row.join(",");
    });

    // Create CSV content
    const csvContent = [headers.join(","), ...rows].join("\n");

    // Download file
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `historical-data-${selectedSiteId}-${duration}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [chartData, parameters, selectedSiteId, duration]);

  // Get unique Y-axes used
  const usedYAxes = useMemo(() => {
    const axes = new Set(parameters.map((p) => p.yAxis));
    referenceLines.forEach((line) => axes.add(line.yAxis));
    calculatedFields.forEach((field) => axes.add(field.yAxis));
    return Array.from(axes).sort();
  }, [parameters, referenceLines, calculatedFields]);

  // Render chart with per-parameter chart types using ComposedChart
  const renderChart = useCallback(() => {
    if (chartData.length === 0) {
      return (
        <div className="h-[400px] flex items-center justify-center border rounded-lg bg-muted/20">
          {!selectedSiteId ? (
            <p className="text-muted-foreground">
              Select a project and site to view chart
            </p>
          ) : parameters.length === 0 ? (
            <p className="text-muted-foreground">
              Add parameters to visualize data
            </p>
          ) : (
            <p className="text-muted-foreground">
              No data available for the selected parameters
            </p>
          )}
        </div>
      );
    }

    const validParams = parameters.filter(
      (p) => p.deviceId && p.registerName && p.visible
    );

    // Create Y-axes
    const yAxes = usedYAxes.map((axis, index) => {
      const axisParams = validParams.filter((p) => p.yAxis === axis);
      const firstParam = axisParams[0];
      return (
        <YAxis
          key={axis}
          yAxisId={axis}
          orientation={index === 0 ? "left" : "right"}
          stroke={firstParam?.color || "#888"}
          tick={{ fontSize: 12 }}
          tickFormatter={(value: number) => value.toFixed(1)}
          label={{
            value: firstParam?.unit || axis,
            angle: -90,
            position: "insideLeft",
            style: { textAnchor: "middle", fill: firstParam?.color || "#888" },
          }}
          dx={index > 0 ? index * 60 : 0}
        />
      );
    });

    // Create reference lines
    const refLines = referenceLines.map((line) => (
      <RechartReferenceLine
        key={line.id}
        y={line.value}
        yAxisId={line.yAxis}
        stroke={line.color}
        strokeDasharray="5 5"
        label={{
          value: line.label,
          fill: line.color,
          fontSize: 11,
          position: "right",
        }}
      />
    ));

    // Render chart elements based on each parameter's chartType
    // ComposedChart allows mixing Line, Area, and Bar in the same chart
    const renderChartElements = () => {
      return validParams.map((param) => {
        const dataKey = `${param.deviceId}:${param.registerName}`;
        const name = `${param.deviceName} - ${param.registerName}`;

        switch (param.chartType) {
          case "area":
            return (
              <Area
                key={param.id}
                type="monotone"
                dataKey={dataKey}
                name={name}
                stroke={param.color}
                fill={param.color}
                fillOpacity={0.3}
                yAxisId={param.yAxis}
                dot={false}
                connectNulls
              />
            );
          case "bar":
            return (
              <Bar
                key={param.id}
                dataKey={dataKey}
                name={name}
                fill={param.color}
                yAxisId={param.yAxis}
              />
            );
          case "line":
          default:
            return (
              <Line
                key={param.id}
                type="monotone"
                dataKey={dataKey}
                name={name}
                stroke={param.color}
                yAxisId={param.yAxis}
                dot={false}
                strokeWidth={2}
                connectNulls
              />
            );
        }
      });
    };

    return (
      <ResponsiveContainer width="99%" height={400}>
        <ComposedChart
          data={chartData}
          margin={{ top: 20, right: 80, left: 20, bottom: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="formattedTime"
            tick={{ fontSize: 11 }}
            stroke="#6b7280"
          />
          {yAxes}
          <Tooltip
            contentStyle={{
              backgroundColor: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "6px",
            }}
            labelStyle={{ color: "#9ca3af" }}
          />
          <Legend />
          {renderChartElements()}
          {refLines}
          <Brush
            dataKey="formattedTime"
            height={30}
            stroke="#3b82f6"
            fill="#1f2937"
          />
        </ComposedChart>
      </ResponsiveContainer>
    );
  }, [chartData, parameters, referenceLines, selectedSiteId, usedYAxes]);

  return (
    <div className="space-y-6">
      {/* Selection Controls */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Data Selection</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Project Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                Project
              </label>
              <Select
                value={selectedProjectId}
                onValueChange={handleProjectChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Site Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                Site
              </label>
              <Select
                value={selectedSiteId}
                onValueChange={handleSiteChange}
                disabled={!selectedProjectId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select site" />
                </SelectTrigger>
                <SelectContent>
                  {filteredSites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Duration Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                Duration
              </label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Super Admin: Data Source Toggle */}
          {isSuperAdmin && (
            <div className="mt-4 p-4 bg-muted/50 rounded-lg border border-dashed">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium flex items-center gap-2">
                    <span className="text-amber-500">🔐</span>
                    Local Controller Data (Super Admin)
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Query data directly from the controller&apos;s local database
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant={dataSource === "cloud" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDataSource("cloud")}
                  >
                    Cloud
                  </Button>
                  <Button
                    variant={dataSource === "local" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDataSource("local")}
                  >
                    Local
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Parameters Section */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Parameters</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{parameters.length}/10</Badge>
              <Button
                size="sm"
                onClick={addParameter}
                disabled={!selectedSiteId || parameters.length >= 10}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {parameters.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {!selectedSiteId ? (
                <p>Select a project and site to add parameters</p>
              ) : (
                <p>Click &quot;Add&quot; to add parameters for visualization</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-2">
                <div className="col-span-2">Device</div>
                <div className="col-span-2">Register</div>
                <div className="col-span-2">Type</div>
                <div className="col-span-2">Color</div>
                <div className="col-span-2">Y-Axis</div>
                <div className="col-span-2">Actions</div>
              </div>

              {/* Parameter Rows */}
              {parameters.map((param) => (
                <ParameterRow
                  key={param.id}
                  parameter={param}
                  devices={filteredDevices}
                  registers={deviceRegisters[param.deviceId] || []}
                  loadingRegisters={loadingRegisters[param.deviceId] || false}
                  onDeviceChange={(deviceId) => {
                    const device = filteredDevices.find((d) => d.id === deviceId);
                    updateParameter(param.id, {
                      deviceId,
                      deviceName: device?.name || "",
                      registerName: "",
                      unit: "",
                    });
                    if (deviceId) {
                      fetchDeviceRegisters(deviceId);
                    }
                  }}
                  onUpdate={(updates) => updateParameter(param.id, updates)}
                  onRemove={() => removeParameter(param.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Chart Area */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <CardTitle className="text-lg">Chart</CardTitle>
              {metadata && (
                <Badge variant="outline" className="text-xs">
                  {metadata.totalPoints.toLocaleString()} points
                  {metadata.downsampled && " (downsampled)"}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchData}
                disabled={isLoading || !selectedSiteId || parameters.length === 0}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportCSV}
                disabled={chartData.length === 0}
              >
                <Download className="h-4 w-4 mr-1" />
                CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[400px] flex items-center justify-center border rounded-lg bg-muted/20">
              <div className="flex items-center gap-2 text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin" />
                <span>Loading data...</span>
              </div>
            </div>
          ) : (
            renderChart()
          )}
        </CardContent>
      </Card>

      {/* Reference Lines Section */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Reference Lines</CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setReferenceLines((prev) => [
                  ...prev,
                  {
                    id: `ref-${Date.now()}`,
                    label: `Reference ${prev.length + 1}`,
                    value: 0,
                    color: "#ef4444",
                    yAxis: "Y1",
                  },
                ]);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {referenceLines.length === 0 ? (
            <p className="text-center py-4 text-muted-foreground text-sm">
              No reference lines added. Click &quot;Add&quot; to create one.
            </p>
          ) : (
            <div className="space-y-2">
              {referenceLines.map((line) => (
                <ReferenceLineRow
                  key={line.id}
                  line={line}
                  onUpdate={(updates) =>
                    setReferenceLines((prev) =>
                      prev.map((l) =>
                        l.id === line.id ? { ...l, ...updates } : l
                      )
                    )
                  }
                  onRemove={() =>
                    setReferenceLines((prev) =>
                      prev.filter((l) => l.id !== line.id)
                    )
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Calculated Fields Section */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Calculated Fields</CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setCalculatedFields((prev) => [
                  ...prev,
                  {
                    id: `calc-${Date.now()}`,
                    name: `Calculated ${prev.length + 1}`,
                    formula: "",
                    color: "#8b5cf6",
                    yAxis: "Y1",
                  },
                ]);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {calculatedFields.length === 0 ? (
            <p className="text-center py-4 text-muted-foreground text-sm">
              No calculated fields. Add one to combine data from multiple
              devices.
            </p>
          ) : (
            <div className="space-y-2">
              {calculatedFields.map((field) => (
                <CalculatedFieldRow
                  key={field.id}
                  field={field}
                  parameters={parameters}
                  onUpdate={(updates) =>
                    setCalculatedFields((prev) =>
                      prev.map((f) =>
                        f.id === field.id ? { ...f, ...updates } : f
                      )
                    )
                  }
                  onRemove={() =>
                    setCalculatedFields((prev) =>
                      prev.filter((f) => f.id !== field.id)
                    )
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Parameter Row Component
interface ParameterRowProps {
  parameter: ChartParameter;
  devices: Device[];
  registers: RegisterDefinition[];
  loadingRegisters: boolean;
  onDeviceChange: (deviceId: string) => void;
  onUpdate: (updates: Partial<ChartParameter>) => void;
  onRemove: () => void;
}

function ParameterRow({
  parameter,
  devices,
  registers,
  loadingRegisters,
  onDeviceChange,
  onUpdate,
  onRemove,
}: ParameterRowProps) {
  return (
    <div className="grid grid-cols-12 gap-2 items-center p-2 bg-muted/30 rounded-lg">
      {/* Device Selector */}
      <div className="col-span-2">
        <Select value={parameter.deviceId} onValueChange={onDeviceChange}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Device" />
          </SelectTrigger>
          <SelectContent>
            {devices.map((device) => (
              <SelectItem key={device.id} value={device.id}>
                {device.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Register Selector */}
      <div className="col-span-2">
        <Select
          value={parameter.registerName}
          onValueChange={(value) => {
            const reg = registers.find((r) => r.name === value);
            // Set chart type based on preferred_chart_type from register if available
            const chartType = reg?.preferred_chart_type as "line" | "area" | "bar" | undefined;
            onUpdate({
              registerName: value,
              unit: reg?.unit || "",
              ...(chartType && { chartType }),
            });
          }}
          disabled={!parameter.deviceId || loadingRegisters}
        >
          <SelectTrigger className="h-9">
            <SelectValue
              placeholder={loadingRegisters ? "Loading..." : "Register"}
            />
          </SelectTrigger>
          <SelectContent>
            {registers.map((reg) => (
              <SelectItem key={reg.name} value={reg.name}>
                {reg.name} {reg.unit && `(${reg.unit})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Chart Type Selector - Per parameter! */}
      <div className="col-span-2">
        <Select
          value={parameter.chartType}
          onValueChange={(value: "line" | "area" | "bar") =>
            onUpdate({ chartType: value })
          }
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHART_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Color Picker */}
      <div className="col-span-2">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={parameter.color}
            onChange={(e) => onUpdate({ color: e.target.value })}
            className="h-9 w-9 rounded cursor-pointer border"
          />
          <span className="text-xs text-muted-foreground truncate">
            {parameter.unit || "-"}
          </span>
        </div>
      </div>

      {/* Y-Axis Selector */}
      <div className="col-span-2">
        <Select
          value={parameter.yAxis}
          onValueChange={(value: "Y1" | "Y2" | "Y3") =>
            onUpdate({ yAxis: value })
          }
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Y1">Y1</SelectItem>
            <SelectItem value="Y2">Y2</SelectItem>
            <SelectItem value="Y3">Y3</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Actions */}
      <div className="col-span-2 flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

// Reference Line Row Component
interface ReferenceLineRowProps {
  line: ReferenceLine;
  onUpdate: (updates: Partial<ReferenceLine>) => void;
  onRemove: () => void;
}

function ReferenceLineRow({ line, onUpdate, onRemove }: ReferenceLineRowProps) {
  return (
    <div className="flex items-center gap-3 p-2 bg-muted/30 rounded-lg">
      <input
        type="text"
        value={line.label}
        onChange={(e) => onUpdate({ label: e.target.value })}
        placeholder="Label"
        className="flex-1 h-9 px-3 rounded-md border bg-background text-sm"
      />
      <input
        type="number"
        value={line.value}
        onChange={(e) => onUpdate({ value: parseFloat(e.target.value) || 0 })}
        placeholder="Value"
        className="w-24 h-9 px-3 rounded-md border bg-background text-sm"
      />
      <input
        type="color"
        value={line.color}
        onChange={(e) => onUpdate({ color: e.target.value })}
        className="h-9 w-9 rounded cursor-pointer border"
      />
      <Select
        value={line.yAxis}
        onValueChange={(value: "Y1" | "Y2" | "Y3") => onUpdate({ yAxis: value })}
      >
        <SelectTrigger className="w-20 h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Y1">Y1</SelectItem>
          <SelectItem value="Y2">Y2</SelectItem>
          <SelectItem value="Y3">Y3</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onRemove}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

// Calculated Field Row Component
interface CalculatedFieldRowProps {
  field: CalculatedField;
  parameters: ChartParameter[];
  onUpdate: (updates: Partial<CalculatedField>) => void;
  onRemove: () => void;
}

function CalculatedFieldRow({
  field,
  parameters,
  onUpdate,
  onRemove,
}: CalculatedFieldRowProps) {
  return (
    <div className="p-3 bg-muted/30 rounded-lg space-y-2">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={field.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="Field name"
          className="flex-1 h-9 px-3 rounded-md border bg-background text-sm"
        />
        <input
          type="color"
          value={field.color}
          onChange={(e) => onUpdate({ color: e.target.value })}
          className="h-9 w-9 rounded cursor-pointer border"
        />
        <Select
          value={field.yAxis}
          onValueChange={(value: "Y1" | "Y2" | "Y3") =>
            onUpdate({ yAxis: value })
          }
        >
          <SelectTrigger className="w-20 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Y1">Y1</SelectItem>
            <SelectItem value="Y2">Y2</SelectItem>
            <SelectItem value="Y3">Y3</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={field.formula}
          onChange={(e) => onUpdate({ formula: e.target.value })}
          placeholder="Formula: e.g., param1 + param2 - param3"
          className="flex-1 h-9 px-3 rounded-md border bg-background text-sm font-mono"
        />
      </div>
      {parameters.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Available:{" "}
          {parameters
            .filter((p) => p.deviceName)
            .map((p) => p.deviceName)
            .join(", ")}
        </p>
      )}
    </div>
  );
}
