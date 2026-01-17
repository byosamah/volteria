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
  MAX_DATE_RANGE,
  AGGREGATION_THRESHOLDS,
  getAvailableAggregations,
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

  // Date range (default to last 24 hours - matching preset format)
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
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

  // Get selected site name
  const selectedSiteName = useMemo(() => {
    return filteredSites.find((s) => s.id === selectedSiteId)?.name || "";
  }, [filteredSites, selectedSiteId]);

  // Available registers state (fetched from API or dummy for controller)
  const [availableRegisters, setAvailableRegisters] = useState<AvailableRegister[]>([]);
  const [isLoadingRegisters, setIsLoadingRegisters] = useState(false);

  // Fetch registers when device changes
  useEffect(() => {
    const fetchRegisters = async () => {
      if (!selectedDeviceId || !selectedSiteId) {
        setAvailableRegisters([]);
        return;
      }

      // Handle Site Controller (calculated fields) - use dummy data
      if (selectedDeviceId === SITE_CONTROLLER_ID) {
        const controllerRegs = DUMMY_REGISTERS[SITE_CONTROLLER_ID] || [];
        setAvailableRegisters(
          controllerRegs.map((reg) => ({
            id: reg.id,
            name: reg.name,
            unit: reg.unit,
            deviceId: SITE_CONTROLLER_ID,
            deviceName: "Site Controller",
            siteId: selectedSiteId,
            siteName: selectedSiteName,
            preferred_chart_type: reg.preferred_chart_type,
          }))
        );
        return;
      }

      // Fetch real registers from API
      setIsLoadingRegisters(true);
      try {
        const response = await fetch(`/api/devices/${selectedDeviceId}/registers`);
        if (response.ok) {
          const data = await response.json();
          const device = filteredDevices.find((d) => d.id === selectedDeviceId);
          setAvailableRegisters(
            data.registers.map((reg: { name: string; unit: string; preferred_chart_type?: string }) => ({
              id: `${selectedDeviceId}:${reg.name}`,
              name: reg.name,
              unit: reg.unit || "",
              deviceId: selectedDeviceId,
              deviceName: device?.name || data.deviceName || "Unknown",
              siteId: selectedSiteId,
              siteName: selectedSiteName,
              preferred_chart_type: reg.preferred_chart_type,
            }))
          );
        } else {
          // Fall back to dummy registers if API fails
          const regs = DUMMY_REGISTERS[selectedDeviceId] || [];
          const device = filteredDevices.find((d) => d.id === selectedDeviceId);
          setAvailableRegisters(
            regs.map((reg) => ({
              id: reg.id,
              name: reg.name,
              unit: reg.unit,
              deviceId: selectedDeviceId,
              deviceName: device?.name || "Unknown",
              siteId: selectedSiteId,
              siteName: selectedSiteName,
              preferred_chart_type: reg.preferred_chart_type,
            }))
          );
        }
      } catch (error) {
        console.error("Failed to fetch registers:", error);
        // Fall back to dummy registers
        const regs = DUMMY_REGISTERS[selectedDeviceId] || [];
        const device = filteredDevices.find((d) => d.id === selectedDeviceId);
        setAvailableRegisters(
          regs.map((reg) => ({
            id: reg.id,
            name: reg.name,
            unit: reg.unit,
            deviceId: selectedDeviceId,
            deviceName: device?.name || "Unknown",
            siteId: selectedSiteId,
            siteName: selectedSiteName,
            preferred_chart_type: reg.preferred_chart_type,
          }))
        );
      } finally {
        setIsLoadingRegisters(false);
      }
    };

    fetchRegisters();
  }, [selectedDeviceId, selectedSiteId, selectedSiteName, filteredDevices]);

  // Handle project change (just for browsing - doesn't clear selected parameters)
  const handleProjectChange = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedSiteId("");
    setSelectedDeviceId("");
    // Don't clear axis params - user can add parameters from multiple projects/sites
  }, []);

  // Handle site change (just for browsing - doesn't clear selected parameters)
  const handleSiteChange = useCallback((siteId: string) => {
    setSelectedSiteId(siteId);
    setSelectedDeviceId("");
    // Don't clear axis params - user can add parameters from multiple sites
  }, []);

  // Handle device change (for parameter selection)
  const handleDeviceChange = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
  }, []);

  // Validate date range and auto-update aggregation if needed
  const handleDateRangeChange = useCallback((range: DateRange) => {
    const diffDays = Math.ceil(
      (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Enforce max date range (daily = 2 years)
    const maxDays = MAX_DATE_RANGE.daily;
    if (diffDays > maxDays) {
      const adjustedStart = new Date(range.end);
      adjustedStart.setDate(adjustedStart.getDate() - maxDays);
      adjustedStart.setHours(0, 0, 0, 0);
      setDateRange({ start: adjustedStart, end: range.end });
    } else {
      setDateRange(range);
    }

    // Auto-switch to higher aggregation if current one is unavailable for new range
    if (!isAutoAggregation) {
      const availableGroups = getAvailableAggregations(diffDays);
      const currentGroup = aggregationType === "raw" ? "raw" : aggregationType.startsWith("hourly") ? "hourly" : "daily";

      if (!availableGroups.includes(currentGroup)) {
        // Switch to the first available group
        const newGroup = availableGroups[0];
        if (newGroup === "raw") {
          setAggregationType("raw");
        } else if (newGroup === "hourly") {
          setAggregationType("hourly_avg");
        } else {
          setAggregationType("daily_avg");
        }
      }
    }
  }, [isAutoAggregation, aggregationType]);

  // Transform API device readings to chart data format
  const transformApiToChartData = useCallback(
    (
      deviceReadings: Array<{
        device_id: string;
        register_name: string;
        data: Array<{ timestamp: string; value: number }>;
      }>,
      params: AxisParameter[]
    ): ChartDataPoint[] => {
      if (!deviceReadings || deviceReadings.length === 0) {
        return [];
      }

      // Collect all unique timestamps
      const timestampSet = new Set<string>();
      deviceReadings.forEach((reading) => {
        reading.data.forEach((point) => {
          timestampSet.add(point.timestamp);
        });
      });

      // Sort timestamps
      const timestamps = Array.from(timestampSet).sort(
        (a, b) => new Date(a).getTime() - new Date(b).getTime()
      );

      // Create lookup maps for each device:register combination
      const dataLookup: Record<string, Record<string, number>> = {};
      deviceReadings.forEach((reading) => {
        const key = `${reading.device_id}:${reading.register_name}`;
        dataLookup[key] = {};
        reading.data.forEach((point) => {
          dataLookup[key][point.timestamp] = point.value;
        });
      });

      // Build chart data points
      return timestamps.map((timestamp) => {
        const point: ChartDataPoint = {
          timestamp,
          formattedTime: new Date(timestamp).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };

        // Add values for each parameter
        params.forEach((param) => {
          const key = `${param.deviceId}:${param.registerName}`;
          const value = dataLookup[key]?.[timestamp];
          point[key] = value !== undefined ? value : null;
        });

        return point;
      });
    },
    []
  );

  // Fetch data from API (better for large datasets - server-side control)
  const fetchData = useCallback(async () => {
    const allParams = [...leftAxisParams, ...rightAxisParams];
    if (allParams.length === 0) return;

    setIsLoading(true);

    try {
      // Collect unique site IDs and device IDs from parameters
      const siteIds = [...new Set(allParams.map((p) => p.siteId).filter(Boolean))];
      const deviceIds = [...new Set(allParams.map((p) => p.deviceId).filter((id) => id && id !== SITE_CONTROLLER_ID))];
      const registerNames = [...new Set(allParams.map((p) => p.registerName))];

      // Convert aggregationType to simple form for API (raw, hourly, daily)
      const apiAggregation = aggregationType === "raw"
        ? "raw"
        : aggregationType.startsWith("hourly")
        ? "hourly"
        : "daily";

      // If using dummy data (no real site IDs or device IDs), fall back to dummy generation
      if (siteIds.length === 0 || deviceIds.length === 0) {
        // Fall back to dummy data for development/Site Controller
        const dummyData = generateDummyChartData(
          allParams.map((p) => ({
            deviceId: p.deviceId,
            registerName: p.registerName,
          })),
          dateRange.start,
          dateRange.end
        );
        setChartData(dummyData);
        setMetadata({
          totalPoints: dummyData.length,
          downsampled: false,
          aggregationType: aggregationType,
        });
        return;
      }

      // Build API query params - aggregation is now done server-side
      const params = new URLSearchParams({
        siteIds: siteIds.join(","),
        deviceIds: deviceIds.join(","),
        registers: registerNames.join(","),
        start: dateRange.start.toISOString(),
        end: dateRange.end.toISOString(),
        source: "device",
        aggregation: apiAggregation,
      });

      const response = await fetch(`/api/historical?${params}`);
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      // Transform API response to ChartDataPoint format (already aggregated server-side)
      const chartPoints = transformApiToChartData(data.deviceReadings || [], allParams);

      setChartData(chartPoints);
      setMetadata({
        totalPoints: chartPoints.length,
        downsampled: data.metadata?.downsampled || false,
        aggregationType: data.metadata?.aggregationType || aggregationType,
      });
    } catch (error) {
      console.error("Failed to fetch data:", error);
      // Show error to user
      setChartData([]);
      setMetadata(undefined);
    } finally {
      setIsLoading(false);
    }
  }, [leftAxisParams, rightAxisParams, dateRange, aggregationType, transformApiToChartData]);

  // Clear chart data when all parameters are removed (but don't auto-fetch)
  useEffect(() => {
    const allParams = [...leftAxisParams, ...rightAxisParams];
    if (allParams.length === 0) {
      setChartData([]);
      setMetadata(undefined);
    }
  }, [leftAxisParams, rightAxisParams]);

  // Format timestamp in a specific timezone (CSV-safe, no commas)
  const formatTimestampForCSV = useCallback((isoString: string, timezone: string): string => {
    try {
      const date = new Date(isoString);
      // Format as YYYY-MM-DD HH:MM:SS (no commas for CSV safety)
      const year = date.toLocaleString("en-US", { timeZone: timezone, year: "numeric" });
      const month = date.toLocaleString("en-US", { timeZone: timezone, month: "2-digit" });
      const day = date.toLocaleString("en-US", { timeZone: timezone, day: "2-digit" });
      const hour = date.toLocaleString("en-US", { timeZone: timezone, hour: "2-digit", hour12: false });
      const minute = date.toLocaleString("en-US", { timeZone: timezone, minute: "2-digit" });
      const second = date.toLocaleString("en-US", { timeZone: timezone, second: "2-digit" });
      return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    } catch {
      return isoString;
    }
  }, []);

  // Get selected project's timezone (or browser timezone if not set)
  const selectedProject = useMemo(() => {
    return projects.find((p) => p.id === selectedProjectId);
  }, [projects, selectedProjectId]);

  // Detect browser timezone
  const browserTimezone = useMemo(() => {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }, []);

  // Use project timezone if set, otherwise browser timezone
  const displayTimezone = selectedProject?.timezone || browserTimezone;
  const isUsingBrowserTimezone = !selectedProject?.timezone;

  // Helper to escape CSV values (quote if contains comma, quote, or newline)
  const escapeCSV = useCallback((value: string): string => {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }, []);

  // Export CSV with UTC and local time columns
  const exportCSV = useCallback(() => {
    if (chartData.length === 0) return;

    const allParams = [...leftAxisParams, ...rightAxisParams];

    // Headers: datetime_utc, datetime_local (timezone), then data columns
    const headers = [
      "datetime_utc",
      `datetime_local (${displayTimezone})`,
      ...allParams.map((p) => escapeCSV(`${p.deviceName} - ${p.registerName} (${p.unit})`)),
    ];

    const rows = chartData.map((point) => {
      // Format local time as YYYY-MM-DD HH:MM:SS (no commas)
      const localTime = formatTimestampForCSV(point.timestamp, displayTimezone);

      const row = [
        point.timestamp, // UTC ISO string
        localTime,       // Clean formatted local time (YYYY-MM-DD HH:MM:SS)
      ];
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
  }, [chartData, leftAxisParams, rightAxisParams, selectedSiteId, dateRange, displayTimezone, formatTimestampForCSV, escapeCSV]);

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
            timezone={displayTimezone}
          />
          {/* Timezone indicator */}
          {selectedProjectId && (
            <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Timezone: <span className="font-medium">{displayTimezone}</span>
                <span className="ml-1 opacity-70">
                  ({isUsingBrowserTimezone ? "browser timezone" : "project timezone"})
                </span>
              </span>
              <span>
                {isUsingBrowserTimezone
                  ? "Times shown in your browser's local timezone"
                  : "Times shown in project's configured timezone"}
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
            hasSiteSelected={!!selectedSiteId}
          />
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
