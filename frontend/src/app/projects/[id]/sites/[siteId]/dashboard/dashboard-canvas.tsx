"use client";

/**
 * Dashboard Canvas Component
 *
 * Main interactive component for the site dashboard:
 * - Renders widgets in a grid layout
 * - Handles edit mode (drag-and-drop, resize)
 * - Polls for live data at configurable intervals
 * - Widget picker sidebar in edit mode
 */

import { useState, useEffect, useCallback, useRef, MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pencil, Save, X, Plus, ChevronLeft, Settings2, Trash2, Grid3X3 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { IconWidget } from "@/components/dashboard/icon-widget";
import { ValueDisplayWidget } from "@/components/dashboard/value-display-widget";
import { ChartWidget } from "@/components/dashboard/chart-widget";
import { AlarmListWidget } from "@/components/dashboard/alarm-list-widget";
import { StatusIndicatorWidget } from "@/components/dashboard/status-indicator-widget";
import { TextWidget } from "@/components/dashboard/text-widget";
import { GaugeWidget } from "@/components/dashboard/gauge-widget";
import { CableWidget, CableConfig } from "@/components/dashboard/cable-widget";
import { ShapeWidget } from "@/components/dashboard/shape-widget";
import { WidgetPicker } from "@/components/dashboard/widget-picker";
import { WidgetConfigDialog } from "@/components/dashboard/widget-config-dialog";

// Grid density configuration
type GridDensity = "coarse" | "medium" | "fine";

const GRID_DENSITY_CONFIG: Record<GridDensity, { columns: number; rows: number; cellHeight: number; label: string }> = {
  coarse: { columns: 6, rows: 4, cellHeight: 150, label: "Coarse (6×4)" },
  medium: { columns: 12, rows: 8, cellHeight: 100, label: "Medium (12×8)" },
  fine: { columns: 24, rows: 16, cellHeight: 50, label: "Fine (24×16)" },
};

// Get density from grid dimensions
function getDensityFromDimensions(cols: number, rows: number): GridDensity {
  if (cols <= 6 && rows <= 4) return "coarse";
  if (cols <= 12 && rows <= 8) return "medium";
  return "fine";
}

// Scale widgets when changing density
function scaleWidgetsForDensity(
  widgets: Widget[],
  fromDensity: GridDensity,
  toDensity: GridDensity
): Widget[] {
  const fromConfig = GRID_DENSITY_CONFIG[fromDensity];
  const toConfig = GRID_DENSITY_CONFIG[toDensity];

  const colScale = toConfig.columns / fromConfig.columns;
  const rowScale = toConfig.rows / fromConfig.rows;

  return widgets.map(w => ({
    ...w,
    grid_col: Math.max(1, Math.min(Math.round((w.grid_col - 1) * colScale) + 1, toConfig.columns)),
    grid_row: Math.max(1, Math.min(Math.round((w.grid_row - 1) * rowScale) + 1, toConfig.rows)),
    grid_width: Math.max(1, Math.min(Math.round(w.grid_width * colScale), toConfig.columns)),
    grid_height: Math.max(1, Math.min(Math.round(w.grid_height * rowScale), toConfig.rows)),
  }));
}

// Types
interface Dashboard {
  id: string;
  site_id: string;
  name: string;
  grid_columns: number;
  grid_rows: number;
  refresh_interval_seconds: number;
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
    logging_registers?: Array<{
      name: string;
      address: number;
      unit?: string;
      access: string;
      group?: string;
    }>;
    visualization_registers?: Array<{
      name: string;
      address: number;
      unit?: string;
      access: string;
      group?: string;
    }>;
  } | null;
}

interface LiveData {
  timestamp: string;
  registers: Record<string, Record<string, { value: number | null; unit: string | null; timestamp: string | null }>>;
  device_status: Record<string, { is_online: boolean; last_seen: string | null }>;
}

interface DashboardCanvasProps {
  siteId: string;
  siteName: string;
  projectId: string;
  projectName: string;
  dashboard: Dashboard | null;
  initialWidgets: Widget[];
  devices: Device[];
  canEdit: boolean;
}

