/**
 * Live Registers Page
 *
 * Server component that fetches device data and renders the live registers view.
 * Allows real-time reading and writing of Modbus registers.
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { notFound } from "next/navigation";
import { LiveRegistersClient } from "@/components/devices/live-registers";
import type { ModbusRegister } from "@/components/devices/register-form";

interface PageProps {
  params: Promise<{
    id: string;
    siteId: string;
    deviceId: string;
  }>;
}

export default async function LiveRegistersPage({ params }: PageProps) {
  const { id: projectId, siteId, deviceId } = await params;
  const supabase = await createClient();

  // Get current user for auth
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    notFound();
  }

  // Get user profile for layout
  const { data: userProfile } = await supabase
    .from("users")
    .select("full_name, avatar_url, role, enterprise_id")
    .eq("id", user.id)
    .single();

  // Fetch site to get controller_id
  const { data: siteData } = await supabase
    .from("sites")
    .select("controller_id")
    .eq("id", siteId)
    .single();

  // Get controller_id from site or from site_master_devices
  let controllerId: string | null = siteData?.controller_id || null;

  if (!controllerId) {
    // Try to get from site_master_devices
    const { data: masterDevice } = await supabase
      .from("site_master_devices")
      .select("controller_id")
      .eq("site_id", siteId)
      .limit(1)
      .single();

    controllerId = masterDevice?.controller_id || null;
  }

  // Fetch device with template info
  const { data: deviceData, error } = await supabase
    .from("site_devices")
    .select(`
      id,
      name,
      device_type,
      is_online,
      registers,
      visualization_registers,
      alarm_registers,
      device_templates (
        name,
        brand,
        model
      )
    `)
    .eq("id", deviceId)
    .eq("site_id", siteId)
    .single();

  if (error || !deviceData) {
    notFound();
  }

  // Transform device data to match expected types
  // Note: device_templates may come back as array or object depending on Supabase version
  const rawTemplate = deviceData.device_templates as unknown;
  let device_templates: { name: string; brand: string; model: string } | null = null;

  if (rawTemplate) {
    // Handle array case (take first element) or object case
    const templateObj = Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate;
    if (templateObj && typeof templateObj === "object") {
      const t = templateObj as Record<string, unknown>;
      device_templates = {
        name: String(t.name || ""),
        brand: String(t.brand || ""),
        model: String(t.model || ""),
      };
    }
  }

  const device = {
    id: deviceData.id as string,
    name: deviceData.name as string,
    device_type: deviceData.device_type as string | null,
    is_online: deviceData.is_online as boolean,
    registers: deviceData.registers as ModbusRegister[] | null,
    visualization_registers: deviceData.visualization_registers as ModbusRegister[] | null,
    alarm_registers: deviceData.alarm_registers as ModbusRegister[] | null,
    device_templates,
  };

  return (
    <DashboardLayout
      user={{
        id: user.id,
        email: user.email,
        full_name: userProfile?.full_name || undefined,
        role: userProfile?.role || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        enterprise_id: userProfile?.enterprise_id || undefined,
      }}
    >
      <div className="p-4 md:p-6">
        <LiveRegistersClient
          device={device}
          projectId={projectId}
          siteId={siteId}
          controllerId={controllerId}
        />
      </div>
    </DashboardLayout>
  );
}
