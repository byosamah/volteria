import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/controllers/[controllerId]/config
 *
 * Returns the configuration for a controller.
 * If the controller is assigned to a site, returns the full site config.
 * If not assigned, returns status "unassigned".
 *
 * Used by the on-site controller during startup to fetch its configuration.
 * This endpoint does NOT require user authentication - it uses the service key
 * provided by the controller.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ controllerId: string }> }
) {
  const { controllerId } = await params;

  try {
    const supabase = await createClient();

    // Get the controller - no auth check since controller calls this with service key
    const { data: controller, error: controllerError } = await supabase
      .from("controllers")
      .select("id, serial_number, enterprise_id")
      .eq("id", controllerId)
      .single();

    if (controllerError || !controller) {
      return NextResponse.json(
        { status: "error", message: "Controller not found" },
        { status: 404 }
      );
    }

    // Check if controller is assigned to a site via site_master_devices
    const { data: masterDevice, error: masterError } = await supabase
      .from("site_master_devices")
      .select(`
        id,
        site_id,
        controller_id,
        controller_template_id,
        sites!inner(
          id,
          name,
          location,
          description,
          project_id,
          control_method,
          grid_connection,
          operation_mode,
          dg_reserve_kw,
          control_interval_ms,
          safe_mode_enabled,
          safe_mode_type,
          safe_mode_timeout_s,
          safe_mode_rolling_window_min,
          safe_mode_threshold_pct,
          safe_mode_power_limit_kw,
          logging_local_interval_ms,
          logging_cloud_interval_ms,
          logging_local_retention_days,
          logging_cloud_enabled,
          updated_at
        )
      `)
      .eq("controller_id", controllerId)
      .maybeSingle();

    if (masterError) {
      console.error("Error checking site assignment:", masterError);
      return NextResponse.json(
        { status: "error", message: "Database error" },
        { status: 500 }
      );
    }

    if (!masterDevice) {
      // Controller not assigned to any site
      return NextResponse.json({
        status: "unassigned",
        message: "Controller is not assigned to any site",
      });
    }

    // Controller is assigned - get full site config with devices
    const site = masterDevice.sites as unknown as Record<string, unknown>;
    const siteId = site.id as string;

    // Get all devices for this site
    const { data: devices, error: devicesError } = await supabase
      .from("site_devices")
      .select(`
        id,
        name,
        device_type,
        protocol,
        host,
        port,
        gateway_ip,
        gateway_port,
        slave_id,
        rated_power_kw,
        rated_power_kva,
        registers,
        alarm_registers,
        device_templates(
          id,
          template_id,
          name,
          device_type,
          brand,
          model,
          registers,
          alarm_definitions
        )
      `)
      .eq("site_id", siteId);

    if (devicesError) {
      console.error("Error fetching devices:", devicesError);
      return NextResponse.json(
        { status: "error", message: "Failed to fetch devices" },
        { status: 500 }
      );
    }

    // Build the site config
    const siteConfig = {
      id: site.id,
      name: site.name,
      location: site.location,
      description: site.description,
      project_id: site.project_id,
      updated_at: site.updated_at,

      // Control settings
      control: {
        method: site.control_method,
        grid_connection: site.grid_connection,
        operation_mode: site.operation_mode,
        dg_reserve_kw: site.dg_reserve_kw,
        interval_ms: site.control_interval_ms,
      },

      // Safe mode settings
      safe_mode: {
        enabled: site.safe_mode_enabled,
        type: site.safe_mode_type,
        timeout_s: site.safe_mode_timeout_s,
        rolling_window_min: site.safe_mode_rolling_window_min,
        threshold_pct: site.safe_mode_threshold_pct,
        power_limit_kw: site.safe_mode_power_limit_kw,
      },

      // Logging settings
      logging: {
        local_interval_ms: site.logging_local_interval_ms,
        cloud_interval_ms: site.logging_cloud_interval_ms,
        local_retention_days: site.logging_local_retention_days,
        cloud_enabled: site.logging_cloud_enabled,
      },

      // Devices organized by type
      devices: {
        load_meters: (devices || [])
          .filter((d) => d.device_type === "load_meter")
          .map(formatDevice),
        inverters: (devices || [])
          .filter((d) => d.device_type === "inverter")
          .map(formatDevice),
        generators: (devices || [])
          .filter((d) => d.device_type === "dg")
          .map(formatDevice),
        sensors: (devices || [])
          .filter((d) => d.device_type === "sensor")
          .map(formatDevice),
      },
    };

    return NextResponse.json({
      status: "assigned",
      site: siteConfig,
    });
  } catch (error) {
    console.error("Config API error:", error);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Format a device for the controller config
 */
function formatDevice(device: Record<string, unknown>) {
  const template = device.device_templates as Record<string, unknown> | null;

  // Get registers from device-specific or template
  const registers = device.registers || template?.registers || [];
  const alarmRegisters =
    device.alarm_registers || template?.alarm_definitions || [];

  return {
    id: device.id,
    name: device.name,
    device_type: device.device_type,
    protocol: device.protocol,
    host: device.host,
    port: device.port,
    gateway_ip: device.gateway_ip,
    gateway_port: device.gateway_port,
    slave_id: device.slave_id,
    rated_power_kw: device.rated_power_kw,
    rated_power_kva: device.rated_power_kva,
    template: template?.template_id,
    brand: template?.brand,
    model: template?.model,
    registers,
    alarm_registers: alarmRegisters,
  };
}
