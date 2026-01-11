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

    if (deviceError || !deviceData) {
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
