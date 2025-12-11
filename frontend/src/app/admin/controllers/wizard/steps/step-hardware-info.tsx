"use client";

/**
 * Step 1: Hardware Info
 *
 * Collect basic hardware information:
 * - Serial number (required, unique)
 * - Hardware type (required)
 * - Firmware version (optional)
 * - Notes (optional)
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface HardwareType {
  id: string;
  name: string;
  hardware_type: string;
}

interface ControllerData {
  serial_number: string;
  hardware_type_id: string;
  firmware_version: string;
  notes: string;
}

interface StepHardwareInfoProps {
  hardwareTypes: HardwareType[];
  data: ControllerData;
  onChange: (data: ControllerData) => void;
  isExisting: boolean;
}

export function StepHardwareInfo({
  hardwareTypes,
  data,
  onChange,
  isExisting,
}: StepHardwareInfoProps) {
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    onChange({ ...data, [name]: value });
  };

  return (
    <div className="space-y-6">
      {/* Introduction */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-800 mb-2">Welcome to Controller Setup</h3>
        <p className="text-sm text-blue-700">
          This wizard will guide you through setting up a new controller hardware unit.
          Make sure you have the physical Raspberry Pi device ready before continuing.
        </p>
      </div>

      {/* Serial Number */}
      <div className="space-y-2">
        <Label htmlFor="serial_number">
          Serial Number <span className="text-red-500">*</span>
        </Label>
        <Input
          id="serial_number"
          name="serial_number"
          placeholder="e.g., RSI50303 or RPI5-2024-001"
          value={data.serial_number}
          onChange={handleChange}
          className="min-h-[44px] font-mono"
          disabled={isExisting}
          required
        />
        <p className="text-xs text-muted-foreground">
          Enter the unique serial number printed on your controller hardware.
          This cannot be changed later.
        </p>
      </div>

      {/* Hardware Type */}
      <div className="space-y-2">
        <Label htmlFor="hardware_type_id">
          Hardware Type <span className="text-red-500">*</span>
        </Label>
        <select
          id="hardware_type_id"
          name="hardware_type_id"
          value={data.hardware_type_id}
          onChange={handleChange}
          className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
          disabled={isExisting}
          required
        >
          <option value="">Select hardware type...</option>
          {hardwareTypes.map((hw) => (
            <option key={hw.id} value={hw.id}>
              {hw.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Select the hardware model. Currently supported: Raspberry Pi 5.
        </p>
      </div>

      {/* Firmware Version */}
      <div className="space-y-2">
        <Label htmlFor="firmware_version">Firmware Version</Label>
        <Input
          id="firmware_version"
          name="firmware_version"
          placeholder="e.g., 1.0.0"
          value={data.firmware_version}
          onChange={handleChange}
          className="min-h-[44px]"
        />
        <p className="text-xs text-muted-foreground">
          Optional. The firmware version will be detected automatically when the controller connects.
        </p>
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <textarea
          id="notes"
          name="notes"
          placeholder="Any additional notes about this controller..."
          value={data.notes}
          onChange={handleChange}
          rows={3}
          className="w-full min-h-[80px] px-3 py-2 rounded-md border border-input bg-background resize-none"
        />
        <p className="text-xs text-muted-foreground">
          Optional. Add any notes for your reference.
        </p>
      </div>

      {/* Requirements checklist */}
      <div className="bg-muted rounded-lg p-4">
        <h4 className="font-medium mb-2">Before you continue, make sure you have:</h4>
        <ul className="text-sm space-y-1 text-muted-foreground">
          <li className="flex items-center gap-2">
            <span className="w-4 h-4 rounded border flex items-center justify-center text-xs">1</span>
            A Raspberry Pi 5 device
          </li>
          <li className="flex items-center gap-2">
            <span className="w-4 h-4 rounded border flex items-center justify-center text-xs">2</span>
            A microSD card (32GB or larger recommended)
          </li>
          <li className="flex items-center gap-2">
            <span className="w-4 h-4 rounded border flex items-center justify-center text-xs">3</span>
            A computer with an SD card reader
          </li>
          <li className="flex items-center gap-2">
            <span className="w-4 h-4 rounded border flex items-center justify-center text-xs">4</span>
            Network access (Ethernet cable or WiFi credentials)
          </li>
        </ul>
      </div>
    </div>
  );
}
