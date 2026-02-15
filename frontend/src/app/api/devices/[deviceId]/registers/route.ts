/**
 * API Route: Device Registers
 *
 * Fetches the available registers for a specific device based on its template.
 * Used by the Historical Data page parameter selector.
 *
 * Returns register definitions from the device's template including:
 * - name, unit, address, datatype, scale
 * - preferred_chart_type (if set)
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

interface RegisterDefinition {
  name: string;
  address: number;
  datatype: string;
  scale: number;
  unit: string;
  access: string;
  preferred_chart_type?: string;
}

interface DeviceRegistersResponse {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  registers: RegisterDefinition[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleMasterDevice(
  supabase: any,
  deviceId: string,
  user: { id: string }
): Promise<NextResponse | null> {
  // Check site_master_devices (controllers)
  const { data: masterDevice, error: masterError } = await supabase
    .from("site_master_devices")
    .select("id, name, device_type, site_id, controller_template_id")
    .eq("id", deviceId)
    .single();

  if (masterError || !masterDevice) return null;
  if (masterDevice.device_type !== "controller") return null;

  // Access check via site → project
  const { data: siteData } = await supabase
    .from("sites")
    .select("id, project_id")
    .eq("id", masterDevice.site_id)
    .single();

  if (!siteData) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const { data: userProfile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  const isAdmin =
    userProfile?.role === "super_admin" ||
    userProfile?.role === "backend_admin";

  if (!isAdmin) {
    const { data: projectAccess } = await supabase
      .from("user_projects")
      .select("project_id")
      .eq("user_id", user.id)
      .eq("project_id", siteData.project_id)
      .single();

    if (!projectAccess) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
  }

  // Get enabled calculated fields from controller template
  const registers: RegisterDefinition[] = [];

  if (masterDevice.controller_template_id) {
    const { data: template } = await supabase
      .from("controller_templates")
      .select("calculated_fields")
      .eq("id", masterDevice.controller_template_id)
      .single();

    const enabledFieldIds: string[] = (template?.calculated_fields || [])
      .map((f: { field_id: string }) => f.field_id);

    if (enabledFieldIds.length > 0) {
      // Fetch definitions for enabled fields — only those with register_role (implemented)
      const { data: fieldDefs } = await supabase
        .from("calculated_field_definitions")
        .select("field_id, name, unit, calculation_config")
        .eq("scope", "controller")
        .eq("is_active", true)
        .in("field_id", enabledFieldIds);

      for (const def of fieldDefs || []) {
        // Only include fields that use register_role (implemented pipeline)
        const config = def.calculation_config as { register_role?: string } | null;
        if (!config?.register_role) continue;

        registers.push({
          name: def.name,
          address: 0,
          datatype: "float32",
          scale: 1,
          unit: def.unit || "",
          access: "read",
        });
      }
    }
  }

  return NextResponse.json({
    deviceId: masterDevice.id,
    deviceName: masterDevice.name,
    deviceType: masterDevice.device_type,
    registers,
  } as DeviceRegistersResponse);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  try {
    const supabase = await createClient();

    // Get current user for access control
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { deviceId } = await params;

    if (!deviceId) {
      return NextResponse.json(
        { error: "deviceId is required" },
        { status: 400 }
      );
    }

    // Fetch device with its template AND device-specific registers
    const { data: deviceData, error: deviceError } = await supabase
      .from("site_devices")
      .select(`
        id,
        name,
        site_id,
        registers,
        device_templates (
          id,
          device_type,
          registers
        )
      `)
      .eq("id", deviceId)
      .single();

    // If not found in site_devices, check site_master_devices (controller)
    if (deviceError || !deviceData) {
      const masterResponse = await handleMasterDevice(supabase, deviceId, user);
      if (masterResponse) return masterResponse;
      return NextResponse.json(
        { error: "Device not found" },
        { status: 404 }
      );
    }

    // Get site to check project access
    const { data: siteData, error: siteError } = await supabase
      .from("sites")
      .select("id, project_id")
      .eq("id", deviceData.site_id)
      .single();

    if (siteError || !siteData) {
      return NextResponse.json(
        { error: "Site not found" },
        { status: 404 }
      );
    }

    // Check user access
    const { data: userProfile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const isAdmin =
      userProfile?.role === "super_admin" ||
      userProfile?.role === "backend_admin";

    if (!isAdmin) {
      const { data: projectAccess } = await supabase
        .from("user_projects")
        .select("project_id")
        .eq("user_id", user.id)
        .eq("project_id", siteData.project_id)
        .single();

      if (!projectAccess) {
        return NextResponse.json(
          { error: "Access denied" },
          { status: 403 }
        );
      }
    }

    // Extract template info
    // Supabase returns joined data - may be an object (single) or array
    const rawTemplate = deviceData.device_templates;
    const template = (Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate) as {
      id: string;
      device_type: string;
      registers: RegisterDefinition[] | null;
    } | null;

    if (!template) {
      return NextResponse.json(
        { error: "Device template not found" },
        { status: 404 }
      );
    }

    // Parse registers - prioritize device-specific, fall back to template
    // Device-specific registers are stored in site_devices.registers
    // Template registers are stored in device_templates.registers
    let registers: RegisterDefinition[] = [];

    // Priority 1: Device-specific registers (from site_devices.registers)
    const deviceRegisters = deviceData.registers as RegisterDefinition[] | Record<string, RegisterDefinition> | null;
    // Priority 2: Template registers (from device_templates.registers)
    const templateRegisters = template?.registers;

    // Use device-specific if present and non-empty, otherwise use template
    const hasDeviceRegisters = deviceRegisters &&
      (Array.isArray(deviceRegisters) ? deviceRegisters.length > 0 : Object.keys(deviceRegisters).length > 0);

    const sourceRegisters = hasDeviceRegisters ? deviceRegisters : templateRegisters;

    if (sourceRegisters) {
      // Registers can be an array or an object with keys
      if (Array.isArray(sourceRegisters)) {
        registers = sourceRegisters;
      } else if (typeof sourceRegisters === "object") {
        // If it's an object, convert to array
        registers = Object.values(sourceRegisters);
      }
    }

    // Filter to only readable registers (exclude write-only)
    const readableRegisters = registers.filter(
      (reg) => reg.access !== "write"
    );

    const response: DeviceRegistersResponse = {
      deviceId: deviceData.id,
      deviceName: deviceData.name,
      deviceType: template.device_type,
      registers: readableRegisters.map((reg) => ({
        name: reg.name,
        address: reg.address,
        datatype: reg.datatype || "int16",
        scale: reg.scale || 1,
        unit: reg.unit || "",
        access: reg.access || "read",
        preferred_chart_type: reg.preferred_chart_type,
      })),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching device registers:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
