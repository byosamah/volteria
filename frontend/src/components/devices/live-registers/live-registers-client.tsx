"use client";

/**
 * Live Registers Client Component
 *
 * Main client component for the live registers feature.
 * Manages state and connects to real API for register operations.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import type { ModbusRegister } from "@/components/devices/register-form";
import { RegisterSection } from "./register-section";
import type {
  LiveRegistersClientProps,
  RegisterValuesMap,
  LoadingGroupsSet,
  PendingWritesMap,
  WriteStatusMap,
  RegisterSection as SectionType,
  RegisterGroup,
} from "./types";

// Write queue item type
interface WriteQueueItem {
  section: SectionType;
  register: ModbusRegister;
  value: string;
  key: string;
}

// Toggle for mock data vs real API calls (set to false for production)
const USE_MOCK_DATA = false;

// Maximum registers per auto-generated group
const MAX_REGISTERS_PER_GROUP = 30;

// Group registers by register.group field or auto-chunk if no group
function groupRegisters(registers: ModbusRegister[]): RegisterGroup[] {
  if (!registers || registers.length === 0) {
    return [];
  }

  const grouped = new Map<string, ModbusRegister[]>();
  const ungrouped: ModbusRegister[] = [];

  // Separate grouped and ungrouped registers
  for (const reg of registers) {
    if (reg.group) {
      const existing = grouped.get(reg.group) || [];
      existing.push(reg);
      grouped.set(reg.group, existing);
    } else {
      ungrouped.push(reg);
    }
  }

  const result: RegisterGroup[] = [];

  // Add grouped registers
  for (const [name, regs] of grouped) {
    result.push({ name, registers: regs.sort((a, b) => a.address - b.address) });
  }

  // Auto-chunk ungrouped registers
  if (ungrouped.length > 0) {
    const sorted = ungrouped.sort((a, b) => a.address - b.address);
    const chunks = Math.ceil(sorted.length / MAX_REGISTERS_PER_GROUP);

    for (let i = 0; i < chunks; i++) {
      const start = i * MAX_REGISTERS_PER_GROUP;
      const end = Math.min(start + MAX_REGISTERS_PER_GROUP, sorted.length);
      const chunkRegs = sorted.slice(start, end);

      // Name: "Registers" if only one chunk, otherwise "Group 1", "Group 2", etc.
      const name = chunks === 1 ? "Registers" : `Group ${i + 1}`;
      result.push({ name, registers: chunkRegs });
    }
  }

  return result;
}

// Generate mock value for a register
function generateMockValue(register: ModbusRegister): number {
  const min = register.min ?? 0;
  const max = register.max ?? 1000;
  const range = max - min;
  return min + Math.random() * range;
}

export function LiveRegistersClient({
  device,
  projectId,
  siteId,
  controllerId,
}: LiveRegistersClientProps) {
  // State for register values
  const [registerValues, setRegisterValues] = useState<RegisterValuesMap>(new Map());
  const [loadingGroups, setLoadingGroups] = useState<LoadingGroupsSet>(new Set());
  const [pendingWrites, setPendingWrites] = useState<PendingWritesMap>(new Map());
  const [writeStatus, setWriteStatus] = useState<WriteStatusMap>(new Map());

  // Write queue state - process writes sequentially to avoid Modbus conflicts
  const writeQueueRef = useRef<WriteQueueItem[]>([]);
  const isProcessingQueueRef = useRef(false);

  // Check if controller is available for real API calls
  const hasController = !!controllerId;

  // Group registers by section
  const loggingGroups = groupRegisters(device.registers || []);
  const visualizationGroups = groupRegisters(device.visualization_registers || []);
  const alarmGroups = groupRegisters(device.alarm_registers || []);

  // Check if any registers exist
  const hasRegisters =
    loggingGroups.length > 0 ||
    visualizationGroups.length > 0 ||
    alarmGroups.length > 0;

  // Generate unique key for a register in a section
  const getRegisterKey = (section: SectionType, address: number) =>
    `${section}-${address}`;

  // Execute a single write operation (internal function)
  const executeWrite = useCallback(
    async (section: SectionType, register: ModbusRegister, value: string, key: string) => {
      const numValue = parseFloat(value);

      try {
        if (USE_MOCK_DATA) {
          // Simulate network delay
          await new Promise((resolve) =>
            setTimeout(resolve, 600 + Math.random() * 400)
          );

          // Simulate success (90% success rate for demo)
          if (Math.random() > 0.1) {
            // Update the value in state
            const scale = register.scale ?? 1;
            const offset = register.offset ?? 0;
            const scaleOrder = register.scale_order ?? "multiply_first";

            let scaledValue: number;
            if (scaleOrder === "multiply_first") {
              scaledValue = numValue * scale + offset;
            } else {
              scaledValue = (numValue + offset) * scale;
            }

            setRegisterValues((prev) => {
              const next = new Map(prev);
              next.set(key, {
                raw_value: numValue,
                scaled_value: scaledValue,
                timestamp: new Date().toISOString(),
              });
              return next;
            });

            setWriteStatus((prev) => new Map(prev).set(key, "success"));
            setPendingWrites((prev) => {
              const next = new Map(prev);
              next.delete(key);
              return next;
            });

            toast.success(`Wrote ${numValue} to ${register.name}`);

            // Clear success status after 2 seconds
            setTimeout(() => {
              setWriteStatus((prev) => {
                const next = new Map(prev);
                next.delete(key);
                return next;
              });
            }, 2000);
          } else {
            throw new Error("Simulated write failure");
          }
        } else {
          // Real API call
          if (!controllerId) {
            toast.error("No controller connected to this site");
            setWriteStatus((prev) => new Map(prev).set(key, "error"));
            return;
          }

          const response = await fetch(`/api/controllers/${controllerId}/registers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "write",
              device_id: device.id,
              address: register.address,
              value: Math.round(numValue), // Modbus requires integer
              verify: true,
            }),
          });

          const result = await response.json();

          if (!response.ok) {
            throw new Error(result.error || result.detail || "Write failed");
          }

          if (!result.success) {
            throw new Error(result.error || "Write failed");
          }

          // Update the value in state with verified value
          const scale = register.scale ?? 1;
          const offset = register.offset ?? 0;
          const scaleOrder = register.scale_order ?? "multiply_first";

          const rawValue = result.read_back_value ?? result.written_value;
          let scaledValue: number;
          if (scaleOrder === "multiply_first") {
            scaledValue = rawValue * scale + offset;
          } else {
            scaledValue = (rawValue + offset) * scale;
          }

          setRegisterValues((prev) => {
            const next = new Map(prev);
            next.set(key, {
              raw_value: rawValue,
              scaled_value: scaledValue,
              timestamp: new Date().toISOString(),
            });
            return next;
          });

          setWriteStatus((prev) => new Map(prev).set(key, "success"));
          setPendingWrites((prev) => {
            const next = new Map(prev);
            next.delete(key);
            return next;
          });

          const verifyMsg = result.verified ? " (verified)" : "";
          toast.success(`Wrote ${result.written_value} to ${register.name}${verifyMsg}`);

          // Clear success status after 2 seconds
          setTimeout(() => {
            setWriteStatus((prev) => {
              const next = new Map(prev);
              next.delete(key);
              return next;
            });
          }, 2000);
        }
      } catch (error) {
        console.error("Error writing register:", error);
        setWriteStatus((prev) => new Map(prev).set(key, "error"));
        toast.error(error instanceof Error ? error.message : `Failed to write to ${register.name}`);

        // Clear error status after 3 seconds
        setTimeout(() => {
          setWriteStatus((prev) => {
            const next = new Map(prev);
            next.delete(key);
            return next;
          });
        }, 3000);
      }
    },
    [device.id, controllerId]
  );

  // Process write queue sequentially
  const processWriteQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) return;
    if (writeQueueRef.current.length === 0) return;

    isProcessingQueueRef.current = true;

    while (writeQueueRef.current.length > 0) {
      const item = writeQueueRef.current.shift()!;

      // Execute the write
      await executeWrite(item.section, item.register, item.value, item.key);

      // Wait 500ms before next write to let Modbus device settle
      if (writeQueueRef.current.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    isProcessingQueueRef.current = false;
  }, [executeWrite]);

  // Request data for a group of registers
  const handleRequestData = useCallback(
    async (
      section: SectionType,
      groupName: string,
      registers: ModbusRegister[]
    ) => {
      const groupKey = `${section}-${groupName}`;

      // Mark group as loading
      setLoadingGroups((prev) => new Set(prev).add(groupKey));

      try {
        if (USE_MOCK_DATA) {
          // Simulate network delay
          await new Promise((resolve) =>
            setTimeout(resolve, 800 + Math.random() * 400)
          );

          // Generate mock values
          const now = new Date().toISOString();
          const newValues = new Map(registerValues);

          for (const reg of registers) {
            const rawValue = generateMockValue(reg);
            const scale = reg.scale ?? 1;
            const offset = reg.offset ?? 0;
            const scaleOrder = reg.scale_order ?? "multiply_first";

            let scaledValue: number;
            if (scaleOrder === "multiply_first") {
              scaledValue = rawValue * scale + offset;
            } else {
              scaledValue = (rawValue + offset) * scale;
            }

            newValues.set(getRegisterKey(section, reg.address), {
              raw_value: rawValue,
              scaled_value: scaledValue,
              timestamp: now,
            });
          }

          setRegisterValues(newValues);
          toast.success(`Read ${registers.length} registers`);
        } else {
          // Real API call
          if (!controllerId) {
            toast.error("No controller connected to this site");
            return;
          }

          const response = await fetch(`/api/controllers/${controllerId}/registers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "read",
              device_id: device.id,
              addresses: registers.map((r) => r.address),
            }),
          });

          const result = await response.json();

          if (!response.ok) {
            throw new Error(result.error || result.detail || "Request failed");
          }

          if (!result.success) {
            const errorMsg = result.errors?.join(", ") || "Failed to read registers";
            toast.error(errorMsg);
            return;
          }

          // Update values from response
          const newValues = new Map(registerValues);
          for (const [addr, data] of Object.entries(result.readings)) {
            const reading = data as { raw_value: number; scaled_value: number; timestamp: string };
            newValues.set(getRegisterKey(section, parseInt(addr)), {
              raw_value: reading.raw_value,
              scaled_value: reading.scaled_value,
              timestamp: reading.timestamp,
            });
          }

          setRegisterValues(newValues);
          const readCount = Object.keys(result.readings).length;
          toast.success(`Read ${readCount} register${readCount !== 1 ? "s" : ""}`);

          // Show any partial errors
          if (result.errors && result.errors.length > 0) {
            toast.warning(result.errors.join("; "));
          }
        }
      } catch (error) {
        console.error("Error reading registers:", error);
        toast.error(error instanceof Error ? error.message : "Failed to read registers");
      } finally {
        // Remove loading state
        setLoadingGroups((prev) => {
          const next = new Set(prev);
          next.delete(groupKey);
          return next;
        });
      }
    },
    [registerValues, device.id, controllerId]
  );

  // Write value to a register (queues the write for sequential processing)
  const handleWriteValue = useCallback(
    async (section: SectionType, register: ModbusRegister, value: string) => {
      const key = getRegisterKey(section, register.address);
      const numValue = parseFloat(value);

      // Validate value
      if (isNaN(numValue)) {
        toast.error("Invalid value - must be a number");
        return;
      }

      // Check min/max
      if (register.min !== undefined && numValue < register.min) {
        toast.error(`Value must be at least ${register.min}`);
        return;
      }
      if (register.max !== undefined && numValue > register.max) {
        toast.error(`Value must be at most ${register.max}`);
        return;
      }

      // Check if this register is already queued (prevent duplicates)
      const alreadyQueued = writeQueueRef.current.some(item => item.key === key);
      if (alreadyQueued) {
        // Update the value in the queue instead of adding a duplicate
        writeQueueRef.current = writeQueueRef.current.map(item =>
          item.key === key ? { ...item, value } : item
        );
        toast.info(`Updated queued write for ${register.name}`);
        return;
      }

      // Mark as pending (shows "queued" visual state)
      setWriteStatus((prev) => new Map(prev).set(key, "pending"));

      // Add to queue
      writeQueueRef.current.push({ section, register, value, key });

      // Show queue position if there are other writes waiting
      const queueLength = writeQueueRef.current.length;
      if (queueLength > 1) {
        toast.info(`Queued write to ${register.name} (${queueLength} pending)`);
      }

      // Start processing queue (no-op if already processing)
      processWriteQueue();
    },
    [processWriteQueue]
  );

  // Update pending write value
  const handlePendingWriteChange = useCallback((key: string, value: string) => {
    setPendingWrites((prev) => {
      const next = new Map(prev);
      if (value === "") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    });
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild className="min-h-[44px]">
            <Link href={`/projects/${projectId}/sites/${siteId}`}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{device.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              {device.device_templates && (
                <span className="text-sm text-muted-foreground">
                  {device.device_templates.brand} {device.device_templates.model}
                </span>
              )}
              <Badge
                variant="outline"
                className={
                  device.is_online
                    ? "bg-green-50 text-green-700 border-green-200"
                    : "bg-gray-50 text-gray-600 border-gray-200"
                }
              >
                {device.is_online ? "Online" : "Offline"}
              </Badge>
            </div>
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          Live Registers - Read/Write Modbus Values
        </div>
      </div>

      {/* No controller warning */}
      {!hasController && !USE_MOCK_DATA && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
          <div>
            <p className="font-medium text-amber-800">No controller connected</p>
            <p className="text-sm text-amber-700">
              This site does not have a controller assigned. Register operations require a connected controller.
            </p>
          </div>
        </div>
      )}

      {/* No registers message */}
      {!hasRegisters && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">
            No registers configured for this device.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Configure registers in the device settings to use this feature.
          </p>
        </div>
      )}

      {/* Register Sections */}
      {loggingGroups.length > 0 && (
        <RegisterSection
          title="Logging Registers"
          section="logging"
          groups={loggingGroups}
          registerValues={registerValues}
          loadingGroups={loadingGroups}
          pendingWrites={pendingWrites}
          writeStatus={writeStatus}
          onRequestData={handleRequestData}
          onWriteValue={handleWriteValue}
          onPendingWriteChange={handlePendingWriteChange}
        />
      )}

      {visualizationGroups.length > 0 && (
        <RegisterSection
          title="Visualization Registers"
          section="visualization"
          groups={visualizationGroups}
          registerValues={registerValues}
          loadingGroups={loadingGroups}
          pendingWrites={pendingWrites}
          writeStatus={writeStatus}
          onRequestData={handleRequestData}
          onWriteValue={handleWriteValue}
          onPendingWriteChange={handlePendingWriteChange}
        />
      )}

      {alarmGroups.length > 0 && (
        <RegisterSection
          title="Alarm Registers"
          section="alarms"
          groups={alarmGroups}
          registerValues={registerValues}
          loadingGroups={loadingGroups}
          pendingWrites={pendingWrites}
          writeStatus={writeStatus}
          onRequestData={handleRequestData}
          onWriteValue={handleWriteValue}
          onPendingWriteChange={handlePendingWriteChange}
        />
      )}
    </div>
  );
}
