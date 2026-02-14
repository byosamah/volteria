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

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
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
  RangeMode,
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

  // Date range (initialized on client to avoid hydration mismatch)
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Range mode: relative (presets slide to now) vs absolute (custom dates stay fixed)
  const [rangeMode, setRangeMode] = useState<RangeMode>("relative");

  // Initialize date range on client side only (avoids hydration mismatch)
  useEffect(() => {
    if (!isHydrated) {
      const end = new Date();
      const start = new Date();
      start.setTime(end.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago
      setDateRange({ start, end });
      setIsHydrated(true);
    }
  }, [isHydrated]);

  // Chart settings
  const [chartType, setChartType] = useState<ChartType>("line");
  const [dataSource, setDataSource] = useState<DataSource>("cloud");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("active");

  // Aggregation settings
  const [aggregationType, setAggregationType] = useState<AggregationType>("hourly_avg");
  const [isAutoAggregation, setIsAutoAggregation] = useState(false);

  // Parameters on axes
  const [leftAxisParams, setLeftAxisParams] = useState<AxisParameter[]>([]);
  const [rightAxisParams, setRightAxisParams] = useState<AxisParameter[]>([]);

  // Reference lines and calculated fields
  const [referenceLines, setReferenceLines] = useState<ReferenceLine[]>([]);
  const [calculatedFields, setCalculatedFields] = useState<CalculatedField[]>([]);
  const [showCalcOnly, setShowCalcOnly] = useState(false);

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
    if (isAutoAggregation && dateRange) {
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

  // For local data source: determine locked site from existing parameters
  // Local mode only allows parameters from ONE site
  const localLockedSiteId = useMemo(() => {
    if (dataSource !== "local") return null;
    const allParams = [...leftAxisParams, ...rightAxisParams];
    if (allParams.length === 0) return null;
    // Return the site ID of the first parameter (all should be same site)
    return allParams[0].siteId || null;
  }, [dataSource, leftAxisParams, rightAxisParams]);

  // Available registers state (fetched from API or dummy for controller)
  const [availableRegisters, setAvailableRegisters] = useState<AvailableRegister[]>([]);
  const [isLoadingRegisters, setIsLoadingRegisters] = useState(false);

  // Cache for device registers (persists across device switches)
  const registersCache = useRef<Map<string, AvailableRegister[]>>(new Map());

  // Fetch registers when device changes (config + historical from DB)
  useEffect(() => {
    const fetchRegisters = async () => {
      if (!selectedDeviceId || !selectedSiteId) {
        setAvailableRegisters([]);
        return;
      }

      // Check cache first (key includes siteId for site context)
      const cacheKey = `${selectedSiteId}:${selectedDeviceId}`;
      const cached = registersCache.current.get(cacheKey);
      if (cached) {
        setAvailableRegisters(cached);
        return;
      }

      // Handle Site Controller (calculated fields) - use dummy data
      if (selectedDeviceId === SITE_CONTROLLER_ID) {
        const controllerRegs = DUMMY_REGISTERS[SITE_CONTROLLER_ID] || [];
        const mappedRegs = controllerRegs.map((reg) => ({
          id: reg.id,
          name: reg.name,
          unit: reg.unit,
          deviceId: SITE_CONTROLLER_ID,
          deviceName: "Site Controller",
          siteId: selectedSiteId,
          siteName: selectedSiteName,
          preferred_chart_type: reg.preferred_chart_type,
          status: "active" as const,
        }));
        registersCache.current.set(cacheKey, mappedRegs);
        setAvailableRegisters(mappedRegs);
        return;
      }

      // Fetch real registers from API + historical registers
      setIsLoadingRegisters(true);
      try {
        const device = filteredDevices.find((d) => d.id === selectedDeviceId);
        const deviceName = device?.name || "Unknown";

        // Fetch both config registers and historical register names in parallel
        const [configResponse, historicalResponse] = await Promise.all([
          fetch(`/api/devices/${selectedDeviceId}/registers`),
          fetch(`/api/historical/registers?deviceIds=${selectedDeviceId}`),
        ]);

        // Process config registers (active)
        const configRegisterNames = new Set<string>();
        let activeRegs: AvailableRegister[] = [];

        if (configResponse.ok) {
          const configData = await configResponse.json();
          activeRegs = configData.registers.map((reg: { name: string; unit: string; preferred_chart_type?: string }) => {
            configRegisterNames.add(reg.name);
            return {
              id: `${selectedDeviceId}:${reg.name}`,
              name: reg.name,
              unit: reg.unit || "",
              deviceId: selectedDeviceId,
              deviceName: configData.deviceName || deviceName,
              siteId: selectedSiteId,
              siteName: selectedSiteName,
              preferred_chart_type: reg.preferred_chart_type,
              status: "active" as const,
            };
          });
        }

        // Process inactive registers (only those NOT in config but have data in DB)
        let inactiveRegs: AvailableRegister[] = [];

        if (historicalResponse.ok) {
          const historicalData = await historicalResponse.json();
          const deviceHistorical = historicalData.registers?.find(
            (r: { deviceId: string; registers: Array<{ name: string; firstSeen: string; lastSeen: string }> }) => r.deviceId === selectedDeviceId
          );

          if (deviceHistorical?.registers) {
            inactiveRegs = deviceHistorical.registers
              .filter((r: { name: string }) => !configRegisterNames.has(r.name))
              .map((r: { name: string; firstSeen: string; lastSeen: string }) => ({
                id: `${selectedDeviceId}:${r.name}`,
                name: r.name,
                unit: "", // Inactive registers don't have unit info in DB
                deviceId: selectedDeviceId,
                deviceName: deviceName,
                siteId: selectedSiteId,
                siteName: selectedSiteName,
                firstSeen: r.firstSeen,
                lastSeen: r.lastSeen,
                status: "inactive" as const,
              }))
              .sort((a: AvailableRegister, b: AvailableRegister) => {
                // Sort by lastSeen descending (most recently active first)
                if (!a.lastSeen || !b.lastSeen) return 0;
                return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
              });
          }
        }

        // Merge: active first, then inactive
        const mergedRegs = [...activeRegs, ...inactiveRegs];
        registersCache.current.set(cacheKey, mergedRegs);
        setAvailableRegisters(mergedRegs);

      } catch (error) {
        console.error("Failed to fetch registers:", error);
        // Fall back to dummy registers (don't cache errors)
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
            status: "active" as const,
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

  // Handle data source change - reset to appropriate settings for each source
  const handleDataSourceChange = useCallback((source: DataSource) => {
    setDataSource(source);

    // When switching to local:
    // - Force "active" filter (inactive sites have no local hardware)
    // - Single site only (clear parameters from other sites)
    // - Max 1 hour for raw data, otherwise hourly aggregation
    // - Max 30 days total
    // - Reset to 1h date range for optimal local performance
    if (source === "local") {
      // Force active filter - inactive sites don't have local hardware
      setActiveFilter("active");

      // Reset to 1 hour date range (optimal for local raw data)
      const end = new Date();
      const start = new Date();
      start.setHours(start.getHours() - 1);
      setDateRange({ start, end });

      // Set raw aggregation for 1h range
      if (isAutoAggregation) {
        setAggregationType("raw");
      }

      // Clear parameters from other sites if multiple sites selected
      const currentSiteId = selectedSiteId;
      if (currentSiteId) {
        setLeftAxisParams(prev => prev.filter(p => p.siteId === currentSiteId));
        setRightAxisParams(prev => prev.filter(p => p.siteId === currentSiteId));
      }
    }
  }, [isAutoAggregation, selectedSiteId]);

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
    if (allParams.length === 0 || !dateRange) return;

    // RELATIVE mode: slide to now (presets like 1h, 24h, 3d, 7d)
    // ABSOLUTE mode: keep exact dates (custom selection via calendar/time input)
    let effectiveDateRange = dateRange;

    if (rangeMode === "relative") {
      const now = new Date();
      const duration = dateRange.end.getTime() - dateRange.start.getTime();
      const newEnd = now;
      const newStart = new Date(now.getTime() - duration);
      effectiveDateRange = { start: newStart, end: newEnd };
      setDateRange(effectiveDateRange);
    }
    // ABSOLUTE: use dateRange as-is, no sliding

    setIsLoading(true);

    try {
      // Collect unique site IDs and device IDs from parameters
      const siteIds = [...new Set(allParams.map((p) => p.siteId).filter(Boolean))];
      const deviceIds = [...new Set(allParams.map((p) => p.deviceId).filter((id) => id && id !== SITE_CONTROLLER_ID))];
      const registerNames = [...new Set(allParams.map((p) => p.registerName))];

      // Convert aggregationType to simple form for API (raw, hourly, daily)
      let apiAggregation = aggregationType === "raw"
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
          effectiveDateRange.start,
          effectiveDateRange.end
        );
        setChartData(dummyData);
        setMetadata({
          totalPoints: dummyData.length,
          downsampled: false,
          aggregationType: aggregationType,
        });
        return;
      }

      // Validate local data source constraints
      if (dataSource === "local") {
        // Local data source only supports one site at a time
        if (siteIds.length > 1) {
          throw new Error("Local data source only supports one site at a time. Please select parameters from a single site.");
        }

        const diffDays = (effectiveDateRange.end.getTime() - effectiveDateRange.start.getTime()) / (1000 * 60 * 60 * 24);
        const diffHours = diffDays * 24;

        // Local data source limited to 30 days for aggregated data
        if (diffDays > 30) {
          throw new Error("Local data source is limited to 30 days. Use cloud data source for longer date ranges.");
        }

        // For local source, max 1 hour for raw data (otherwise times out over SSH)
        if (diffHours > 1 && apiAggregation === "raw") {
          // Auto-upgrade to hourly to avoid timeout
          apiAggregation = "hourly";
        }
      }

      // Build API query params
      const params = new URLSearchParams({
        siteIds: siteIds.join(","),
        deviceIds: deviceIds.join(","),
        registers: registerNames.join(","),
        start: effectiveDateRange.start.toISOString(),
        end: effectiveDateRange.end.toISOString(),
        source: "device",
        aggregation: apiAggregation,
      });

      // Use appropriate API endpoint based on data source
      const apiEndpoint = dataSource === "local"
        ? `/api/historical/local?${params}`
        : `/api/historical?${params}`;

      // Always fetch fresh data - no browser caching
      const response = await fetch(apiEndpoint, { cache: 'no-store' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API error: ${response.status}`);
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
      // Show error to user - could use toast notification here
      setChartData([]);
      setMetadata(undefined);
      // Re-throw to show in UI
      if (error instanceof Error) {
        alert(error.message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [leftAxisParams, rightAxisParams, dateRange, aggregationType, dataSource, rangeMode, transformApiToChartData, setDateRange]);

  // Clear chart data when all parameters are removed (but don't auto-fetch)
  useEffect(() => {
    const allParams = [...leftAxisParams, ...rightAxisParams];
    if (allParams.length === 0) {
      setChartData([]);
      setMetadata(undefined);
    }
  }, [leftAxisParams, rightAxisParams]);

  // Compute calculated field values and inject into chart data
  // Uses forward-fill: at each timestamp, carry forward the last known value per operand
  const { chartDataWithCalcFields, calcFieldParams } = useMemo(() => {
    const allParams = [...leftAxisParams, ...rightAxisParams];

    // Filter to valid calculated fields (all operands reference existing params with data)
    const validFields = calculatedFields.filter((field) => {
      if (field.operands.length < 2) return false;
      return field.operands.every((op) => {
        if (!op.parameterId) return false;
        return allParams.some((p) => p.id === op.parameterId);
      });
    });

    if (validFields.length === 0 || chartData.length === 0) {
      return { chartDataWithCalcFields: chartData, calcFieldParams: [] };
    }

    // Build virtual AxisParameter for each valid calc field
    const virtualParams: AxisParameter[] = validFields.map((field) => ({
      id: `calcparam-${field.id}`,
      registerId: field.id,
      registerName: field.name,
      deviceId: `calc`,
      deviceName: "Calculated",
      siteId: "",
      siteName: "",
      unit: field.unit,
      color: field.color,
      chartType: "line" as const,
    }));

    // Build forward-fill lookup: track last known value per data key (single pass, O(n))
    const allDataKeys = new Set<string>();
    for (const field of validFields) {
      for (const op of field.operands) {
        const param = allParams.find((p) => p.id === op.parameterId);
        if (param) allDataKeys.add(`${param.deviceId}:${param.registerName}`);
      }
    }
    const lastKnown: Record<string, number> = {};

    // Inject computed values into chart data (new array, don't mutate)
    const enriched = chartData.map((point) => {
      const newPoint = { ...point };

      // Update forward-fill tracker for all relevant keys
      for (const key of allDataKeys) {
        const val = point[key];
        if (val !== null && val !== undefined) {
          lastKnown[key] = val as number;
        }
      }

      for (const field of validFields) {
        let result: number | null = null;

        for (const operand of field.operands) {
          const param = allParams.find((p) => p.id === operand.parameterId);
          if (!param) { result = null; break; }

          const dataKey = `${param.deviceId}:${param.registerName}`;
          const value = (point[dataKey] !== null && point[dataKey] !== undefined)
            ? point[dataKey] as number
            : lastKnown[dataKey] ?? null;

          if (value === null) {
            result = null;
            break;
          }

          if (result === null) {
            result = operand.operation === "-" ? -value : value;
          } else {
            result = operand.operation === "-" ? result - value : result + value;
          }
        }

        const calcKey = `calc:${field.name}`;
        newPoint[calcKey] = result !== null ? Math.round(result * 1000) / 1000 : null;
      }

      return newPoint;
    });

    return { chartDataWithCalcFields: enriched, calcFieldParams: virtualParams };
  }, [chartData, calculatedFields, leftAxisParams, rightAxisParams]);

  // Split virtual params by axis for chart rendering
  const calcFieldLeftParams = useMemo(() =>
    calcFieldParams.filter((_, i) => {
      const field = calculatedFields.find((f) => `calcparam-${f.id}` === calcFieldParams[i]?.id);
      return field?.axis === "left";
    }),
    [calcFieldParams, calculatedFields]
  );

  const calcFieldRightParams = useMemo(() =>
    calcFieldParams.filter((_, i) => {
      const field = calculatedFields.find((f) => `calcparam-${f.id}` === calcFieldParams[i]?.id);
      return field?.axis === "right";
    }),
    [calcFieldParams, calculatedFields]
  );

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

  // Export CSV with UTC and local time columns (includes calculated fields)
  const exportCSV = useCallback(() => {
    if (chartDataWithCalcFields.length === 0 || !dateRange) return;

    const allParams = [...leftAxisParams, ...rightAxisParams];

    // Valid calculated fields for export
    const validCalcFields = calculatedFields.filter((field) => {
      if (field.operands.length < 2) return false;
      return field.operands.every((op) =>
        op.parameterId && allParams.some((p) => p.id === op.parameterId)
      );
    });

    // When "show calculated only" — skip raw param columns
    const exportParams = showCalcOnly ? [] : allParams;

    // Headers: datetime_utc, datetime_local (timezone), data columns, calculated field columns
    const headers = [
      "datetime_utc",
      `datetime_local (${displayTimezone})`,
      ...exportParams.map((p) => escapeCSV(`${p.deviceName} - ${p.registerName} (${p.unit})`)),
      ...validCalcFields.map((f) => escapeCSV(`${f.name} (Calculated) (${f.unit})`)),
    ];

    const rows = chartDataWithCalcFields.map((point) => {
      const localTime = formatTimestampForCSV(point.timestamp, displayTimezone);

      const row = [
        point.timestamp,
        localTime,
      ];
      for (const param of exportParams) {
        const key = `${param.deviceId}:${param.registerName}`;
        row.push(String(point[key] ?? ""));
      }
      for (const field of validCalcFields) {
        const calcKey = `calc:${field.name}`;
        row.push(String(point[calcKey] ?? ""));
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
  }, [chartDataWithCalcFields, leftAxisParams, rightAxisParams, calculatedFields, showCalcOnly, selectedSiteId, dateRange, displayTimezone, formatTimestampForCSV, escapeCSV]);

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

  // Show loading state during hydration
  if (!isHydrated || !dateRange) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold">Historical Data</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

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
            data={chartDataWithCalcFields}
            leftAxisParams={showCalcOnly ? calcFieldLeftParams : [...leftAxisParams, ...calcFieldLeftParams]}
            rightAxisParams={showCalcOnly ? calcFieldRightParams : [...rightAxisParams, ...calcFieldRightParams]}
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
          {/* Below-chart row: calculated-only toggle + timezone */}
          <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
            {/* Calculated fields only toggle — only visible when calc fields exist */}
            {calcFieldParams.length > 0 ? (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Switch
                  checked={showCalcOnly}
                  onCheckedChange={setShowCalcOnly}
                  className="scale-75 origin-left"
                />
                <span className={showCalcOnly ? "text-foreground font-medium" : ""}>
                  Show calculated fields only
                </span>
              </label>
            ) : selectedProjectId ? (
              <span>
                Timezone: <span className="font-medium">{displayTimezone}</span>
                <span className="ml-1 opacity-70">
                  ({isUsingBrowserTimezone ? "browser timezone" : "project timezone"})
                </span>
              </span>
            ) : <span />}
            {selectedProjectId && (
              <span>
                {calcFieldParams.length > 0 && (
                  <>
                    <span className="font-medium">{displayTimezone}</span>
                    <span className="mx-1">•</span>
                  </>
                )}
                {isUsingBrowserTimezone
                  ? "Browser timezone"
                  : "Project timezone"}
              </span>
            )}
          </div>
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
            rangeMode={rangeMode}
            onRangeModeChange={setRangeMode}
            aggregationType={aggregationType}
            onAggregationChange={handleAggregationChange}
            isAutoAggregation={isAutoAggregation}
            dataSource={dataSource}
            onDataSourceChange={handleDataSourceChange}
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
            dataSource={dataSource}
            currentSiteId={selectedSiteId}
            localLockedSiteId={localLockedSiteId}
            isLoadingRegisters={isLoadingRegisters}
            activeFilter={activeFilter}
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
