"use client";

/**
 * Historical Data Client V2
 *
 * Redesigned historical data viewer with:
 * - Drag-and-drop parameter selection
 * - Left/Right Y-axis drop zones
 * - Calendar date picker with presets
 * - Cloud/Local data source toggle (super admin)
 * - Reference lines and calculated fields
 *
 * Limits:
 * - Max 10 parameters total
 * - Max 7 day date range
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ControlsRow } from "./ControlsRow";
import { ParameterSelector } from "./ParameterSelector";
import { HistoricalChart } from "./HistoricalChart";
import { AdvancedOptions } from "./AdvancedOptions";
import {
  DUMMY_DEVICES,
  DUMMY_REGISTERS,
  DUMMY_PROJECTS,
  DUMMY_SITES,
  SITE_CONTROLLER_ID,
  generateDummyChartData,
  MAX_DATE_RANGE_DAYS,
  AGGREGATION_THRESHOLDS,
} from "./constants";
import type {
  HistoricalDataClientV2Props,
  AxisParameter,
  AvailableRegister,
  ReferenceLine,
  CalculatedField,
  ChartDataPoint,
  DateRange,
  DataSource,
  ChartType,
  Device,
  ActiveFilter,
  AggregationType,
} from "./types";

export function HistoricalDataClientV2({
  projects: propProjects,
  sites: propSites,
  devices: propDevices,
  isSuperAdmin,
}: HistoricalDataClientV2Props) {
  // Use props or fall back to dummy data for development
  const projects = propProjects.length > 0 ? propProjects : DUMMY_PROJECTS;
  const sites = propSites.length > 0 ? propSites : DUMMY_SITES;
  const devices = propDevices.length > 0 ? propDevices : DUMMY_DEVICES;

  // Selection state
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState("");

  // Date range (default to last 24 hours)
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 1);
    return { start, end };
  });

  // Chart settings
  const [chartType, setChartType] = useState<ChartType>("line");
  const [dataSource, setDataSource] = useState<DataSource>("cloud");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("active");

  // Aggregation settings
  const [aggregationType, setAggregationType] = useState<AggregationType>("raw");
  const [isAutoAggregation, setIsAutoAggregation] = useState(true);

  // Parameters on axes
  const [leftAxisParams, setLeftAxisParams] = useState<AxisParameter[]>([]);
  const [rightAxisParams, setRightAxisParams] = useState<AxisParameter[]>([]);

  // Reference lines and calculated fields
  const [referenceLines, setReferenceLines] = useState<ReferenceLine[]>([]);
  const [calculatedFields, setCalculatedFields] = useState<CalculatedField[]>([]);

  // Chart data
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [metadata, setMetadata] = useState<{
    totalPoints: number;
    downsampled: boolean;
    aggregationType?: AggregationType;
    originalPoints?: number;
  } | undefined>();

  // Auto-select aggregation based on date range
  const getAutoAggregationType = useCallback((range: DateRange): AggregationType => {
    const diffHours = (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60);
    if (diffHours < AGGREGATION_THRESHOLDS.raw) return "raw";
    if (diffHours < AGGREGATION_THRESHOLDS.hourly) return "hourly_avg";
    return "daily_avg";
  }, []);

  // Update aggregation when date range changes (if auto mode)
  useEffect(() => {
    if (isAutoAggregation) {
      setAggregationType(getAutoAggregationType(dateRange));
    }
  }, [dateRange, isAutoAggregation, getAutoAggregationType]);

  // Handle manual aggregation change
  const handleAggregationChange = useCallback((type: AggregationType) => {
    setAggregationType(type);
    setIsAutoAggregation(false); // Disable auto when user manually selects
  }, []);

  // Aggregate data helper
  const aggregateData = useCallback(
    (data: ChartDataPoint[], type: AggregationType, params: AxisParameter[]): ChartDataPoint[] => {
      if (type === "raw" || data.length === 0) return data;

      // Parse aggregation type
      const isHourly = type.startsWith("hourly_");
      const method = type.split("_")[1] as "avg" | "min" | "max";

      // Group by time bucket
      const buckets = new Map<string, ChartDataPoint[]>();

      data.forEach((point) => {
        const date = new Date(point.timestamp);
        let bucketKey: string;

        if (isHourly) {
          // Bucket by hour
          bucketKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
        } else {
          // Bucket by day
          bucketKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        }

        if (!buckets.has(bucketKey)) {
          buckets.set(bucketKey, []);
        }
        buckets.get(bucketKey)!.push(point);
      });

      // Aggregate each bucket
      const aggregated: ChartDataPoint[] = [];

      buckets.forEach((points) => {
        if (points.length === 0) return;

        // Use first point's timestamp for the bucket
        const firstPoint = points[0];
        const result: ChartDataPoint = {
          timestamp: firstPoint.timestamp,
          formattedTime: firstPoint.formattedTime,
        };

        // Aggregate each parameter
        params.forEach((param) => {
          const key = `${param.deviceId}:${param.registerName}`;
          const values = points
            .map((p) => p[key])
            .filter((v): v is number => typeof v === "number");

          if (values.length > 0) {
            switch (method) {
              case "min":
                result[key] = Math.min(...values);
                break;
              case "max":
                result[key] = Math.max(...values);
                break;
              case "avg":
              default:
                result[key] = values.reduce((a, b) => a + b, 0) / values.length;
                break;
            }
          }
        });

        aggregated.push(result);
      });

      // Sort by timestamp
      return aggregated.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    },
    []
  );

  // Filter projects by active status
  const filteredProjects = useMemo(() => {
    if (activeFilter === "all") return projects;
    return projects.filter((p) => p.is_active !== false);
  }, [projects, activeFilter]);

  // Filter sites by project and active status
  const filteredSites = useMemo(() => {
    if (!selectedProjectId) return [];
    let filtered = sites.filter((s) => s.project_id === selectedProjectId);
    if (activeFilter === "active") {
      filtered = filtered.filter((s) => s.is_active !== false);
    }
    return filtered;
  }, [sites, selectedProjectId, activeFilter]);

  // Filter devices by site and active status
  const filteredDevices = useMemo(() => {
    if (!selectedSiteId) return [];
    let filtered = devices.filter((d) => d.site_id === selectedSiteId);
    if (activeFilter === "active") {
      filtered = filtered.filter((d) => d.enabled !== false);
    }
    return filtered;
  }, [devices, selectedSiteId, activeFilter]);

  // Get available registers for selected device (or controller)
  const availableRegisters = useMemo((): AvailableRegister[] => {
    if (!selectedDeviceId) return [];

    // Handle Site Controller (calculated fields)
    if (selectedDeviceId === SITE_CONTROLLER_ID) {
      const controllerRegs = DUMMY_REGISTERS[SITE_CONTROLLER_ID] || [];
      return controllerRegs.map((reg) => ({
        id: reg.id,
        name: reg.name,
        unit: reg.unit,
        deviceId: SITE_CONTROLLER_ID,
        deviceName: "Site Controller",
        preferred_chart_type: reg.preferred_chart_type,
      }));
    }

    // Use dummy registers for now (devices)
    const regs = DUMMY_REGISTERS[selectedDeviceId] || [];
    const device = filteredDevices.find((d) => d.id === selectedDeviceId);

    return regs.map((reg) => ({
      id: reg.id,
      name: reg.name,
      unit: reg.unit,
      deviceId: selectedDeviceId,
      deviceName: device?.name || "Unknown",
      preferred_chart_type: reg.preferred_chart_type,
    }));
  }, [selectedDeviceId, filteredDevices]);

  // Handle project change
  const handleProjectChange = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedSiteId("");
    setSelectedDeviceId("");
    setLeftAxisParams([]);
    setRightAxisParams([]);
    setChartData([]);
  }, []);

  // Handle site change
  const handleSiteChange = useCallback((siteId: string) => {
    setSelectedSiteId(siteId);
    setSelectedDeviceId("");
    // Keep existing parameters from other devices
    setChartData([]);
  }, []);

  // Handle device change (for parameter selection)
  const handleDeviceChange = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
  }, []);

  // Validate date range (max 7 days)
  const handleDateRangeChange = useCallback((range: DateRange) => {
    const diffDays = Math.round(
      (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays > MAX_DATE_RANGE_DAYS) {
      // Adjust start date to keep within limit
      const adjustedStart = new Date(range.end);
      adjustedStart.setDate(adjustedStart.getDate() - MAX_DATE_RANGE_DAYS);
      setDateRange({ start: adjustedStart, end: range.end });
    } else {
      setDateRange(range);
    }
  }, []);

  // Fetch data (using dummy data for now)
  const fetchData = useCallback(async () => {
    const allParams = [...leftAxisParams, ...rightAxisParams];
    if (allParams.length === 0) return;

    setIsLoading(true);

    try {
      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Generate dummy data
      const rawData = generateDummyChartData(
        allParams.map((p) => ({
          deviceId: p.deviceId,
          registerName: p.registerName,
        })),
        dateRange.start,
        dateRange.end
      );

      // Apply aggregation
      const processedData = aggregateData(rawData, aggregationType, allParams);

      setChartData(processedData);
      setMetadata({
        totalPoints: processedData.length,
        downsampled: processedData.length < rawData.length,
        aggregationType: aggregationType,
        originalPoints: rawData.length,
      });
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [leftAxisParams, rightAxisParams, dateRange, aggregationType, aggregateData]);

  // Clear chart data when all parameters are removed (but don't auto-fetch)
  useEffect(() => {
    const allParams = [...leftAxisParams, ...rightAxisParams];
    if (allParams.length === 0) {
      setChartData([]);
      setMetadata(undefined);
    }
  }, [leftAxisParams, rightAxisParams]);

  // Export CSV
  const exportCSV = useCallback(() => {
    if (chartData.length === 0) return;

    const allParams = [...leftAxisParams, ...rightAxisParams];
    const headers = ["timestamp", ...allParams.map((p) => `${p.deviceName} - ${p.registerName} (${p.unit})`)];

    const rows = chartData.map((point) => {
      const row = [point.timestamp];
      for (const param of allParams) {
        const key = `${param.deviceId}:${param.registerName}`;
        row.push(String(point[key] ?? ""));
      }
      return row.join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `historical-data-${selectedSiteId}-${dateRange.start.toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [chartData, leftAxisParams, rightAxisParams, selectedSiteId, dateRange]);

  // Export PNG (placeholder - would need html2canvas or similar)
  const exportPNG = useCallback(() => {
    // TODO: Implement PNG export
    alert("PNG export coming soon!");
  }, []);

  // Check if we can plot
  const canPlot = (leftAxisParams.length > 0 || rightAxisParams.length > 0) && !!selectedSiteId;
  const canExport = chartData.length > 0;

  // All parameters for advanced options
  const allParams = [...leftAxisParams, ...rightAxisParams];

  // Get selected project's timezone
  const selectedProject = useMemo(() => {
    return projects.find((p) => p.id === selectedProjectId);
  }, [projects, selectedProjectId]);

  const projectTimezone = selectedProject?.timezone || "UTC";

  return (
    <div className="space-y-6 p-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold">Historical Data</h1>
        <p className="text-muted-foreground">
          Analyze historical data
          <span className="text-xs ml-2 opacity-70">• Data may be delayed by a few minutes</span>
        </p>
      </div>

      {/* Chart - Always on top */}
      <Card>
        <CardContent className="pt-6">
          <HistoricalChart
            data={chartData}
            leftAxisParams={leftAxisParams}
            rightAxisParams={rightAxisParams}
            referenceLines={referenceLines}
            isLoading={isLoading}
            onRefresh={fetchData}
            onExportCSV={exportCSV}
            onExportPNG={exportPNG}
            emptyMessage={
              !selectedSiteId
                ? "Select a project and site to begin"
                : leftAxisParams.length === 0 && rightAxisParams.length === 0
                ? "Add parameters to visualize data"
                : "No data available for selected parameters"
            }
            metadata={metadata}
          />
          {/* Timezone indicator */}
          {selectedProjectId && (
            <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Timezone: <span className="font-medium">{projectTimezone}</span>
                <span className="ml-1 opacity-70">(project timezone)</span>
              </span>
              <span>
                All times shown in project&apos;s local timezone
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Controls - Below chart for easy parameter selection */}
      <Card>
        <CardContent className="pt-6">
          <ControlsRow
            projects={filteredProjects}
            sites={filteredSites}
            selectedProjectId={selectedProjectId}
            selectedSiteId={selectedSiteId}
            onProjectChange={handleProjectChange}
            onSiteChange={handleSiteChange}
            dateRange={dateRange}
            onDateRangeChange={handleDateRangeChange}
            aggregationType={aggregationType}
            onAggregationChange={handleAggregationChange}
            isAutoAggregation={isAutoAggregation}
            dataSource={dataSource}
            onDataSourceChange={setDataSource}
            isSuperAdmin={isSuperAdmin}
            onPlot={fetchData}
            onExportCSV={exportCSV}
            isLoading={isLoading}
            canPlot={canPlot}
            canExport={canExport}
            activeFilter={activeFilter}
            onActiveFilterChange={setActiveFilter}
          />
        </CardContent>
      </Card>

      {/* Parameter Selection */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Parameter Selection</CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedSiteId ? (
            <div className="text-center py-12 text-muted-foreground">
              Select a project and site above to configure parameters
            </div>
          ) : (
            <ParameterSelector
              devices={filteredDevices}
              selectedDeviceId={selectedDeviceId}
              onDeviceChange={handleDeviceChange}
              availableRegisters={availableRegisters}
              leftAxisParams={leftAxisParams}
              rightAxisParams={rightAxisParams}
              onLeftAxisChange={setLeftAxisParams}
              onRightAxisChange={setRightAxisParams}
              defaultChartType={chartType}
            />
          )}
        </CardContent>
      </Card>

      {/* Advanced Options */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Advanced Options</CardTitle>
        </CardHeader>
        <CardContent>
          <AdvancedOptions
            referenceLines={referenceLines}
            onReferenceLinesChange={setReferenceLines}
            calculatedFields={calculatedFields}
            onCalculatedFieldsChange={setCalculatedFields}
            parameters={allParams}
          />
        </CardContent>
      </Card>
    </div>
  );
}
