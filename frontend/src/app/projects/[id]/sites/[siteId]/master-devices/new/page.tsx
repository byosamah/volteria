/**
 * Add Master Device Page
 *
 * Form to add a controller or gateway to a site.
 * - Controller: Select from enterprise's claimed controllers
 * - Gateway: Netbiter or other API gateway with credentials
 */

"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import type { ControllerTemplate } from "@/lib/types";

// ============================================
// TYPES
// ============================================

type DeviceType = "controller" | "gateway";
type GatewayType = "netbiter" | "other";

interface AvailableController {
  id: string;
  serial_number: string;
  firmware_version: string | null;
  status: string;
  approved_hardware?: {
    name: string;
    manufacturer: string;
  } | null;
}

// Available controller templates (filtered by visibility)
interface AvailableTemplate {
  id: string;
  template_id: string;
  name: string;
  controller_type: string;
  template_type: "public" | "custom";
  brand: string | null;
  model: string | null;
  calculated_fields?: string[] | null;
}

// Calculated field definition
interface CalculatedFieldDef {
  field_id: string;
  name: string;
  description: string | null;
  unit: string | null;
  calculation_type: string;
  time_window: string | null;
}

// ============================================
// COMPONENT
// ============================================

export default function AddMasterDevicePage({
  params,
}: {
  params: Promise<{ id: string; siteId: string }>;
}) {
  const { id: projectId, siteId } = use(params);
  const router = useRouter();

  // Form state
  const [deviceType, setDeviceType] = useState<DeviceType>("controller");
  const [name, setName] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [port, setPort] = useState("");

  // Controller-specific
  const [controllerId, setControllerId] = useState("");
  const [availableControllers, setAvailableControllers] = useState<AvailableController[]>([]);
  const [loadingControllers, setLoadingControllers] = useState(true);
  const [hasExistingController, setHasExistingController] = useState(false);

  // Controller template selection
  const [templateId, setTemplateId] = useState("");
  const [availableTemplates, setAvailableTemplates] = useState<AvailableTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  // Modbus settings (for controllers)
  const [modbusPhysical, setModbusPhysical] = useState("RS-485");
  const [modbusBaudRate, setModbusBaudRate] = useState("9600");
  const [modbusParity, setModbusParity] = useState("none");
  const [modbusStopBits, setModbusStopBits] = useState("1");
  const [modbusFrameType, setModbusFrameType] = useState("RTU");
  const [modbusExtraDelay, setModbusExtraDelay] = useState("0");
  const [modbusSlaveTimeout, setModbusSlaveTimeout] = useState("1000");
  const [modbusWriteFunction, setModbusWriteFunction] = useState("auto");

  // Calculated fields
  const [selectedCalculatedFields, setSelectedCalculatedFields] = useState<string[]>([]);
  const [availableCalculatedFields, setAvailableCalculatedFields] = useState<CalculatedFieldDef[]>([]);
  const [loadingCalculatedFields, setLoadingCalculatedFields] = useState(false);

  // Gateway-specific
  const [gatewayType, setGatewayType] = useState<GatewayType>("netbiter");
  const [netbiterAccountId, setNetbiterAccountId] = useState("");
  const [netbiterUsername, setNetbiterUsername] = useState("");
  const [netbiterPassword, setNetbiterPassword] = useState("");
  const [netbiterSystemId, setNetbiterSystemId] = useState("");
  const [gatewayApiUrl, setGatewayApiUrl] = useState("");
  const [gatewayApiKey, setGatewayApiKey] = useState("");
  const [gatewayApiSecret, setGatewayApiSecret] = useState("");

  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load available controllers, templates, and check if site already has one
  useEffect(() => {
    async function loadData() {
      setLoadingControllers(true);
      setLoadingTemplates(true);
      const supabase = createClient();

      try {
        // Get current user's role
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: userProfile } = await supabase
          .from("users")
          .select("enterprise_id, role")
          .eq("id", user.id)
          .single();

        // Get the project's enterprise_id (use this to filter controllers)
        // This ensures super admins can only add controllers from the project's enterprise
        const { data: project } = await supabase
          .from("projects")
          .select("enterprise_id")
          .eq("id", projectId)
          .single();

        // Determine which enterprise_id to use for filtering controllers
        // - Use project's enterprise_id (controllers must belong to same enterprise as project)
        // - For enterprise_admin/configurator: must match their own enterprise anyway
        const projectEnterpriseId = project?.enterprise_id;

        if (!projectEnterpriseId) {
          // Project doesn't have an enterprise assigned
          setAvailableControllers([]);
          setAvailableTemplates([]);
          return;
        }

        // Check if site already has a controller
        const { data: existingMaster } = await supabase
          .from("site_master_devices")
          .select("id")
          .eq("site_id", siteId)
          .eq("device_type", "controller")
          .eq("is_active", true)
          .single();

        if (existingMaster) {
          setHasExistingController(true);
          // If site already has a controller, default to gateway
          setDeviceType("gateway");
        }

        // Fetch available controllers from the PROJECT's enterprise (not user's enterprise)
        // Controllers with 'claimed' status are owned by enterprise but not yet on a site
        const { data: controllers } = await supabase
          .from("controllers")
          .select(`
            id,
            serial_number,
            firmware_version,
            status,
            approved_hardware (
              name,
              manufacturer
            )
          `)
          .eq("enterprise_id", projectEnterpriseId)
          .is("site_id", null)
          .eq("status", "claimed");

        if (controllers) {
          setAvailableControllers(controllers as unknown as AvailableController[]);
        }

        // Fetch available controller templates
        // Visibility rules:
        // - super_admin/backend_admin see all templates
        // - Others see: public templates + project's enterprise's custom templates
        const isSuperAdmin = ["super_admin", "backend_admin"].includes(userProfile?.role || "");

        let templatesQuery = supabase
          .from("controller_templates")
          .select("id, template_id, name, controller_type, template_type, brand, model, calculated_fields")
          .eq("is_active", true)
          .order("name");

        if (!isSuperAdmin) {
          // Filter: public templates OR custom templates from project's enterprise
          templatesQuery = templatesQuery.or(`template_type.eq.public,enterprise_id.eq.${projectEnterpriseId}`);
        }

        const { data: templates } = await templatesQuery;
        if (templates) {
          setAvailableTemplates(templates as AvailableTemplate[]);
        }
      } catch (err) {
        console.error("Failed to load data:", err);
      } finally {
        setLoadingControllers(false);
        setLoadingTemplates(false);
      }
    }

    loadData();
  }, [projectId, siteId]);

  // Fetch calculated field definitions when template changes
  useEffect(() => {
    async function loadCalculatedFields() {
      if (!templateId) {
        setAvailableCalculatedFields([]);
        setSelectedCalculatedFields([]);
        return;
      }

      setLoadingCalculatedFields(true);
      const supabase = createClient();

      try {
        // Get the selected template's calculated fields array
        const selectedTemplate = availableTemplates.find(t => t.id === templateId);
        const templateFieldIds = selectedTemplate?.calculated_fields || [];

        if (templateFieldIds.length === 0) {
          setAvailableCalculatedFields([]);
          setSelectedCalculatedFields([]);
          return;
        }

        // Fetch the field definitions for these IDs
        const { data: fieldDefs } = await supabase
          .from("calculated_field_definitions")
          .select("field_id, name, description, unit, calculation_type, time_window")
          .in("field_id", templateFieldIds);

        if (fieldDefs) {
          setAvailableCalculatedFields(fieldDefs);
          // Pre-select all fields by default
          setSelectedCalculatedFields(fieldDefs.map(f => f.field_id));
        }
      } catch (err) {
        console.error("Failed to load calculated fields:", err);
      } finally {
        setLoadingCalculatedFields(false);
      }
    }

    loadCalculatedFields();
  }, [templateId, availableTemplates]);

  // Handle form submission
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const supabase = createClient();

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("You must be logged in");
      }

      // Validate based on device type
      if (deviceType === "controller") {
        if (!controllerId) {
          throw new Error("Please select a controller");
        }
        // Template is optional - users can add a device without a template
        if (!ipAddress.trim()) {
          throw new Error("IP address is required for controllers");
        }
        if (!port.trim()) {
          throw new Error("Port is required for controllers");
        }
      } else if (deviceType === "gateway" && gatewayType === "netbiter") {
        if (!netbiterAccountId.trim()) {
          throw new Error("Netbiter Account ID is required");
        }
        if (!netbiterUsername.trim()) {
          throw new Error("Netbiter Username is required");
        }
        if (!netbiterPassword.trim()) {
          throw new Error("Netbiter Password is required");
        }
      }

      // Build insert data
      const insertData: Record<string, unknown> = {
        site_id: siteId,
        device_type: deviceType,
        name: name.trim(),
        ip_address: ipAddress.trim() || null,
        port: port ? parseInt(port) : null,
        created_by: user.id,
      };

      if (deviceType === "controller") {
        insertData.controller_id = controllerId;
        // Only include controller_template_id if a template is selected
        // (empty string would fail foreign key constraint)
        if (templateId) {
          insertData.controller_template_id = templateId;
        }

        // Add Modbus settings
        insertData.modbus_physical = modbusPhysical;
        insertData.modbus_baud_rate = parseInt(modbusBaudRate);
        insertData.modbus_parity = modbusParity;
        insertData.modbus_stop_bits = parseInt(modbusStopBits);
        insertData.modbus_frame_type = modbusFrameType;
        insertData.modbus_extra_delay = parseInt(modbusExtraDelay);
        insertData.modbus_slave_timeout = parseInt(modbusSlaveTimeout);
        insertData.modbus_write_function = modbusWriteFunction;

        // Add calculated fields selection
        insertData.calculated_fields = selectedCalculatedFields.map(id => ({
          field_id: id,
          enabled: true,
          storage_mode: "log"
        }));
      } else {
        insertData.gateway_type = gatewayType;
        if (gatewayType === "netbiter") {
          insertData.netbiter_account_id = netbiterAccountId.trim();
          insertData.netbiter_username = netbiterUsername.trim();
          insertData.netbiter_password = netbiterPassword.trim();
          insertData.netbiter_system_id = netbiterSystemId.trim() || null;
        } else {
          insertData.gateway_api_url = gatewayApiUrl.trim() || null;
          insertData.gateway_api_key = gatewayApiKey.trim() || null;
          insertData.gateway_api_secret = gatewayApiSecret.trim() || null;
        }
      }

      const { error: insertError } = await supabase
        .from("site_master_devices")
        .insert(insertData);

      if (insertError) throw insertError;

      toast.success("Master device added successfully");
      router.push(`/projects/${projectId}/sites/${siteId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add device";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Get selected controller details
  const selectedController = availableControllers.find((c) => c.id === controllerId);

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-2xl mx-auto">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Link
              href={`/projects/${projectId}/sites/${siteId}`}
              className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </Link>
            <h1 className="text-2xl md:text-3xl font-bold">Add Master Device</h1>
          </div>
          <p className="text-muted-foreground text-sm md:text-base">
            Add a controller or gateway to manage this site
          </p>
        </div>

        {/* Form Card */}
        <Card>
          <CardHeader>
            <CardTitle>Device Configuration</CardTitle>
            <CardDescription>
              Choose the type of master device to add
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Device Type Selection */}
              <div className="space-y-3">
                <Label>Device Type <span className="text-red-500">*</span></Label>
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Controller Option */}
                  <button
                    type="button"
                    onClick={() => !hasExistingController && setDeviceType("controller")}
                    disabled={hasExistingController}
                    className={`
                      p-4 rounded-lg border-2 text-left transition-all
                      ${hasExistingController
                        ? "border-muted bg-muted/30 opacity-60 cursor-not-allowed"
                        : deviceType === "controller"
                          ? "border-primary bg-primary/5"
                          : "border-muted hover:border-muted-foreground/50"
                      }
                    `}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`
                        w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5
                        ${deviceType === "controller" && !hasExistingController
                          ? "border-primary"
                          : "border-muted-foreground/50"
                        }
                      `}>
                        {deviceType === "controller" && !hasExistingController && (
                          <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-blue-500">
                            <rect width="20" height="14" x="2" y="3" rx="2"/>
                            <line x1="8" x2="16" y1="21" y2="21"/>
                            <line x1="12" x2="12" y1="17" y2="21"/>
                          </svg>
                          <span className="font-semibold">Controller</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">
                          On-site controller that runs control logic locally.
                        </p>
                        {hasExistingController && (
                          <p className="text-xs text-amber-600 mt-2">
                            This site already has a controller
                          </p>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Gateway Option */}
                  <button
                    type="button"
                    onClick={() => setDeviceType("gateway")}
                    className={`
                      p-4 rounded-lg border-2 text-left transition-all
                      ${deviceType === "gateway"
                        ? "border-primary bg-primary/5"
                        : "border-muted hover:border-muted-foreground/50"
                      }
                    `}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`
                        w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5
                        ${deviceType === "gateway"
                          ? "border-primary"
                          : "border-muted-foreground/50"
                        }
                      `}>
                        {deviceType === "gateway" && (
                          <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-orange-500">
                            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
                          </svg>
                          <span className="font-semibold">Gateway</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">
                          Netbiter or other API gateway for remote control.
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Controller Fields */}
              {deviceType === "controller" && (
                <div className="space-y-4 border-t pt-6">
                  {/* Select Controller */}
                  <div className="space-y-2">
                    <Label htmlFor="controller">
                      Select Controller <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={controllerId}
                      onValueChange={setControllerId}
                      disabled={loadingControllers}
                    >
                      <SelectTrigger className="min-h-[44px]">
                        <SelectValue placeholder={
                          loadingControllers
                            ? "Loading controllers..."
                            : availableControllers.length === 0
                              ? "No available controllers"
                              : "Select a controller"
                        } />
                      </SelectTrigger>
                      <SelectContent>
                        {availableControllers.map((controller) => (
                          <SelectItem key={controller.id} value={controller.id}>
                            <div className="flex items-center gap-2">
                              <span>{controller.serial_number}</span>
                              {controller.approved_hardware?.name && (
                                <span className="text-muted-foreground">
                                  ({controller.approved_hardware.name})
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {availableControllers.length === 0 && !loadingControllers && (
                      <p className="text-xs text-amber-600">
                        No controllers available. Claim a controller first from the Admin panel.
                      </p>
                    )}
                    {selectedController && (
                      <p className="text-xs text-muted-foreground">
                        Firmware: {selectedController.firmware_version || "Unknown"}
                      </p>
                    )}
                  </div>

                  {/* Select Controller Template */}
                  <div className="space-y-2">
                    <Label htmlFor="template">
                      Controller Template (optional)
                    </Label>
                    <Select
                      value={templateId}
                      onValueChange={setTemplateId}
                      disabled={loadingTemplates}
                    >
                      <SelectTrigger className="min-h-[44px]">
                        <SelectValue placeholder={
                          loadingTemplates
                            ? "Loading templates..."
                            : availableTemplates.length === 0
                              ? "No available templates"
                              : "Select a template"
                        } />
                      </SelectTrigger>
                      <SelectContent>
                        {availableTemplates.map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            <div className="flex items-center gap-2">
                              <span>{template.name}</span>
                              {/* Public/Custom badge */}
                              <span className={`
                                text-xs px-1.5 py-0.5 rounded-full
                                ${template.template_type === "public"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-blue-100 text-blue-700"
                                }
                              `}>
                                {template.template_type === "public" ? "Public" : "Custom"}
                              </span>
                              {/* Brand/Model info */}
                              {(template.brand || template.model) && (
                                <span className="text-muted-foreground text-xs">
                                  {[template.brand, template.model].filter(Boolean).join(" ")}
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {availableTemplates.length === 0 && !loadingTemplates && (
                      <p className="text-xs text-amber-600">
                        No controller templates available. Create one on the Device Templates page.
                      </p>
                    )}
                    {templateId && availableTemplates.find(t => t.id === templateId) && (
                      <p className="text-xs text-muted-foreground">
                        Type: {availableTemplates.find(t => t.id === templateId)?.controller_type || "N/A"}
                      </p>
                    )}
                  </div>

                  {/* Name */}
                  <div className="space-y-2">
                    <Label htmlFor="name">
                      Display Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., Main Controller"
                      className="min-h-[44px]"
                      required
                    />
                  </div>

                  {/* IP Address */}
                  <div className="space-y-2">
                    <Label htmlFor="ip">
                      IP Address <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="ip"
                      value={ipAddress}
                      onChange={(e) => setIpAddress(e.target.value)}
                      placeholder="e.g., 192.168.1.100"
                      className="min-h-[44px]"
                      required
                    />
                  </div>

                  {/* Port */}
                  <div className="space-y-2">
                    <Label htmlFor="port">
                      Port <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="port"
                      type="number"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      placeholder="e.g., 502"
                      className="min-h-[44px]"
                      required
                    />
                  </div>

                  {/* Modbus Settings Section */}
                  <div className="space-y-4 border-t pt-6">
                    <h4 className="font-medium">Modbus Settings</h4>
                    <div className="grid grid-cols-2 gap-4">
                      {/* Physical */}
                      <div className="space-y-2">
                        <Label>Physical</Label>
                        <Select value={modbusPhysical} onValueChange={setModbusPhysical}>
                          <SelectTrigger className="min-h-[44px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="RS-485">RS-485</SelectItem>
                            <SelectItem value="RS-232">RS-232</SelectItem>
                            <SelectItem value="TCP">TCP</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Baud Rate */}
                      <div className="space-y-2">
                        <Label>Baud Rate</Label>
                        <Select value={modbusBaudRate} onValueChange={setModbusBaudRate}>
                          <SelectTrigger className="min-h-[44px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="9600">9600 bps</SelectItem>
                            <SelectItem value="19200">19200 bps</SelectItem>
                            <SelectItem value="38400">38400 bps</SelectItem>
                            <SelectItem value="57600">57600 bps</SelectItem>
                            <SelectItem value="115200">115200 bps</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Parity */}
                      <div className="space-y-2">
                        <Label>Parity</Label>
                        <Select value={modbusParity} onValueChange={setModbusParity}>
                          <SelectTrigger className="min-h-[44px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="even">Even</SelectItem>
                            <SelectItem value="odd">Odd</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Stop Bits */}
                      <div className="space-y-2">
                        <Label>Stop Bits</Label>
                        <Select value={modbusStopBits} onValueChange={setModbusStopBits}>
                          <SelectTrigger className="min-h-[44px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1</SelectItem>
                            <SelectItem value="2">2</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Frame Type */}
                      <div className="space-y-2">
                        <Label>Frame Type</Label>
                        <Select value={modbusFrameType} onValueChange={setModbusFrameType}>
                          <SelectTrigger className="min-h-[44px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="RTU">RTU</SelectItem>
                            <SelectItem value="ASCII">ASCII</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Extra Delay */}
                      <div className="space-y-2">
                        <Label>Extra Delay</Label>
                        <Select value={modbusExtraDelay} onValueChange={setModbusExtraDelay}>
                          <SelectTrigger className="min-h-[44px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">None</SelectItem>
                            <SelectItem value="10">10 ms</SelectItem>
                            <SelectItem value="50">50 ms</SelectItem>
                            <SelectItem value="100">100 ms</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Slave Timeout */}
                      <div className="space-y-2">
                        <Label>Slave Timeout</Label>
                        <Select value={modbusSlaveTimeout} onValueChange={setModbusSlaveTimeout}>
                          <SelectTrigger className="min-h-[44px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="500">500 ms</SelectItem>
                            <SelectItem value="1000">1000 ms</SelectItem>
                            <SelectItem value="2000">2000 ms</SelectItem>
                            <SelectItem value="5000">5000 ms</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Write Function */}
                      <div className="space-y-2">
                        <Label>Write Function</Label>
                        <Select value={modbusWriteFunction} onValueChange={setModbusWriteFunction}>
                          <SelectTrigger className="min-h-[44px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto</SelectItem>
                            <SelectItem value="single">Single (FC6)</SelectItem>
                            <SelectItem value="multiple">Multiple (FC16)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  {/* Calculated Fields Section */}
                  {templateId && availableCalculatedFields.length > 0 && (
                    <div className="space-y-4 border-t pt-6">
                      <div className="space-y-1">
                        <h4 className="font-medium">Calculated Fields</h4>
                        <p className="text-sm text-muted-foreground">
                          Select which calculated fields to enable for this controller
                        </p>
                      </div>

                      {loadingCalculatedFields ? (
                        <div className="text-sm text-muted-foreground">Loading fields...</div>
                      ) : (
                        <div className="space-y-2">
                          {availableCalculatedFields.map((field) => (
                            <div
                              key={field.field_id}
                              className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20"
                            >
                              <Checkbox
                                id={field.field_id}
                                checked={selectedCalculatedFields.includes(field.field_id)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedCalculatedFields([...selectedCalculatedFields, field.field_id]);
                                  } else {
                                    setSelectedCalculatedFields(selectedCalculatedFields.filter(id => id !== field.field_id));
                                  }
                                }}
                              />
                              <div className="flex-1 min-w-0">
                                <label
                                  htmlFor={field.field_id}
                                  className="font-medium text-sm cursor-pointer"
                                >
                                  {field.name}
                                </label>
                                {field.description && (
                                  <p className="text-xs text-muted-foreground truncate">
                                    {field.description}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {field.unit && (
                                  <Badge variant="outline" className="text-xs">
                                    {field.unit}
                                  </Badge>
                                )}
                                <Badge variant="secondary" className="text-xs">
                                  {field.calculation_type}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Gateway Fields */}
              {deviceType === "gateway" && (
                <div className="space-y-4 border-t pt-6">
                  {/* Gateway Type */}
                  <div className="space-y-2">
                    <Label htmlFor="gateway-type">
                      Gateway Type <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={gatewayType}
                      onValueChange={(v) => setGatewayType(v as GatewayType)}
                    >
                      <SelectTrigger className="min-h-[44px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="netbiter">Netbiter</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Name */}
                  <div className="space-y-2">
                    <Label htmlFor="gateway-name">
                      Display Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="gateway-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., Site Gateway"
                      className="min-h-[44px]"
                      required
                    />
                  </div>

                  {/* IP Address (optional for gateways) */}
                  <div className="space-y-2">
                    <Label htmlFor="gateway-ip">IP Address</Label>
                    <Input
                      id="gateway-ip"
                      value={ipAddress}
                      onChange={(e) => setIpAddress(e.target.value)}
                      placeholder="e.g., 192.168.1.50"
                      className="min-h-[44px]"
                    />
                  </div>

                  {/* Port (optional for gateways) */}
                  <div className="space-y-2">
                    <Label htmlFor="gateway-port">Port</Label>
                    <Input
                      id="gateway-port"
                      type="number"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      placeholder="e.g., 443"
                      className="min-h-[44px]"
                    />
                  </div>

                  {/* Netbiter Credentials */}
                  {gatewayType === "netbiter" && (
                    <div className="space-y-4 border-t pt-4">
                      <h4 className="font-medium text-sm">Netbiter API Credentials</h4>

                      <div className="space-y-2">
                        <Label htmlFor="netbiter-account">
                          Account ID <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="netbiter-account"
                          value={netbiterAccountId}
                          onChange={(e) => setNetbiterAccountId(e.target.value)}
                          placeholder="Enter your Netbiter account ID"
                          className="min-h-[44px]"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="netbiter-username">
                          Username <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="netbiter-username"
                          value={netbiterUsername}
                          onChange={(e) => setNetbiterUsername(e.target.value)}
                          placeholder="API username"
                          className="min-h-[44px]"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="netbiter-password">
                          Password <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="netbiter-password"
                          type="password"
                          value={netbiterPassword}
                          onChange={(e) => setNetbiterPassword(e.target.value)}
                          placeholder="API password"
                          className="min-h-[44px]"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="netbiter-system">System ID</Label>
                        <Input
                          id="netbiter-system"
                          value={netbiterSystemId}
                          onChange={(e) => setNetbiterSystemId(e.target.value)}
                          placeholder="Optional: Netbiter system/device ID"
                          className="min-h-[44px]"
                        />
                      </div>
                    </div>
                  )}

                  {/* Other Gateway Credentials */}
                  {gatewayType === "other" && (
                    <div className="space-y-4 border-t pt-4">
                      <h4 className="font-medium text-sm">Gateway API Credentials</h4>

                      <div className="space-y-2">
                        <Label htmlFor="api-url">API URL</Label>
                        <Input
                          id="api-url"
                          value={gatewayApiUrl}
                          onChange={(e) => setGatewayApiUrl(e.target.value)}
                          placeholder="https://api.example.com"
                          className="min-h-[44px]"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="api-key">API Key</Label>
                        <Input
                          id="api-key"
                          value={gatewayApiKey}
                          onChange={(e) => setGatewayApiKey(e.target.value)}
                          placeholder="Enter API key"
                          className="min-h-[44px]"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="api-secret">API Secret</Label>
                        <Input
                          id="api-secret"
                          type="password"
                          value={gatewayApiSecret}
                          onChange={(e) => setGatewayApiSecret(e.target.value)}
                          placeholder="Enter API secret"
                          className="min-h-[44px]"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">
                  {error}
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex gap-3 justify-end pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push(`/projects/${projectId}/sites/${siteId}`)}
                  disabled={isSubmitting}
                  className="min-h-[44px]"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || !name.trim() || (deviceType === "controller" && !controllerId)}
                  className="min-h-[44px]"
                >
                  {isSubmitting ? "Adding..." : "Add Device"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
