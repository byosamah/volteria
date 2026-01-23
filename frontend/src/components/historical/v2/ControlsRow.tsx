"use client";

import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Cloud, HardDrive, Download, Play, Filter } from "lucide-react";
import { DateRangeSelector } from "./DateRangeSelector";
import { AggregationSelector } from "./AggregationSelector";
import { getAvailableAggregations } from "./constants";
import type { Project, Site, DateRange, DataSource, ActiveFilter, AggregationType, AggregationGroup, RangeMode } from "./types";

interface ControlsRowProps {
  projects: Project[];
  sites: Site[];
  selectedProjectId: string;
  selectedSiteId: string;
  onProjectChange: (projectId: string) => void;
  onSiteChange: (siteId: string) => void;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  rangeMode: RangeMode;
  onRangeModeChange: (mode: RangeMode) => void;
  aggregationType: AggregationType;
  onAggregationChange: (type: AggregationType) => void;
  isAutoAggregation: boolean;
  dataSource: DataSource;
  onDataSourceChange: (source: DataSource) => void;
  isSuperAdmin: boolean;
  onPlot: () => void;
  onExportCSV: () => void;
  isLoading: boolean;
  canPlot: boolean;
  canExport: boolean;
  activeFilter: ActiveFilter;
  onActiveFilterChange: (filter: ActiveFilter) => void;
}

export function ControlsRow({
  projects,
  sites,
  selectedProjectId,
  selectedSiteId,
  onProjectChange,
  onSiteChange,
  dateRange,
  onDateRangeChange,
  rangeMode,
  onRangeModeChange,
  aggregationType,
  onAggregationChange,
  isAutoAggregation,
  dataSource,
  onDataSourceChange,
  isSuperAdmin,
  onPlot,
  onExportCSV,
  isLoading,
  canPlot,
  canExport,
  activeFilter,
  onActiveFilterChange,
}: ControlsRowProps) {
  const filteredSites = selectedProjectId
    ? sites.filter((s) => s.project_id === selectedProjectId)
    : [];

  // Calculate date range in hours
  const dateRangeHours = useMemo(() => {
    return (dateRange.end.getTime() - dateRange.start.getTime()) / (1000 * 60 * 60);
  }, [dateRange]);

  // Calculate available aggregation groups based on date range AND data source
  const availableAggregationGroups = useMemo((): AggregationGroup[] => {
    const days = Math.ceil(dateRangeHours / 24);
    let groups = getAvailableAggregations(days);

    // For local data source: Raw only available for <= 1 hour
    if (dataSource === "local" && dateRangeHours > 1) {
      groups = groups.filter(g => g !== "raw");
    }

    return groups;
  }, [dateRangeHours, dataSource]);

  return (
    <div className="space-y-4">
      {/* Single row with all controls - justified across full width */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        {/* Left: Project + Site + Date */}
        <div className="flex flex-wrap items-end gap-3">
          {/* Project */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Project</label>
            <Select value={selectedProjectId} onValueChange={onProjectChange}>
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    <span className={project.is_active === false ? "text-muted-foreground" : ""}>
                      {project.name}
                      {project.is_active === false && (
                        <span className="ml-1 text-xs opacity-60">(inactive)</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Site */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Site</label>
            <Select
              value={selectedSiteId}
              onValueChange={onSiteChange}
              disabled={!selectedProjectId}
            >
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue placeholder="Select site" />
              </SelectTrigger>
              <SelectContent>
                {filteredSites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>
                    <span className={site.is_active === false ? "text-muted-foreground" : ""}>
                      {site.name}
                      {site.is_active === false && (
                        <span className="ml-1 text-xs opacity-60">(inactive)</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date Range */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Date &amp; Time</label>
            <DateRangeSelector
              dateRange={dateRange}
              rangeMode={rangeMode}
              onDateRangeChange={onDateRangeChange}
              onRangeModeChange={onRangeModeChange}
            />
          </div>

          {/* Aggregation */}
          <AggregationSelector
            value={aggregationType}
            onChange={onAggregationChange}
            isAuto={isAutoAggregation}
            availableGroups={availableAggregationGroups}
          />
        </div>

        {/* Right: Data Source + Chart Type + Actions */}
        <div className="flex flex-wrap items-end gap-3">
          {/* Data source toggle (super admin only) */}
          {isSuperAdmin && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Source</label>
              <div className="flex items-center h-9 rounded-md border bg-muted/30 p-0.5">
                <Button
                  variant={dataSource === "cloud" ? "default" : "ghost"}
                  size="sm"
                  className="h-8 gap-1.5 rounded-sm px-3"
                  onClick={() => onDataSourceChange("cloud")}
                  title="Query data from Supabase cloud database"
                >
                  <Cloud className="h-3.5 w-3.5" />
                  Cloud
                </Button>
                <Button
                  variant={dataSource === "local" ? "default" : "ghost"}
                  size="sm"
                  className="h-8 gap-1.5 rounded-sm px-3"
                  onClick={() => onDataSourceChange("local")}
                  title="Query from controller's local database (1h raw max, 30 days aggregated, single site)"
                >
                  <HardDrive className="h-3.5 w-3.5" />
                  Local
                </Button>
              </div>
            </div>
          )}

          {/* Filter toggle - disabled when local data source (requires active hardware) */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={`h-9 gap-2 ${activeFilter === "all" ? "border-amber-500 text-amber-600" : ""}`}
                disabled={dataSource === "local"}
                title={dataSource === "local" ? "Local data requires active sites with hardware" : undefined}
              >
                <Filter className="h-4 w-4" />
                {activeFilter === "all" ? "All" : "Active"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56" align="end">
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Data Filter</h4>
                <p className="text-xs text-muted-foreground">
                  Choose which items to show in the dropdowns
                </p>
                <div className="space-y-2">
                  <Button
                    variant={activeFilter === "active" ? "default" : "outline"}
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => onActiveFilterChange("active")}
                  >
                    Active only
                    <span className="ml-auto text-xs opacity-70">Default</span>
                  </Button>
                  <Button
                    variant={activeFilter === "all" ? "default" : "outline"}
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => onActiveFilterChange("all")}
                  >
                    All (including inactive)
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground pt-2 border-t">
                  Applies to projects, sites, and devices
                </p>
              </div>
            </PopoverContent>
          </Popover>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-9 gap-2"
              onClick={onExportCSV}
              disabled={!canExport || isLoading}
            >
              <Download className="h-4 w-4" />
              CSV
            </Button>
            <Button
              className="h-9 gap-2 px-5"
              onClick={onPlot}
              disabled={!canPlot || isLoading}
            >
              <Play className="h-4 w-4" />
              {isLoading ? "Loading..." : "Plot"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
