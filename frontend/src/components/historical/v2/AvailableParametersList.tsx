"use client";

import { useMemo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { GripVertical, Search, Cpu, HardDrive, Clock, CheckCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import type { AvailableRegister, Device, DataSource, ActiveFilter } from "./types";

interface AvailableParametersListProps {
  devices: Device[];
  selectedDeviceId: string;
  onDeviceChange: (deviceId: string) => void;
  registers: AvailableRegister[];
  onAddToAxis: (register: AvailableRegister, axis: "left" | "right") => void;
  canAddMore: boolean;
  dataSource: DataSource;
  currentSiteId: string;
  localLockedSiteId: string | null;
  isLoading: boolean;
  activeFilter: ActiveFilter;
}

export function AvailableParametersList({
  devices,
  selectedDeviceId,
  onDeviceChange,
  registers,
  onAddToAxis,
  canAddMore,
  dataSource,
  currentSiteId,
  localLockedSiteId,
  isLoading,
  activeFilter,
}: AvailableParametersListProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // For local data source: check if adding is blocked due to different site
  // Local mode only allows parameters from ONE site
  const isLocalSiteBlocked = useMemo(() => {
    if (dataSource !== "local") return false;
    // If no parameters exist yet, any site is allowed
    if (!localLockedSiteId) return false;
    // If browsing a different site than the locked one, block adding
    return currentSiteId !== localLockedSiteId;
  }, [dataSource, localLockedSiteId, currentSiteId]);

  // All devices are regular devices - controller is always added as special entry
  const regularDevices = devices;

  // Controller is always available as a special option (hardcoded)
  const CONTROLLER_ID = "site-controller";

  // Filter registers by search query and active filter
  const filteredRegisters = useMemo(() => {
    let filtered = registers;

    // Filter by active status (hide inactive when "active" filter is selected)
    if (activeFilter === "active") {
      filtered = filtered.filter((reg) => reg.status !== "inactive");
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (reg) =>
          reg.name.toLowerCase().includes(query) ||
          reg.unit.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [registers, searchQuery, activeFilter]);

  // Group registers by status (active first, then inactive/non-active)
  const { activeRegisters, inactiveRegisters } = useMemo(() => {
    const active: AvailableRegister[] = [];
    const inactive: AvailableRegister[] = [];

    for (const reg of filteredRegisters) {
      if (reg.status === "inactive") {
        inactive.push(reg);
      } else {
        active.push(reg);
      }
    }

    return { activeRegisters: active, inactiveRegisters: inactive };
  }, [filteredRegisters]);

  // Check if controller is selected
  const isControllerSelected = selectedDeviceId === CONTROLLER_ID;

  // Get selected device name for display
  const selectedDevice = isControllerSelected
    ? { id: CONTROLLER_ID, name: "Site Controller", device_type: "controller", site_id: "" }
    : devices.find((d) => d.id === selectedDeviceId);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <h3 className="text-sm font-medium mb-2">Available Parameters</h3>

      {/* Device/Controller selector */}
      <Select value={selectedDeviceId} onValueChange={onDeviceChange}>
        <SelectTrigger className="mb-2">
          <SelectValue placeholder="Select source">
            {selectedDevice && (
              <span className="flex items-center gap-2">
                {isControllerSelected ? (
                  <Cpu className="h-3.5 w-3.5 text-blue-500" />
                ) : (
                  <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                {selectedDevice.name}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {/* Master Device - always available as first option */}
          <SelectGroup>
            <SelectLabel className="text-xs text-muted-foreground flex items-center gap-1">
              <Cpu className="h-3 w-3" /> Master Device (Site Level)
            </SelectLabel>
            <SelectItem value={CONTROLLER_ID}>
              <span className="flex items-center gap-2">
                <Cpu className="h-3.5 w-3.5 text-blue-500" />
                Site Controller
              </span>
            </SelectItem>
          </SelectGroup>

          {/* Devices section */}
          {regularDevices.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-xs text-muted-foreground flex items-center gap-1">
                <HardDrive className="h-3 w-3" /> Device
              </SelectLabel>
              {regularDevices.map((device) => (
                <SelectItem key={device.id} value={device.id}>
                  <span className={`flex items-center gap-2 ${device.enabled === false ? "text-muted-foreground" : ""}`}>
                    <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                    {device.name}
                    {device.enabled === false && (
                      <span className="text-xs opacity-60">(disabled)</span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>

      {/* Search */}
      <div className="relative mb-2">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search registers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8 h-9"
        />
      </div>

      {/* Local source site restriction warning */}
      {isLocalSiteBlocked && (
        <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded-md">
          <p className="text-xs text-amber-700">
            Local source allows one site only. Clear existing parameters to change sites.
          </p>
        </div>
      )}

      {/* Register list */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {!selectedDeviceId ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm text-center p-4">
            Select a device to view<br />available parameters
          </div>
        ) : isLoading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading registers...
          </div>
        ) : filteredRegisters.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm text-center p-4">
            {searchQuery ? "No matching registers" : "No registers available"}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Active registers section */}
            {activeRegisters.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5 px-1">
                  <CheckCircle className="h-3 w-3 text-green-500" />
                  <span>Active ({activeRegisters.length})</span>
                </div>
                <div className="space-y-1">
                  {activeRegisters.map((register) => (
                    <DraggableRegisterItem
                      key={register.id}
                      register={register}
                      onAddToAxis={onAddToAxis}
                      canAddMore={canAddMore && !isLocalSiteBlocked}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Non-active registers section */}
            {inactiveRegisters.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5 px-1">
                  <Clock className="h-3 w-3 text-amber-500" />
                  <span>Non-Active ({inactiveRegisters.length})</span>
                </div>
                <div className="space-y-1">
                  {inactiveRegisters.map((register) => (
                    <DraggableRegisterItem
                      key={register.id}
                      register={register}
                      onAddToAxis={onAddToAxis}
                      canAddMore={canAddMore && !isLocalSiteBlocked}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Format ISO date to short display: "Jan 15" (same year) or "Jan 15 '25" (different year) */
function formatShortDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const month = date.toLocaleString("en-US", { month: "short" });
  const day = date.getDate();
  if (date.getFullYear() !== now.getFullYear()) {
    return `${month} ${day} '${String(date.getFullYear()).slice(-2)}`;
  }
  return `${month} ${day}`;
}

interface DraggableRegisterItemProps {
  register: AvailableRegister;
  onAddToAxis: (register: AvailableRegister, axis: "left" | "right") => void;
  canAddMore: boolean;
}

function DraggableRegisterItem({
  register,
  onAddToAxis,
  canAddMore,
}: DraggableRegisterItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `available-${register.id}`,
    data: { register },
    disabled: !canAddMore,
  });

  const isInactive = register.status === "inactive";

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`
        flex items-center gap-2 p-2 rounded-md border bg-muted/30
        ${isDragging ? "opacity-50 shadow-lg" : "hover:bg-muted/50"}
        ${!canAddMore ? "opacity-50 cursor-not-allowed" : "cursor-grab active:cursor-grabbing"}
        ${isInactive ? "border-amber-200 bg-amber-50/30" : ""}
        transition-colors
      `}
    >
      {/* Drag handle indicator */}
      <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />

      {/* Parameter info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className={`text-sm font-medium truncate ${isInactive ? "text-amber-700" : ""}`}>
            {register.name}
          </p>
          {isInactive && (
            <Badge variant="outline" className="h-4 px-1 text-[10px] border-amber-300 text-amber-600 bg-amber-50">
              Non-Active
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {register.siteName} › {register.deviceName}
          {isInactive && register.firstSeen && register.lastSeen
            ? ` • ${formatShortDate(register.firstSeen)} – ${formatShortDate(register.lastSeen)}`
            : register.unit ? ` • ${register.unit}` : ""}
        </p>
      </div>

      {/* Quick add buttons */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            onAddToAxis(register, "left");
          }}
          disabled={!canAddMore}
          title="Add to Left Y-Axis"
        >
          +L
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            onAddToAxis(register, "right");
          }}
          disabled={!canAddMore}
          title="Add to Right Y-Axis"
        >
          +R
        </Button>
      </div>
    </div>
  );
}
