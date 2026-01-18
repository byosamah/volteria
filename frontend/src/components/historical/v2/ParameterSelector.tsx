"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { GripVertical } from "lucide-react";
import { AvailableParametersList } from "./AvailableParametersList";
import { AxisDropZone } from "./AxisDropZone";
import { MAX_PARAMETERS, getNextColor } from "./constants";
import type { AxisParameter, AvailableRegister, Device, ChartType, DataSource } from "./types";

interface ParameterSelectorProps {
  devices: Device[];
  selectedDeviceId: string;
  onDeviceChange: (deviceId: string) => void;
  availableRegisters: AvailableRegister[];
  leftAxisParams: AxisParameter[];
  rightAxisParams: AxisParameter[];
  onLeftAxisChange: (params: AxisParameter[]) => void;
  onRightAxisChange: (params: AxisParameter[]) => void;
  defaultChartType: ChartType;
  hasSiteSelected: boolean;
  dataSource: DataSource;
  currentSiteId: string;
  localLockedSiteId: string | null;
}

export function ParameterSelector({
  devices,
  selectedDeviceId,
  onDeviceChange,
  availableRegisters,
  leftAxisParams,
  rightAxisParams,
  onLeftAxisChange,
  onRightAxisChange,
  defaultChartType,
  hasSiteSelected,
  dataSource,
  currentSiteId,
  localLockedSiteId,
}: ParameterSelectorProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draggedRegister, setDraggedRegister] = useState<AvailableRegister | null>(null);

  // Calculate total parameters and remaining
  const totalParams = leftAxisParams.length + rightAxisParams.length;
  const canAddMore = totalParams < MAX_PARAMETERS;

  // Sensors for drag detection
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Create a new AxisParameter from a register
  const createAxisParameter = useCallback(
    (register: AvailableRegister): AxisParameter => {
      const usedColors = [...leftAxisParams, ...rightAxisParams].map((p) => p.color);
      return {
        id: `param-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        registerId: register.id,
        registerName: register.name,
        deviceId: register.deviceId,
        deviceName: register.deviceName,
        siteId: register.siteId,
        siteName: register.siteName,
        unit: register.unit,
        color: getNextColor(usedColors),
        chartType: (register.preferred_chart_type as ChartType) || defaultChartType,
      };
    },
    [leftAxisParams, rightAxisParams, defaultChartType]
  );

  // Add parameter via button click
  const handleAddToAxis = useCallback(
    (register: AvailableRegister, axis: "left" | "right") => {
      if (!canAddMore) return;

      const newParam = createAxisParameter(register);
      if (axis === "left") {
        onLeftAxisChange([...leftAxisParams, newParam]);
      } else {
        onRightAxisChange([...rightAxisParams, newParam]);
      }
    },
    [canAddMore, createAxisParameter, leftAxisParams, rightAxisParams, onLeftAxisChange, onRightAxisChange]
  );

  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id as string);

    // Check if dragging from available list
    if (active.data.current?.register) {
      setDraggedRegister(active.data.current.register as AvailableRegister);
    }
  }, []);

  // Handle drag over (for visual feedback)
  const handleDragOver = useCallback((event: DragOverEvent) => {
    // Could add visual feedback here
  }, []);

  // Handle drag end
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      setActiveId(null);
      setDraggedRegister(null);

      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      // Check if dragging from available list to axis
      if (activeId.startsWith("available-") && active.data.current?.register) {
        const register = active.data.current.register as AvailableRegister;

        if (overId === "left-axis" || overId.startsWith("param-")) {
          // Determine target axis based on overId
          const targetAxis = overId === "left-axis" ? "left" :
            leftAxisParams.some(p => p.id === overId) ? "left" : "right";

          if (targetAxis === "left" && canAddMore) {
            const newParam = createAxisParameter(register);
            onLeftAxisChange([...leftAxisParams, newParam]);
          }
        } else if (overId === "right-axis") {
          if (canAddMore) {
            const newParam = createAxisParameter(register);
            onRightAxisChange([...rightAxisParams, newParam]);
          }
        }
        return;
      }

      // Handle reordering within the same axis or moving between axes
      const isActiveInLeft = leftAxisParams.some((p) => p.id === activeId);
      const isActiveInRight = rightAxisParams.some((p) => p.id === activeId);
      const isOverInLeft = leftAxisParams.some((p) => p.id === overId) || overId === "left-axis";
      const isOverInRight = rightAxisParams.some((p) => p.id === overId) || overId === "right-axis";

      // Same axis reordering
      if (isActiveInLeft && isOverInLeft) {
        const activeIndex = leftAxisParams.findIndex((p) => p.id === activeId);
        const overIndex = leftAxisParams.findIndex((p) => p.id === overId);
        if (activeIndex !== overIndex && overIndex >= 0) {
          onLeftAxisChange(arrayMove(leftAxisParams, activeIndex, overIndex));
        }
      } else if (isActiveInRight && isOverInRight) {
        const activeIndex = rightAxisParams.findIndex((p) => p.id === activeId);
        const overIndex = rightAxisParams.findIndex((p) => p.id === overId);
        if (activeIndex !== overIndex && overIndex >= 0) {
          onRightAxisChange(arrayMove(rightAxisParams, activeIndex, overIndex));
        }
      }
      // Moving between axes
      else if (isActiveInLeft && isOverInRight) {
        const param = leftAxisParams.find((p) => p.id === activeId);
        if (param) {
          onLeftAxisChange(leftAxisParams.filter((p) => p.id !== activeId));
          onRightAxisChange([...rightAxisParams, param]);
        }
      } else if (isActiveInRight && isOverInLeft) {
        const param = rightAxisParams.find((p) => p.id === activeId);
        if (param) {
          onRightAxisChange(rightAxisParams.filter((p) => p.id !== activeId));
          onLeftAxisChange([...leftAxisParams, param]);
        }
      }
    },
    [leftAxisParams, rightAxisParams, canAddMore, createAxisParameter, onLeftAxisChange, onRightAxisChange]
  );

  // Remove parameter handlers
  const handleRemoveFromLeft = useCallback(
    (paramId: string) => {
      onLeftAxisChange(leftAxisParams.filter((p) => p.id !== paramId));
    },
    [leftAxisParams, onLeftAxisChange]
  );

  const handleRemoveFromRight = useCallback(
    (paramId: string) => {
      onRightAxisChange(rightAxisParams.filter((p) => p.id !== paramId));
    },
    [rightAxisParams, onRightAxisChange]
  );

  // Update parameter handlers
  const handleUpdateLeft = useCallback(
    (paramId: string, updates: Partial<AxisParameter>) => {
      onLeftAxisChange(
        leftAxisParams.map((p) => (p.id === paramId ? { ...p, ...updates } : p))
      );
    },
    [leftAxisParams, onLeftAxisChange]
  );

  const handleUpdateRight = useCallback(
    (paramId: string, updates: Partial<AxisParameter>) => {
      onRightAxisChange(
        rightAxisParams.map((p) => (p.id === paramId ? { ...p, ...updates } : p))
      );
    },
    [rightAxisParams, onRightAxisChange]
  );

  // Clear handlers
  const handleClearLeft = useCallback(() => {
    onLeftAxisChange([]);
  }, [onLeftAxisChange]);

  const handleClearRight = useCallback(() => {
    onRightAxisChange([]);
  }, [onRightAxisChange]);

  // Calculate max per axis (remaining + current)
  const maxLeft = MAX_PARAMETERS - rightAxisParams.length;
  const maxRight = MAX_PARAMETERS - leftAxisParams.length;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Available Parameters */}
        <div className="lg:col-span-1 border rounded-lg p-4 bg-card min-h-[350px]">
          {!hasSiteSelected ? (
            <div className="flex flex-col h-full">
              <h3 className="text-sm font-medium mb-2">Available Parameters</h3>
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm text-center p-4">
                Select a project and site above<br />to browse available parameters
              </div>
            </div>
          ) : (
            <AvailableParametersList
              devices={devices}
              selectedDeviceId={selectedDeviceId}
              onDeviceChange={onDeviceChange}
              registers={availableRegisters}
              onAddToAxis={handleAddToAxis}
              canAddMore={canAddMore}
              dataSource={dataSource}
              currentSiteId={currentSiteId}
              localLockedSiteId={localLockedSiteId}
            />
          )}
        </div>

        {/* Left Y-Axis */}
        <div className="lg:col-span-1 border rounded-lg p-4 bg-card min-h-[350px]">
          <AxisDropZone
            id="left-axis"
            title="Left Y-Axis"
            parameters={leftAxisParams}
            onRemoveParameter={handleRemoveFromLeft}
            onUpdateParameter={handleUpdateLeft}
            onClearAll={handleClearLeft}
            maxParameters={maxLeft}
          />
        </div>

        {/* Right Y-Axis */}
        <div className="lg:col-span-1 border rounded-lg p-4 bg-card min-h-[350px]">
          <AxisDropZone
            id="right-axis"
            title="Right Y-Axis"
            parameters={rightAxisParams}
            onRemoveParameter={handleRemoveFromRight}
            onUpdateParameter={handleUpdateRight}
            onClearAll={handleClearRight}
            maxParameters={maxRight}
          />
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeId && draggedRegister ? (
          <div className="flex items-center gap-2 p-2 rounded-md border bg-card shadow-lg opacity-90">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{draggedRegister.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {draggedRegister.deviceName} {draggedRegister.unit && `• ${draggedRegister.unit}`}
              </p>
            </div>
          </div>
        ) : null}
      </DragOverlay>

      {/* Capacity indicator */}
      <div className="mt-2 text-center">
        <p className={`text-xs ${totalParams >= MAX_PARAMETERS ? "text-amber-500" : "text-muted-foreground"}`}>
          {totalParams}/{MAX_PARAMETERS} total parameters
          {totalParams >= MAX_PARAMETERS && " — remove some to add more"}
        </p>
      </div>
    </DndContext>
  );
}
