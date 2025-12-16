"use client";

/**
 * Device Registers Panel Component
 *
 * Displays all Modbus registers from devices at a site, grouped by device.
 * - READ registers: View only (displays "--" placeholder)
 * - WRITE/READWRITE registers: Input field + "Set" button
 *
 * Commands are logged to control_commands table for audit trail.
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronRight,
  Settings,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { ModbusRegister } from "@/components/devices/register-form";

// Device with registers for the control panel
interface DeviceWithRegisters {
  id: string;
  name: string;
  is_online: boolean;
  registers: ModbusRegister[] | null;
  device_templates: {
    name: string;
    device_type: string;
    brand: string;
    model: string;
  } | null;
}

interface DeviceRegistersPanelProps {
  siteId: string;
  projectId: string;
  devices: DeviceWithRegisters[];
  isOnline: boolean; // Controller online status
}

export function DeviceRegistersPanel({
  siteId,
  projectId,
  devices,
  isOnline,
}: DeviceRegistersPanelProps) {
  // Track which devices are expanded (default: first device expanded)
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(() => {
    const firstDevice = devices.find((d) => d.registers && d.registers.length > 0);
    return firstDevice ? new Set([firstDevice.id]) : new Set();
  });

  // Track pending register writes: Map<"deviceId-address", pendingValue>
  const [pendingWrites, setPendingWrites] = useState<Map<string, string>>(new Map());

  // Submission state per register (to show individual loading)
  const [submittingKeys, setSubmittingKeys] = useState<Set<string>>(new Set());

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Filter devices that have registers
  const devicesWithRegisters = useMemo(
    () => devices.filter((d) => d.registers && d.registers.length > 0),
    [devices]
  );

  // Toggle device expansion
  const toggleDevice = (deviceId: string) => {
    setExpandedDevices((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) {
        next.delete(deviceId);
      } else {
        next.add(deviceId);
      }
      return next;
    });
  };

  // Handle register value change
  const handleRegisterChange = (deviceId: string, address: number, value: string) => {
    const key = `${deviceId}-${address}`;
    setPendingWrites((prev) => {
      const next = new Map(prev);
      if (value === "") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    });
  };

  // Submit a single register write
  const handleWriteRegister = async (
    deviceId: string,
    deviceName: string,
    register: ModbusRegister,
    value: string
  ) => {
    const key = `${deviceId}-${register.address}`;
    const numericValue = parseFloat(value);

    // Validate
    if (isNaN(numericValue)) {
      setError("Please enter a valid number");
      return;
    }

    // Check min/max constraints
    if (register.min !== undefined && numericValue < register.min) {
      setError(`Value must be at least ${register.min}`);
      return;
    }
    if (register.max !== undefined && numericValue > register.max) {
      setError(`Value must be at most ${register.max}`);
      return;
    }

    setSubmittingKeys((prev) => new Set(prev).add(key));
    setError(null);

    try {
      const supabase = createClient();

      // Log the command to control_commands table
      const { error: insertError } = await supabase.from("control_commands").insert({
        site_id: siteId,
        project_id: projectId,
        command_type: "write_register",
        command_value: {
          device_id: deviceId,
          device_name: deviceName,
          register_address: register.address,
          register_name: register.name,
          value: numericValue,
          unit: register.unit || "",
        },
        status: isOnline ? "sent" : "queued",
      });

      if (insertError) {
        throw insertError;
      }

      // Clear the pending write on success
      setPendingWrites((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    } catch (err) {
      console.error("Failed to write register:", err);
      setError("Failed to send register write command");
    } finally {
      setSubmittingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // Check if register is writable
  const isWritable = (register: ModbusRegister) =>
    register.access === "write" || register.access === "readwrite";

  // Count writable registers per device
  const getWritableCount = (registers: ModbusRegister[]) =>
    registers.filter(isWritable).length;

  // Get access badge style
  const getAccessBadgeStyle = (access: string) => {
    switch (access) {
      case "read":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "write":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "readwrite":
        return "bg-purple-50 text-purple-700 border-purple-200";
      default:
        return "";
    }
  };

  // Don't render if no devices have registers
  if (devicesWithRegisters.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-muted-foreground" />
              Device Registers
            </CardTitle>
            <CardDescription>View and modify device register values</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Error display */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-md text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-2"
              onClick={() => setError(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Device sections */}
        {devicesWithRegisters.map((device) => {
          const isExpanded = expandedDevices.has(device.id);
          const registers = device.registers || [];
          const writableCount = getWritableCount(registers);

          return (
            <Collapsible
              key={device.id}
              open={isExpanded}
              onOpenChange={() => toggleDevice(device.id)}
            >
              <CollapsibleTrigger className="w-full">
                <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div className="text-left">
                      <p className="font-medium">{device.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {device.device_templates?.brand} {device.device_templates?.model}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Online status */}
                    <Badge
                      variant="outline"
                      className={
                        device.is_online
                          ? "bg-green-50 text-green-700 border-green-200"
                          : "bg-gray-100 text-gray-600"
                      }
                    >
                      {device.is_online ? "Online" : "Offline"}
                    </Badge>
                    {/* Register count */}
                    <Badge variant="secondary">
                      {registers.length} reg{registers.length !== 1 ? "s" : ""}
                      {writableCount > 0 && ` (${writableCount} writable)`}
                    </Badge>
                  </div>
                </div>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="mt-2 border rounded-md overflow-hidden">
                  {/* Register table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium w-16">Addr</th>
                          <th className="px-3 py-2 text-left font-medium">Name</th>
                          <th className="px-3 py-2 text-left font-medium w-24">Access</th>
                          <th className="px-3 py-2 text-left font-medium w-32">Value</th>
                          <th className="px-3 py-2 text-left font-medium w-16">Unit</th>
                          <th className="px-3 py-2 text-right font-medium w-20">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {registers.map((register) => {
                          const key = `${device.id}-${register.address}`;
                          const pendingValue = pendingWrites.get(key);
                          const writable = isWritable(register);
                          const isSubmitting = submittingKeys.has(key);

                          return (
                            <tr key={register.address} className="hover:bg-muted/30">
                              <td className="px-3 py-2 font-mono text-xs">
                                {register.address}
                              </td>
                              <td className="px-3 py-2">
                                <span className="font-medium">{register.name}</span>
                                {register.description && (
                                  <p className="text-xs text-muted-foreground">
                                    {register.description}
                                  </p>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <Badge
                                  variant="outline"
                                  className={getAccessBadgeStyle(register.access)}
                                >
                                  {register.access}
                                </Badge>
                              </td>
                              <td className="px-3 py-2">
                                {writable ? (
                                  <Input
                                    type="number"
                                    min={register.min}
                                    max={register.max}
                                    step={register.scale || 1}
                                    value={pendingValue ?? ""}
                                    placeholder="--"
                                    onChange={(e) =>
                                      handleRegisterChange(
                                        device.id,
                                        register.address,
                                        e.target.value
                                      )
                                    }
                                    className="h-8 w-24"
                                    disabled={isSubmitting}
                                  />
                                ) : (
                                  <span className="text-muted-foreground">--</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {register.unit || "--"}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {writable && pendingValue !== undefined && pendingValue !== "" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      handleWriteRegister(
                                        device.id,
                                        device.name,
                                        register,
                                        pendingValue
                                      )
                                    }
                                    disabled={isSubmitting}
                                    className="h-7 min-w-[44px]"
                                  >
                                    {isSubmitting ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      "Set"
                                    )}
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </CardContent>
    </Card>
  );
}
