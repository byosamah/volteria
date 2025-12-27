/**
 * Add Device to Site Page
 *
 * Form to add a new device to a specific site:
 * - Select device template
 * - Configure connection (TCP/RTU)
 * - Set Modbus parameters
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AddDeviceForm } from "./add-device-form";

export default async function AddDeviceToSitePage({
  params,
}: {
  params: Promise<{ id: string; siteId: string }>;
}) {
  const { id, siteId } = await params;
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch user profile including avatar and role
  let userProfile: { full_name: string | null; avatar_url: string | null; role: string | null } | null = null;
  if (user?.id) {
    const { data } = await supabase
      .from("users")
      .select("full_name, avatar_url, role")
      .eq("id", user.id)
      .single();
    userProfile = data;
  }

  // Fetch project
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", id)
    .single();

  if (projectError || !project) {
    notFound();
  }

  // Fetch site
  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("id, name")
    .eq("id", siteId)
    .eq("project_id", id)
    .single();

  if (siteError || !site) {
    notFound();
  }

  // Fetch device templates (including registers for copying to device)
  // Uses logging_registers (new column name from migration 045), with registers as fallback
  let templates: Array<{
    id: string;
    template_id: string;
    name: string;
    device_type: string;
    brand: string;
    model: string;
    rated_power_kw: number | null;
    logging_registers: unknown[] | null;
    registers: unknown[] | null;  // Legacy column, for backward compatibility
    alarm_registers: unknown[] | null;
  }> = [];

  try {
    const { data } = await supabase
      .from("device_templates")
      .select("id, template_id, name, device_type, brand, model, rated_power_kw, logging_registers, registers, alarm_registers")
      .order("device_type")
      .order("brand");

    if (data) {
      templates = data;
    }
  } catch {
    // Ignore errors
  }

  return (
    <DashboardLayout user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}>
      {/* MOBILE-FRIENDLY: Responsive padding */}
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          {/* MOBILE-FRIENDLY: 44px touch target on back button */}
          <Link
            href={`/projects/${id}/sites/${siteId}`}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2 text-muted-foreground hover:text-foreground"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <div>
            {/* MOBILE-FRIENDLY: Responsive heading */}
            <h1 className="text-2xl md:text-3xl font-bold">Add Device</h1>
            <p className="text-muted-foreground text-sm md:text-base">{site.name} - {project.name}</p>
          </div>
        </div>

        {/* Form Card */}
        <Card>
          <CardHeader>
            <CardTitle>Device Configuration</CardTitle>
            <CardDescription>
              Select a device template and configure connection settings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AddDeviceForm projectId={id} siteId={siteId} templates={templates} />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
