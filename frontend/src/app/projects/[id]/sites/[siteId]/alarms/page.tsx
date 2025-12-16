/**
 * Site Alarm Configuration Page
 *
 * Allows users to view and customize alarm thresholds for a site.
 * Shows alarms from:
 * - Controller template (if site has a controller)
 * - Device templates for devices in the site
 *
 * Users with can_edit permission can:
 * - Enable/disable alarms
 * - Override threshold conditions
 * - Reset to default values
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { SiteAlarmConfig } from "./site-alarm-config";
import type { AlarmDefinition, SiteAlarmOverride } from "@/lib/types";

// Combined alarm source with template info
interface AlarmSource {
  source_type: "controller_template" | "device_template" | "device";
  source_id: string;
  source_name: string; // Template or device name for display
  alarms: AlarmDefinition[];
}

export default async function SiteAlarmsPage({
  params,
}: {
  params: Promise<{ id: string; siteId: string }>;
}) {
  const { id: projectId, siteId } = await params;
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch user profile including role and permissions
  let userProfile: {
    full_name: string | null;
    avatar_url: string | null;
    role: string | null;
  } | null = null;
  let canEdit = false;

  if (user?.id) {
    const { data } = await supabase
      .from("users")
      .select("full_name, avatar_url, role")
      .eq("id", user.id)
      .single();
    userProfile = data;

    // Super admin and admin can always edit
    if (userProfile?.role === "super_admin" || userProfile?.role === "admin") {
      canEdit = true;
    } else {
      // Check user_projects for can_edit permission
      const { data: userProject } = await supabase
        .from("user_projects")
        .select("can_edit")
        .eq("user_id", user.id)
        .eq("project_id", projectId)
        .single();
      canEdit = userProject?.can_edit ?? false;
    }
  }

  // Fetch site with controller info
  const { data: site, error } = await supabase
    .from("sites")
    .select(`
      id,
      name,
      project_id,
      controller_serial_number
    `)
    .eq("id", siteId)
    .single();

  if (error || !site) {
    notFound();
  }

  // Fetch project for breadcrumb
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();

  // Collect all alarm sources
  const alarmSources: AlarmSource[] = [];

  // 1. Get controller template alarms if site has a controller
  if (site.controller_serial_number) {
    // Find controller and its template
    const { data: controller } = await supabase
      .from("controllers_master")
      .select(`
        id,
        hardware_type_id,
        approved_hardware (
          name
        )
      `)
      .eq("serial_number", site.controller_serial_number)
      .single();

    if (controller?.hardware_type_id) {
      // Find controller template for this hardware type
      const { data: controllerTemplate } = await supabase
        .from("controller_templates")
        .select("id, name, alarm_definitions")
        .eq("hardware_type_id", controller.hardware_type_id)
        .eq("is_active", true)
        .single();

      if (
        controllerTemplate &&
        controllerTemplate.alarm_definitions &&
        Array.isArray(controllerTemplate.alarm_definitions) &&
        controllerTemplate.alarm_definitions.length > 0
      ) {
        alarmSources.push({
          source_type: "controller_template",
          source_id: controllerTemplate.id,
          source_name: controllerTemplate.name,
          alarms: controllerTemplate.alarm_definitions as AlarmDefinition[],
        });
      }
    }
  }

  // 2. Get device template alarms for all devices in this site
  const { data: siteDevices } = await supabase
    .from("project_devices")
    .select(`
      id,
      name,
      template_id,
      device_templates (
        id,
        name,
        alarm_definitions
      )
    `)
    .eq("site_id", siteId)
    .eq("enabled", true);

  if (siteDevices) {
    // Group devices by template to avoid duplicates
    const templateMap = new Map<string, { name: string; alarms: AlarmDefinition[] }>();

    for (const device of siteDevices) {
      // Supabase returns joined relations - handle both single and array cases
      const rawTemplate = device.device_templates;
      const template = (
        Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate
      ) as {
        id: string;
        name: string;
        alarm_definitions: AlarmDefinition[] | null;
      } | null;

      if (template?.alarm_definitions?.length && !templateMap.has(template.id)) {
        templateMap.set(template.id, {
          name: template.name,
          alarms: template.alarm_definitions,
        });
      }
    }

    // Add device template sources
    for (const [templateId, { name, alarms }] of templateMap) {
      alarmSources.push({
        source_type: "device_template",
        source_id: templateId,
        source_name: name,
        alarms,
      });
    }
  }

  // 3. Fetch existing site alarm overrides
  let siteOverrides: SiteAlarmOverride[] = [];
  try {
    const { data: overrides } = await supabase
      .from("site_alarm_overrides")
      .select("*")
      .eq("site_id", siteId);

    if (overrides) {
      siteOverrides = overrides as SiteAlarmOverride[];
    }
  } catch {
    // Table might not exist yet
  }

  // Count stats
  const totalAlarms = alarmSources.reduce((sum, s) => sum + s.alarms.length, 0);
  const customizedCount = siteOverrides.filter((o) => o.conditions_override || o.enabled !== null).length;

  return (
    <DashboardLayout
      user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}
    >
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header with back button */}
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${projectId}/sites/${siteId}`}
            className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Alarm Configuration</h1>
            <p className="text-muted-foreground text-sm md:text-base">
              {project?.name} / {site.name}
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Alarms</CardDescription>
              <CardTitle className="text-3xl">{totalAlarms}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Customized</CardDescription>
              <CardTitle className="text-3xl text-blue-600">{customizedCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Sources</CardDescription>
              <CardTitle className="text-3xl text-amber-600">{alarmSources.length}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* No alarms state */}
        {alarmSources.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-6 w-6 text-muted-foreground"
                >
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">No alarms configured</h3>
              <p className="text-muted-foreground text-center max-w-sm">
                This site has no controller or device templates with alarm definitions.
                Add devices or configure a controller to enable alarm monitoring.
              </p>
            </CardContent>
          </Card>
        ) : (
          <SiteAlarmConfig
            siteId={siteId}
            alarmSources={alarmSources}
            existingOverrides={siteOverrides}
            canEdit={canEdit}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
