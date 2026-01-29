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
import { Pencil, Save, X, Plus, ChevronLeft, Settings2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

import { IconWidget } from "@/components/dashboard/icon-widget";
import { ValueDisplayWidget } from "@/components/dashboard/value-display-widget";
import { ChartWidget } from "@/components/dashboard/chart-widget";
import { AlarmListWidget } from "@/components/dashboard/alarm-list-widget";
import { StatusIndicatorWidget } from "@/components/dashboard/status-indicator-widget";
import { TextWidget } from "@/components/dashboard/text-widget";
import { WidgetPicker } from "@/components/dashboard/widget-picker";
import { WidgetConfigDialog } from "@/components/dashboard/widget-config-dialog";

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

  // Dashboard config with defaults
  const gridColumns = dashboard?.grid_columns || 12;
  const gridRows = dashboard?.grid_rows || 8;
  const refreshInterval = (dashboard?.refresh_interval_seconds || 30) * 1000;

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
      // Batch update all widget positions
      const response = await fetch(`/api/dashboards/${siteId}/widgets/batch`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
    setIsEditMode(false);
    setSelectedWidget(null);
  };

  // Add new widget
  const addWidget = async (widgetType: string) => {
    setIsLoading(true);
    try {
      // Find first empty position
      const occupiedCells = new Set(
        widgets.flatMap((w) => {
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
          z_index: widgets.length,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to add widget");
      }

      const newWidget = await response.json();
      setWidgets([...widgets, newWidget]);
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

      setWidgets(widgets.filter((w) => w.id !== widgetId));
      setSelectedWidget(null);
    } catch (error) {
      console.error("Failed to delete widget:", error);
      alert("Failed to delete widget. Please try again.");
    }
  };

  // Update widget config
  const updateWidgetConfig = async (widgetId: string, config: Record<string, unknown>) => {
    try {
      const response = await fetch(`/api/dashboards/${siteId}/widgets/${widgetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });

      if (!response.ok) {
        throw new Error("Failed to update");
      }

      const updated = await response.json();
      setWidgets(widgets.map((w) => (w.id === widgetId ? updated : w)));
      setShowConfigDialog(false);
      setSelectedWidget(null);
    } catch (error) {
      console.error("Failed to update widget:", error);
      alert("Failed to update widget. Please try again.");
    }
  };

  // Drag handlers for repositioning
  const handleDragStart = (e: React.DragEvent, widget: Widget) => {
    e.dataTransfer.setData("widgetId", widget.id);
    setSelectedWidget(widget);
  };

  const handleDrop = (e: React.DragEvent, targetRow: number, targetCol: number) => {
    e.preventDefault();
    const widgetId = e.dataTransfer.getData("widgetId");
    if (!widgetId) return;

    setWidgets(
      widgets.map((w) =>
        w.id === widgetId
          ? { ...w, grid_row: targetRow, grid_col: targetCol }
          : w
      )
    );
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Resize handlers
  const CELL_HEIGHT = 80;
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
        return <ChartWidget {...commonProps} siteId={siteId} />;
      case "alarm_list":
        return <AlarmListWidget {...commonProps} siteId={siteId} />;
      case "status_indicator":
        return <StatusIndicatorWidget {...commonProps} />;
      case "text":
        return <TextWidget {...commonProps} />;
      default:
        return (
          <div className="p-4 text-center text-muted-foreground">
            Unknown widget type: {widget.widget_type}
          </div>
        );
    }
  };

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
                // Taller rows in view mode (no sidebar = wider grid, so scale height too)
                gridTemplateRows: `repeat(${gridRows}, ${isEditMode ? 80 : 100}px)`,
                gap: "8px",
                minHeight: `${gridRows * (isEditMode ? 80 : 100) + (gridRows - 1) * 8 + 16}px`,
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
                      onDrop={(e) => handleDrop(e, row, col)}
                      onDragOver={handleDragOver}
                    />
                  );
                })}

              {/* Widgets */}
              {widgets.map((widget) => (
                <div
                  key={widget.id}
                  className={cn(
                    "relative bg-card rounded-lg border shadow-sm overflow-hidden",
                    isEditMode && "cursor-move",
                    isEditMode && selectedWidget?.id === widget.id && "ring-2 ring-primary"
                  )}
                  style={{
                    gridRow: `${widget.grid_row} / span ${widget.grid_height}`,
                    gridColumn: `${widget.grid_col} / span ${widget.grid_width}`,
                    zIndex: widget.z_index,
                  }}
                  draggable={isEditMode && !resizingWidget}
                  onDragStart={(e) => handleDragStart(e, widget)}
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
          onSave={(config) => updateWidgetConfig(selectedWidget.id, config)}
          onClose={() => {
            setShowConfigDialog(false);
            setSelectedWidget(null);
          }}
        />
      )}
    </div>
  );
}