export function DashboardCanvas({
  siteId,
  siteName,
  projectId,
  projectName,
  dashboard,
  initialWidgets,
  devices,
  canEdit,
}: DashboardCanvasProps) {
  // State
  const [isEditMode, setIsEditMode] = useState(false);
  const [widgets, setWidgets] = useState<Widget[]>(initialWidgets);
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedWidget, setSelectedWidget] = useState<Widget | null>(null);
  const [showWidgetPicker, setShowWidgetPicker] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Resize state
  const [resizingWidget, setResizingWidget] = useState<string | null>(null);
  const [resizeStart, setResizeStart] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Cable dragging state for endpoint repositioning
  const [draggingCableEndpoint, setDraggingCableEndpoint] = useState<{
    widgetId: string;
    endpoint: "start" | "end";
  } | null>(null);

  // Cable dragging state for moving entire cable
  const [draggingFullCable, setDraggingFullCable] = useState<{
    widgetId: string;
    initialMouseX: number;
    initialMouseY: number;
    initialConfig: CableConfig;
  } | null>(null);

  // Track grid mount for proper cable dimension calculation
  const [gridMounted, setGridMounted] = useState(false);

  // Grid density state - derive initial from saved dashboard dimensions
  const initialDensity = getDensityFromDimensions(
    dashboard?.grid_columns || 12,
    dashboard?.grid_rows || 8
  );
  const [gridDensity, setGridDensity] = useState<GridDensity>(initialDensity);

  // Dashboard config - computed from density
  const densityConfig = GRID_DENSITY_CONFIG[gridDensity];
  const gridColumns = densityConfig.columns;
  const gridRows = densityConfig.rows;
  const refreshInterval = (dashboard?.refresh_interval_seconds || 30) * 1000;

  // Handle density change with widget scaling
  const handleDensityChange = useCallback((newDensity: GridDensity) => {
    if (newDensity === gridDensity) return;
    const scaledWidgets = scaleWidgetsForDensity(widgets, gridDensity, newDensity);
    setWidgets(scaledWidgets);
    setGridDensity(newDensity);
  }, [gridDensity, widgets]);

  // Fetch live data
  const fetchLiveData = useCallback(async () => {
    try {
      const response = await fetch(`/api/dashboards/${siteId}/live-data`);
      if (response.ok) {
        const data = await response.json();
        setLiveData(data);
      }
    } catch {
      // Silently fail - dashboard will show stale data
    }
  }, [siteId]);

  // Initial fetch and polling with Page Visibility API
  useEffect(() => {
    // Only poll in view mode
    if (isEditMode) return;

    fetchLiveData();

    // Start polling interval
    intervalRef.current = setInterval(fetchLiveData, refreshInterval);

    // Handle tab visibility changes - pause polling when hidden
    const handleVisibility = () => {
      if (document.hidden) {
        // Tab hidden - clear interval to save bandwidth
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        // Tab visible - refetch and restart polling
        fetchLiveData();
        intervalRef.current = setInterval(fetchLiveData, refreshInterval);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchLiveData, refreshInterval, isEditMode]);

  // Save widget changes
  const saveWidgets = async () => {
    setIsSaving(true);
    try {
      // Batch update all widget positions and dashboard grid config
      const response = await fetch(`/api/dashboards/${siteId}/widgets/batch`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grid_columns: gridColumns,
          grid_rows: gridRows,
          widgets: widgets.map((w) => ({
            id: w.id,
            grid_row: w.grid_row,
            grid_col: w.grid_col,
            grid_width: w.grid_width,
            grid_height: w.grid_height,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save");
      }

      setIsEditMode(false);
    } catch (error) {
      console.error("Failed to save widgets:", error);
      alert("Failed to save dashboard. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  // Cancel edit mode
  const cancelEdit = () => {
    setWidgets(initialWidgets); // Reset to original
    setGridDensity(initialDensity); // Reset grid density
    setIsEditMode(false);
    setSelectedWidget(null);
  };

  // Add new widget
  const addWidget = async (widgetType: string) => {
    // Cable widget - create immediately at center with default endpoints
    if (widgetType === "cable") {
      createCableWidget();
      return;
    }

    setIsLoading(true);
    try {
      // Find first empty position
      const occupiedCells = new Set(
        widgets.filter(w => w.widget_type !== "cable").flatMap((w) => {
          const cells = [];
          for (let r = w.grid_row; r < w.grid_row + w.grid_height; r++) {
            for (let c = w.grid_col; c < w.grid_col + w.grid_width; c++) {
              cells.push(`${r}-${c}`);
            }
          }
          return cells;
        })
      );

      let newRow = 1;
      let newCol = 1;
      outer: for (let r = 1; r <= gridRows; r++) {
        for (let c = 1; c <= gridColumns; c++) {
          if (!occupiedCells.has(`${r}-${c}`)) {
            newRow = r;
            newCol = c;
            break outer;
          }
        }
      }

      // Default sizes by widget type
      const defaultSizes: Record<string, { width: number; height: number }> = {
        icon: { width: 2, height: 2 },
        value_display: { width: 2, height: 1 },
        chart: { width: 6, height: 3 },
        alarm_list: { width: 4, height: 3 },
        status_indicator: { width: 2, height: 1 },
        text: { width: 3, height: 1 },
        gauge: { width: 2, height: 3 },
        shape: { width: 3, height: 2 },
      };

      const size = defaultSizes[widgetType] || { width: 2, height: 2 };

      const response = await fetch(`/api/dashboards/${siteId}/widgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          widget_type: widgetType,
          grid_row: newRow,
          grid_col: newCol,
          grid_width: size.width,
          grid_height: size.height,
          config: {},
          z_index: widgetType === "shape" ? 0 : widgets.length,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to add widget");
      }

      const newWidget = await response.json();
      setWidgets(prev => [...prev, newWidget]);
      setShowWidgetPicker(false);

      // Open config dialog for new widget
      setSelectedWidget(newWidget);
      setShowConfigDialog(true);
    } catch (error) {
      console.error("Failed to add widget:", error);
      alert("Failed to add widget. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Create cable widget at top in an empty area
  const createCableWidget = async () => {
    setIsLoading(true);
    try {
      // Find first row with no widgets to place cable
      const occupiedRows = new Set(
        widgets.filter(w => w.widget_type !== "cable")
          .flatMap(w => Array.from({ length: w.grid_height }, (_, i) => w.grid_row + i))
      );
      let emptyRow = 1;
      for (let r = 1; r <= gridRows; r++) {
        if (!occupiedRows.has(r)) { emptyRow = r; break; }
      }
      // Convert grid row to cable Y coordinate (0 to gridRows scale)
      const cableY = (emptyRow - 0.5);

      // Default cable: horizontal line at top empty row
      const defaultConfig: CableConfig = {
        startX: 1,
        startY: cableY,
        endX: gridColumns - 1,
        endY: cableY,
        pathStyle: "straight",
        color: "#6b7280",
        thickness: 3,
        animated: false,
        animationSpeed: "medium",
      };

      const response = await fetch(`/api/dashboards/${siteId}/widgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          widget_type: "cable",
          grid_row: 1,
          grid_col: 1,
          grid_width: 1,
          grid_height: 1,
          config: defaultConfig,
          z_index: -1, // Cables render behind other widgets
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to add cable");
      }

      const newWidget = await response.json();
      setWidgets(prev => [...prev, newWidget]);

      // Open config dialog for new cable
      setSelectedWidget(newWidget);
      setShowConfigDialog(true);
    } catch (error) {
      console.error("Failed to add cable:", error);
      alert("Failed to add cable. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Delete widget
  const deleteWidget = async (widgetId: string) => {
    if (!confirm("Delete this widget?")) return;

    try {
      const response = await fetch(`/api/dashboards/${siteId}/widgets/${widgetId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete");
      }

      setWidgets(prev => prev.filter((w) => w.id !== widgetId));
      setSelectedWidget(null);
    } catch (error) {
      console.error("Failed to delete widget:", error);
      alert("Failed to delete widget. Please try again.");
    }
  };

  // Update widget config (preserve current position/size so DB stays in sync)
  const updateWidgetConfig = async (widgetId: string, config: Record<string, unknown>) => {
    try {
      const currentWidget = widgets.find(w => w.id === widgetId);
      if (!currentWidget) return;

      const response = await fetch(`/api/dashboards/${siteId}/widgets/${widgetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          z_index: currentWidget.z_index,
          grid_row: currentWidget.grid_row,
          grid_col: currentWidget.grid_col,
          grid_width: currentWidget.grid_width,
          grid_height: currentWidget.grid_height,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update");
      }

      const updated = await response.json();
      setWidgets(prev => prev.map((w) => (w.id === widgetId ? updated : w)));
      setShowConfigDialog(false);
      setSelectedWidget(null);
    } catch (error) {
      console.error("Failed to update widget:", error);
      alert("Failed to update widget. Please try again.");
    }
  };

  const handleLayerChange = async (widgetId: string, zIndex: number) => {
    try {
      const currentWidget = widgets.find(w => w.id === widgetId);
      if (!currentWidget) return;

      const response = await fetch(`/api/dashboards/${siteId}/widgets/${widgetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: currentWidget.config,
          z_index: zIndex,
          grid_row: currentWidget.grid_row,
          grid_col: currentWidget.grid_col,
          grid_width: currentWidget.grid_width,
          grid_height: currentWidget.grid_height,
        }),
      });

      if (!response.ok) throw new Error("Failed to update layer");
      const updated = await response.json();
      setWidgets(prev => prev.map((w) => (w.id === widgetId ? updated : w)));
      setSelectedWidget(updated);
    } catch (error) {
      console.error("Failed to update layer:", error);
    }
  };

  // Drag state for visual feedback
  const [draggingWidgetId, setDraggingWidgetId] = useState<string | null>(null);

  // Drag handlers for repositioning
  const handleDragStart = (e: React.DragEvent, widget: Widget) => {
    e.dataTransfer.setData("widgetId", widget.id);
    e.dataTransfer.effectAllowed = "move";
    setSelectedWidget(widget);
    setDraggingWidgetId(widget.id);
  };

  const handleDragEnd = () => {
    setDraggingWidgetId(null);
  };

  const handleDrop = (e: React.DragEvent, targetRow: number, targetCol: number) => {
    e.preventDefault();
    const widgetId = e.dataTransfer.getData("widgetId");
    if (!widgetId) return;

    setWidgets(prev =>
      prev.map((w) =>
        w.id === widgetId
          ? { ...w, grid_row: targetRow, grid_col: targetCol }
          : w
      )
    );
    setDraggingWidgetId(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  // Resize handlers - use density-based cell height
  const CELL_HEIGHT = isEditMode ? Math.round(densityConfig.cellHeight * 0.8) : densityConfig.cellHeight;
  const GAP = 8;

  const handleResizeStart = (e: ReactMouseEvent, widget: Widget) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingWidget(widget.id);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: widget.grid_width,
      height: widget.grid_height,
    });
  };

  const handleResizeMove = useCallback((e: globalThis.MouseEvent) => {
    if (!resizingWidget || !resizeStart) return;

    const deltaX = e.clientX - resizeStart.x;
    const deltaY = e.clientY - resizeStart.y;

    // Calculate cell width from grid (account for padding)
    const gridWidth = gridRef.current?.clientWidth || 800;
    const cellWidth = (gridWidth - 16 - (gridColumns - 1) * GAP) / gridColumns;

    // Convert pixel delta to grid units
    const widthDelta = Math.round(deltaX / (cellWidth + GAP));
    const heightDelta = Math.round(deltaY / (CELL_HEIGHT + GAP));

    // Minimum sizes by widget type (chart needs minimum 3x2 for proper display)
    const minSizes: Record<string, { width: number; height: number }> = {
      chart: { width: 3, height: 2 },
    };

    setWidgets((prev) =>
      prev.map((w) => {
        if (w.id !== resizingWidget) return w;

        const minSize = minSizes[w.widget_type] || { width: 1, height: 1 };
        const newWidth = Math.max(minSize.width, Math.min(resizeStart.width + widthDelta, gridColumns));
        const newHeight = Math.max(minSize.height, Math.min(resizeStart.height + heightDelta, gridRows));

        return {
          ...w,
          grid_width: Math.min(newWidth, gridColumns - w.grid_col + 1),
          grid_height: Math.min(newHeight, gridRows - w.grid_row + 1),
        };
      })
    );
  }, [resizingWidget, resizeStart, gridColumns, gridRows]);

  const handleResizeEnd = useCallback(() => {
    setResizingWidget(null);
    setResizeStart(null);
  }, []);

  // Cable endpoint drag handler - moves endpoint in real-time
  const handleCableDragMove = useCallback((e: globalThis.MouseEvent) => {
    if (!gridRef.current) return;

    const rect = gridRef.current.getBoundingClientRect();
    const containerWidth = gridRef.current.clientWidth - 16;
    const containerHeight = gridRef.current.clientHeight - 16;

    // Handle endpoint dragging
    if (draggingCableEndpoint) {
      const x = e.clientX - rect.left - 8;
      const y = e.clientY - rect.top - 8;
      const gridX = Math.max(0, Math.min(gridColumns, (x / containerWidth) * gridColumns));
      const gridY = Math.max(0, Math.min(gridRows, (y / containerHeight) * gridRows));

      setWidgets(prev => prev.map(w => {
        if (w.id !== draggingCableEndpoint.widgetId) return w;
        const config = w.config as unknown as CableConfig;
        const newConfig = draggingCableEndpoint.endpoint === "start"
          ? { ...config, startX: gridX, startY: gridY }
          : { ...config, endX: gridX, endY: gridY };
        return { ...w, config: newConfig as Record<string, unknown> };
      }));
    }

    // Handle full cable dragging (move both endpoints together)
    if (draggingFullCable) {
      const deltaX = e.clientX - draggingFullCable.initialMouseX;
      const deltaY = e.clientY - draggingFullCable.initialMouseY;
      const deltaGridX = (deltaX / containerWidth) * gridColumns;
      const deltaGridY = (deltaY / containerHeight) * gridRows;

      const { initialConfig } = draggingFullCable;
      const newStartX = Math.max(0, Math.min(gridColumns, initialConfig.startX + deltaGridX));
      const newStartY = Math.max(0, Math.min(gridRows, initialConfig.startY + deltaGridY));
      const newEndX = Math.max(0, Math.min(gridColumns, initialConfig.endX + deltaGridX));
      const newEndY = Math.max(0, Math.min(gridRows, initialConfig.endY + deltaGridY));

      setWidgets(prev => prev.map(w => {
        if (w.id !== draggingFullCable.widgetId) return w;
        const config = w.config as unknown as CableConfig;
        return {
          ...w,
          config: { ...config, startX: newStartX, startY: newStartY, endX: newEndX, endY: newEndY } as Record<string, unknown>
        };
      }));
    }
  }, [draggingCableEndpoint, draggingFullCable, gridColumns, gridRows]);

  // Cable drag end - save to server (fire and forget for instant response)
  const handleCableDragEnd = useCallback(() => {
    const widgetId = draggingCableEndpoint?.widgetId || draggingFullCable?.widgetId;
    if (!widgetId) return;

    // Clear state immediately for instant UI response
    setDraggingCableEndpoint(null);
    setDraggingFullCable(null);

    // Find the widget and save to server (fire and forget)
    const widget = widgets.find(w => w.id === widgetId);
    if (widget) {
      fetch(`/api/dashboards/${siteId}/widgets/${widget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: widget.config }),
      }).catch(err => console.error("Failed to save cable position:", err));
    }
  }, [draggingCableEndpoint, draggingFullCable, widgets, siteId]);

  // Global mouse listeners for cable dragging
  useEffect(() => {
    if (draggingCableEndpoint || draggingFullCable) {
      window.addEventListener("mousemove", handleCableDragMove);
      window.addEventListener("mouseup", handleCableDragEnd);
      return () => {
        window.removeEventListener("mousemove", handleCableDragMove);
        window.removeEventListener("mouseup", handleCableDragEnd);
      };
    }
  }, [draggingCableEndpoint, draggingFullCable, handleCableDragMove, handleCableDragEnd]);

  // Track when grid is mounted for cable dimensions
  useEffect(() => {
    // Use requestAnimationFrame to ensure grid has been painted
    const frame = requestAnimationFrame(() => {
      if (gridRef.current && gridRef.current.clientWidth > 0) {
        setGridMounted(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [widgets]); // Re-check when widgets change (e.g., cable added)

  // Global mouse listeners for resize
  useEffect(() => {
    if (resizingWidget) {
      window.addEventListener("mousemove", handleResizeMove);
      window.addEventListener("mouseup", handleResizeEnd);
      return () => {
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeEnd);
      };
    }
  }, [resizingWidget, handleResizeMove, handleResizeEnd]);

  // Render widget based on type
  const renderWidget = (widget: Widget) => {
    const commonProps = {
      widget,
      liveData,
      isEditMode,
      onSelect: () => {
        setSelectedWidget(widget);
        setShowConfigDialog(true);
      },
    };

    switch (widget.widget_type) {
      case "icon":
        return <IconWidget {...commonProps} />;
      case "value_display":
        return <ValueDisplayWidget {...commonProps} />;
      case "chart":
        return <ChartWidget {...commonProps} siteId={siteId} cellHeight={CELL_HEIGHT} />;
      case "alarm_list":
        return <AlarmListWidget {...commonProps} siteId={siteId} />;
      case "status_indicator":
        return <StatusIndicatorWidget {...commonProps} />;
      case "text":
        return <TextWidget {...commonProps} />;
      case "gauge":
        return <GaugeWidget {...commonProps} />;
      case "shape":
        return <ShapeWidget {...commonProps} />;
      case "cable":
        return null; // Cables render in SVG overlay
      default:
        return (
          <div className="p-4 text-center text-muted-foreground">
            Unknown widget type: {widget.widget_type}
          </div>
        );
    }
  };

  // Get cable widgets and their live values
  const cableWidgets = widgets.filter(w => w.widget_type === "cable");
  const regularWidgets = widgets.filter(w => w.widget_type !== "cable");

  // Get live value for a cable's animation source
  const getCableLiveValue = useCallback((config: CableConfig): number | null => {
    if (!config.animationSource || !liveData) return null;
    const { deviceId, registerName } = config.animationSource;
    const registerData = liveData.registers[deviceId]?.[registerName];
    return registerData?.value ?? null;
  }, [liveData]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Back button */}
            <Link
              href={`/projects/${projectId}/sites/${siteId}`}
              className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
            {isEditMode && (
              <Badge variant="secondary" className="text-xs">
                Edit Mode
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm md:text-base">
            {siteName} &middot; {projectName}
            {liveData && !isEditMode && (
              <span className="ml-4 text-xs">
                Last updated: {new Date(liveData.timestamp).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {isEditMode ? (
            <>
              {/* Grid Density Selector */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="min-h-[44px]">
                    <Grid3X3 className="h-4 w-4 mr-2" />
                    {densityConfig.label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(Object.keys(GRID_DENSITY_CONFIG) as GridDensity[]).map((density) => (
                    <DropdownMenuItem
                      key={density}
                      onClick={() => handleDensityChange(density)}
                      className={cn(
                        "cursor-pointer",
                        density === gridDensity && "bg-accent"
                      )}
                    >
                      {GRID_DENSITY_CONFIG[density].label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                onClick={cancelEdit}
                className="min-h-[44px]"
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button
                onClick={saveWidgets}
                disabled={isSaving}
                className="min-h-[44px]"
              >
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            canEdit && (
              <Button
                variant="outline"
                onClick={() => setIsEditMode(true)}
                className="min-h-[44px]"
              >
                <Pencil className="h-4 w-4 mr-2" />
                Edit Dashboard
              </Button>
            )
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex gap-4">
        {/* Dashboard grid */}
        <div className="flex-1">
          {widgets.length === 0 && !isEditMode ? (
            // Empty state
            <Card className="border-dashed">
              <CardContent className="py-16 text-center">
                <p className="text-muted-foreground mb-4">
                  No widgets configured yet.
                </p>
                {canEdit && (
                  <Button onClick={() => setIsEditMode(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Widgets
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            // Grid canvas
            <div
              ref={gridRef}
              className={cn(
                "relative border rounded-lg bg-muted/30 p-2",
                isEditMode && "border-dashed border-primary/50"
              )}
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${gridColumns}, 1fr)`,
                gridTemplateRows: `repeat(${gridRows}, ${CELL_HEIGHT}px)`,
                gap: `${GAP}px`,
                minHeight: `${gridRows * CELL_HEIGHT + (gridRows - 1) * GAP + 16}px`,
              }}
              onClick={(e) => {
                // Deselect cable when clicking on empty grid space
                if (isEditMode && e.target === e.currentTarget) {
                  setSelectedWidget(null);
                }
              }}
            >
              {/* Grid cells (visible in edit mode) */}
              {isEditMode &&
                Array.from({ length: gridRows * gridColumns }).map((_, i) => {
                  const row = Math.floor(i / gridColumns) + 1;
                  const col = (i % gridColumns) + 1;
                  return (
                    <div
                      key={`cell-${row}-${col}`}
                      className="border border-dashed border-muted-foreground/20 rounded"
                      style={{
                        gridRow: row,
                        gridColumn: col,
                      }}
                      onClick={() => {
                        // Deselect any widget when clicking on empty cell
                        if (selectedWidget) {
                          setSelectedWidget(null);
                        }
                      }}
                      onDrop={(e) => handleDrop(e, row, col)}
                      onDragOver={handleDragOver}
                    />
                  );
                })}

              {/* SVG overlay for cables - positioned absolute over the grid */}
              {cableWidgets.length > 0 && gridMounted && (
                <svg
                  className="absolute inset-2"
                  viewBox={`0 0 ${gridColumns * 100} ${gridRows * 100}`}
                  preserveAspectRatio="none"
                  style={{
                    zIndex: 0,
                    width: "calc(100% - 16px)",
                    height: "calc(100% - 16px)",
                    pointerEvents: 'none',
                    overflow: 'hidden',
                  }}
                >
                  {/* Render existing cables */}
                  {cableWidgets.map((widget) => {
                    const config = widget.config as unknown as CableConfig;
                    // Use viewBox dimensions (gridColumns * 100 by gridRows * 100)
                    const containerWidth = gridColumns * 100;
                    const containerHeight = gridRows * 100;
                    return (
                      <CableWidget
                        key={widget.id}
                        config={config}
                        gridColumns={gridColumns}
                        gridRows={gridRows}
                        containerWidth={containerWidth}
                        containerHeight={containerHeight}
                        liveValue={getCableLiveValue(config)}
                        isEditMode={isEditMode}
                        isSelected={selectedWidget?.id === widget.id}
                        onClick={() => setSelectedWidget(widget)}
                        onStartDrag={() => {
                          setSelectedWidget(widget);
                          setDraggingCableEndpoint({ widgetId: widget.id, endpoint: "start" });
                        }}
                        onEndDrag={() => {
                          setSelectedWidget(widget);
                          setDraggingCableEndpoint({ widgetId: widget.id, endpoint: "end" });
                        }}
                        onCableDrag={(e) => {
                          setSelectedWidget(widget);
                          setDraggingFullCable({
                            widgetId: widget.id,
                            initialMouseX: e.clientX,
                            initialMouseY: e.clientY,
                            initialConfig: config,
                          });
                        }}
                      />
                    );
                  })}
                </svg>
              )}

              {/* Cable toolbar - positioned near selected cable */}
              {isEditMode && selectedWidget?.widget_type === "cable" && gridRef.current && (
                <div
                  className="absolute z-50 flex gap-1 bg-background/95 rounded-lg shadow-lg border p-1"
                  style={{
                    // Position at center of selected cable
                    left: (() => {
                      const config = selectedWidget.config as unknown as CableConfig;
                      const containerWidth = gridRef.current!.clientWidth - 16;
                      const midX = ((config.startX + config.endX) / 2) * (containerWidth / gridColumns);
                      return Math.max(8, Math.min(midX - 40, containerWidth - 88)) + 8;
                    })(),
                    top: (() => {
                      const config = selectedWidget.config as unknown as CableConfig;
                      const containerHeight = gridRef.current!.clientHeight - 16;
                      const midY = ((config.startY + config.endY) / 2) * (containerHeight / gridRows);
                      return Math.max(8, midY - 40) + 8;
                    })(),
                  }}
                >
                  {/* Thickness buttons */}
                  {[
                    { size: 2, label: "Thin" },
                    { size: 5, label: "Medium" },
                    { size: 10, label: "Thick" },
                  ].map(({ size, label }) => {
                    // Get current config from widgets array (not stale selectedWidget)
                    const currentWidget = widgets.find(w => w.id === selectedWidget.id);
                    const config = (currentWidget?.config || selectedWidget.config) as unknown as CableConfig;
                    const isActive = config.thickness === size;
                    return (
                      <button
                        key={size}
                        onClick={() => updateWidgetConfig(selectedWidget.id, { ...config, thickness: size })}
                        className={cn(
                          "p-2 rounded",
                          isActive ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                        )}
                        title={label}
                      >
                        <div
                          className="w-4 rounded-full bg-current"
                          style={{ height: size }}
                        />
                      </button>
                    );
                  })}

                  {/* Separator */}
                  <div className="w-px bg-border mx-1" />

                  <button
                    onClick={() => setShowConfigDialog(true)}
                    className="p-2 rounded hover:bg-accent"
                    title="Edit cable"
                  >
                    <Settings2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => deleteWidget(selectedWidget.id)}
                    className="p-2 rounded hover:bg-destructive hover:text-destructive-foreground"
                    title="Delete cable"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Regular widgets */}
              {regularWidgets.map((widget) => (
                <div
                  key={widget.id}
                  className={cn(
                    "relative overflow-hidden",
                    widget.widget_type !== "shape" && "bg-card rounded-lg border shadow-sm",
                    widget.widget_type === "shape" && isEditMode && "border border-dashed border-muted-foreground/30 rounded-lg",
                    isEditMode && "cursor-grab active:cursor-grabbing",
                    isEditMode && selectedWidget?.id === widget.id && "ring-2 ring-primary"
                  )}
                  style={{
                    gridRow: `${widget.grid_row} / span ${widget.grid_height}`,
                    gridColumn: `${widget.grid_col} / span ${widget.grid_width}`,
                    zIndex: widget.z_index,
                    opacity: draggingWidgetId === widget.id ? 0.5 : 1,
                    pointerEvents: draggingWidgetId && draggingWidgetId !== widget.id ? "none" : undefined,
                    transition: "opacity 0.15s ease",
                  }}
                  draggable={isEditMode && !resizingWidget}
                  onDragStart={(e) => handleDragStart(e, widget)}
                  onDragEnd={handleDragEnd}
                >
                  {renderWidget(widget)}

                  {/* Edit overlay */}
                  {isEditMode && (
                    <>
                      <div className="absolute top-1 right-1 flex gap-1">
                        <button
                          onClick={() => {
                            setSelectedWidget(widget);
                            setShowConfigDialog(true);
                          }}
                          className="p-1.5 bg-background/80 rounded hover:bg-background"
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => deleteWidget(widget.id)}
                          className="p-1.5 bg-background/80 rounded hover:bg-destructive hover:text-destructive-foreground"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {/* Resize handle */}
                      <div
                        className={cn(
                          "absolute bottom-0 right-0 w-4 h-4 cursor-se-resize",
                          "hover:bg-primary/20 transition-colors",
                          resizingWidget === widget.id && "bg-primary/30"
                        )}
                        onMouseDown={(e) => handleResizeStart(e, widget)}
                      >
                        <svg
                          className="w-4 h-4 text-muted-foreground"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                        >
                          <path d="M14 10v4h-4l4-4zm-4 0v4H6l4-4zm-4 0v4H2l4-4z" opacity="0.5" />
                        </svg>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Widget picker sidebar (edit mode only) */}
        {isEditMode && (
          <div className="w-64 shrink-0">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Add Widget</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <WidgetPicker
                  onSelect={addWidget}
                  disabled={isLoading || widgets.length >= 30}
                />
                {widgets.length >= 30 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Maximum 30 widgets reached
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>


      {/* Widget configuration dialog */}
      {showConfigDialog && selectedWidget && (
        <WidgetConfigDialog
          widget={selectedWidget}
          devices={devices}
          widgets={widgets}
          onSave={(config) => updateWidgetConfig(selectedWidget.id, config)}
          onLayerChange={handleLayerChange}
          onClose={() => {
            setShowConfigDialog(false);
            setSelectedWidget(null);
          }}
        />
      )}
    </div>
  );
}
