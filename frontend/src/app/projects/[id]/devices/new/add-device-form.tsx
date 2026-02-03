"use client";

/**
 * Add Device Form Component
 *
 * Handles device creation with dynamic fields based on protocol.
 * Protocol determines which connection fields are required:
 * - tcp: IP, Port, Slave ID
 * - rtu_gateway: Gateway IP, Gateway Port, Slave ID
 * - rtu_direct: Serial Port, Baudrate, Slave ID
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import Link from "next/link";

// Device template type
interface DeviceTemplate {
  id: string;
  template_id: string;
  name: string;
  device_type: string;
  brand: string;
  model: string;
  rated_power_kw: number | null;
}

interface AddDeviceFormProps {
  projectId: string;
  templates: DeviceTemplate[];
}

// Protocol options
const protocols = [
  { value: "tcp", label: "Modbus TCP", description: "Direct TCP connection" },
  { value: "rtu_gateway", label: "RTU via Gateway", description: "RTU through a TCP gateway (e.g., Netbiter)" },
  { value: "rtu_direct", label: "Direct RTU", description: "Direct RS485 connection" },
];

export function AddDeviceForm({ projectId, templates }: AddDeviceFormProps) {
  const router = useRouter();
  const supabase = createClient();

  // Form state
  const [loading, setLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    protocol: "tcp",
    // TCP fields
    ip_address: "",
    port: 502,
    // RTU Gateway fields
    gateway_ip: "",
    gateway_port: 502,
    // RTU Direct fields
    serial_port: "",
    baudrate: 9600,
    // Common
    slave_id: 1,
    // Optional
    rated_power_kw: "",
  });

  // Get selected template details
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  // Handle input changes
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;

    if (type === "number") {
      setFormData((prev) => ({ ...prev, [name]: value === "" ? "" : parseFloat(value) }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  // Handle template selection
  const handleTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const templateId = e.target.value;
    setSelectedTemplateId(templateId);

    // Auto-fill device name if empty
    if (!formData.name && templateId) {
      const template = templates.find((t) => t.id === templateId);
      if (template) {
        setFormData((prev) => ({
          ...prev,
          name: `${template.brand} ${template.model}`,
        }));
      }
    }
  };

  // Check for Modbus address conflicts
  // Prevents duplicate Slave ID + IP/Port combinations
  const checkForConflicts = async (): Promise<string | null> => {
    // Query existing devices in this project (via site_devices joined to sites)
    const { data: existingDevices, error } = await supabase
      .from("site_devices")
      .select("name, protocol, ip_address, port, gateway_ip, gateway_port, serial_port, slave_id, sites!inner(project_id)")
      .eq("sites.project_id", projectId)
      .eq("enabled", true);

    if (error || !existingDevices) {
      return null; // Can't check, allow submission
    }

    // Check for conflicts based on protocol
    for (const device of existingDevices) {
      if (formData.protocol === "tcp" && device.protocol === "tcp") {
        // TCP: Check IP + Port + Slave ID
        if (
          device.ip_address === formData.ip_address.trim() &&
          device.port === formData.port &&
          device.slave_id === formData.slave_id
        ) {
          return `Conflict: Device "${device.name}" already uses IP ${device.ip_address}:${device.port} with Slave ID ${device.slave_id}`;
        }
      } else if (formData.protocol === "rtu_gateway" && device.protocol === "rtu_gateway") {
        // RTU Gateway: Check Gateway IP + Port + Slave ID
        if (
          device.gateway_ip === formData.gateway_ip.trim() &&
          device.gateway_port === formData.gateway_port &&
          device.slave_id === formData.slave_id
        ) {
          return `Conflict: Device "${device.name}" already uses Gateway ${device.gateway_ip}:${device.gateway_port} with Slave ID ${device.slave_id}`;
        }
      } else if (formData.protocol === "rtu_direct" && device.protocol === "rtu_direct") {
        // RTU Direct: Check Serial Port + Slave ID
        if (
          device.serial_port === formData.serial_port.trim() &&
          device.slave_id === formData.slave_id
        ) {
          return `Conflict: Device "${device.name}" already uses ${device.serial_port} with Slave ID ${device.slave_id}`;
        }
      }
    }

    return null; // No conflicts
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate required fields
      if (!selectedTemplateId) {
        toast.error("Please select a device template");
        setLoading(false);
        return;
      }

      if (!formData.name.trim()) {
        toast.error("Device name is required");
        setLoading(false);
        return;
      }

      // Validate protocol-specific fields
      if (formData.protocol === "tcp") {
        if (!formData.ip_address.trim()) {
          toast.error("IP address is required for Modbus TCP");
          setLoading(false);
          return;
        }
      } else if (formData.protocol === "rtu_gateway") {
        if (!formData.gateway_ip.trim()) {
          toast.error("Gateway IP is required for RTU via Gateway");
          setLoading(false);
          return;
        }
      } else if (formData.protocol === "rtu_direct") {
        if (!formData.serial_port.trim()) {
          toast.error("Serial port is required for Direct RTU");
          setLoading(false);
          return;
        }
      }

      // Check for Modbus address conflicts
      const conflictError = await checkForConflicts();
      if (conflictError) {
        toast.error(conflictError);
        setLoading(false);
        return;
      }

      // Create device in Supabase
      // Note: This is a legacy form - devices should now be added at site level
      const { error } = await supabase.from("site_devices").insert({
        template_id: selectedTemplateId,
        name: formData.name.trim(),
        protocol: formData.protocol,
        ip_address: formData.protocol === "tcp" ? formData.ip_address.trim() : null,
        port: formData.protocol === "tcp" ? formData.port : null,
        gateway_ip: formData.protocol === "rtu_gateway" ? formData.gateway_ip.trim() : null,
        gateway_port: formData.protocol === "rtu_gateway" ? formData.gateway_port : null,
        serial_port: formData.protocol === "rtu_direct" ? formData.serial_port.trim() : null,
        baudrate: formData.protocol === "rtu_direct" ? formData.baudrate : null,
        slave_id: formData.slave_id,
        rated_power_kw: formData.rated_power_kw ? parseFloat(formData.rated_power_kw as string) : null,
        enabled: true,
        is_online: false,
      });

      if (error) {
        console.error("Error creating device:", error);
        toast.error(error.message || "Failed to add device");
        setLoading(false);
        return;
      }

      // Success!
      toast.success("Device added successfully");
      router.push(`/projects/${projectId}`);
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
      setLoading(false);
    }
  };

  // Group templates by type for the select dropdown
  const templatesByType = templates.reduce(
    (acc, template) => {
      const type = template.device_type;
      if (!acc[type]) acc[type] = [];
      acc[type].push(template);
      return acc;
    },
    {} as Record<string, DeviceTemplate[]>
  );

  // Type labels for optgroup
  const typeLabels: Record<string, string> = {
    inverter: "Solar Inverters",
    load_meter: "Energy Meters",
    dg: "Generator Controllers",
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Template Selection */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="template">
            Device Template <span className="text-red-500">*</span>
          </Label>
          <select
            id="template"
            value={selectedTemplateId}
            onChange={handleTemplateChange}
            className="w-full h-10 px-3 rounded-md border border-input bg-background"
            required
          >
            <option value="">Select a template...</option>
            {Object.entries(templatesByType).map(([type, items]) => (
              <optgroup key={type} label={typeLabels[type] || type}>
                {items.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                    {template.rated_power_kw && ` (${template.rated_power_kw} kW)`}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {selectedTemplate && (
            <p className="text-xs text-muted-foreground">
              Template: {selectedTemplate.template_id}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="name">
            Device Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="name"
            name="name"
            placeholder="e.g., Solar Inverter 1"
            value={formData.name}
            onChange={handleChange}
            required
          />
        </div>
      </div>

      <Separator />

      {/* Protocol Selection */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Connection Settings</h3>

        <div className="space-y-2">
          <Label htmlFor="protocol">
            Protocol <span className="text-red-500">*</span>
          </Label>
          <select
            id="protocol"
            name="protocol"
            value={formData.protocol}
            onChange={handleChange}
            className="w-full h-10 px-3 rounded-md border border-input bg-background"
          >
            {protocols.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {protocols.find((p) => p.value === formData.protocol)?.description}
          </p>
        </div>

        {/* TCP Fields */}
        {formData.protocol === "tcp" && (
          <div className="space-y-4 pl-4 border-l-2 border-muted">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ip_address">
                  IP Address <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="ip_address"
                  name="ip_address"
                  placeholder="e.g., 192.168.1.30"
                  value={formData.ip_address}
                  onChange={handleChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  name="port"
                  type="number"
                  min={1}
                  max={65535}
                  value={formData.port}
                  onChange={handleChange}
                />
              </div>
            </div>
          </div>
        )}

        {/* RTU Gateway Fields */}
        {formData.protocol === "rtu_gateway" && (
          <div className="space-y-4 pl-4 border-l-2 border-muted">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="gateway_ip">
                  Gateway IP <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="gateway_ip"
                  name="gateway_ip"
                  placeholder="e.g., 192.168.1.1"
                  value={formData.gateway_ip}
                  onChange={handleChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gateway_port">Gateway Port</Label>
                <Input
                  id="gateway_port"
                  name="gateway_port"
                  type="number"
                  min={1}
                  max={65535}
                  value={formData.gateway_port}
                  onChange={handleChange}
                />
              </div>
            </div>
          </div>
        )}

        {/* RTU Direct Fields */}
        {formData.protocol === "rtu_direct" && (
          <div className="space-y-4 pl-4 border-l-2 border-muted">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="serial_port">
                  Serial Port <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="serial_port"
                  name="serial_port"
                  placeholder="e.g., /dev/ttyUSB0"
                  value={formData.serial_port}
                  onChange={handleChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="baudrate">Baudrate</Label>
                <select
                  id="baudrate"
                  name="baudrate"
                  value={formData.baudrate}
                  onChange={handleChange}
                  className="w-full h-10 px-3 rounded-md border border-input bg-background"
                >
                  <option value={9600}>9600</option>
                  <option value={19200}>19200</option>
                  <option value={38400}>38400</option>
                  <option value={57600}>57600</option>
                  <option value={115200}>115200</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Common: Slave ID */}
        <div className="space-y-2">
          <Label htmlFor="slave_id">
            Slave ID <span className="text-red-500">*</span>
          </Label>
          <Input
            id="slave_id"
            name="slave_id"
            type="number"
            min={1}
            max={247}
            value={formData.slave_id}
            onChange={handleChange}
            required
          />
          <p className="text-xs text-muted-foreground">
            Modbus device address (1-247)
          </p>
        </div>
      </div>

      <Separator />

      {/* Optional: Power Override */}
      {selectedTemplate?.device_type === "inverter" && (
        <>
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Optional Settings</h3>
            <div className="space-y-2">
              <Label htmlFor="rated_power_kw">Rated Power (kW)</Label>
              <Input
                id="rated_power_kw"
                name="rated_power_kw"
                type="number"
                min={0}
                step={0.1}
                placeholder={
                  selectedTemplate?.rated_power_kw
                    ? `Default: ${selectedTemplate.rated_power_kw} kW`
                    : "Enter rated power"
                }
                value={formData.rated_power_kw}
                onChange={handleChange}
              />
              <p className="text-xs text-muted-foreground">
                Override the template default if needed
              </p>
            </div>
          </div>
          <Separator />
        </>
      )}

      {/* Form Actions */}
      <div className="flex gap-4">
        <Button type="submit" disabled={loading}>
          {loading ? "Adding..." : "Add Device"}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href={`/projects/${projectId}`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
