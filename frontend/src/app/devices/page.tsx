/**
 * Device Templates Page
 *
 * Shows all available device templates:
 * - Inverters (Sungrow, GoodWe, Huawei)
 * - Meters (Meatrol)
 * - DG Controllers (ComAp)
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Device type badge colors
const deviceTypeColors: Record<string, string> = {
  inverter: "bg-amber-100 text-amber-800",
  load_meter: "bg-blue-100 text-blue-800",
  dg: "bg-slate-100 text-slate-800",
};

// Device type labels
const deviceTypeLabels: Record<string, string> = {
  inverter: "Solar Inverter",
  load_meter: "Load Meter",
  dg: "Generator Controller",
};

export default async function DevicesPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch device templates
  let templates: Array<{
    id: string;
    template_id: string;
    name: string;
    device_type: string;
    brand: string;
    model: string;
    rated_power_kw: number | null;
  }> = [];

  try {
    const { data, error } = await supabase
      .from("device_templates")
      .select("id, template_id, name, device_type, brand, model, rated_power_kw")
      .order("device_type")
      .order("brand");

    if (!error && data) {
      templates = data;
    }
  } catch {
    // Table might not exist yet
  }

  // Group templates by device type
  const templatesByType = templates.reduce(
    (acc, template) => {
      const type = template.device_type;
      if (!acc[type]) acc[type] = [];
      acc[type].push(template);
      return acc;
    },
    {} as Record<string, typeof templates>
  );

  return (
    <DashboardLayout user={{ email: user?.email }}>
      {/* MOBILE-FRIENDLY: Responsive padding */}
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header - responsive text sizes */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Device Templates</h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Supported devices and their Modbus configurations
          </p>
        </div>

        {/* Templates by Type */}
        {Object.keys(templatesByType).length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-muted-foreground">
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                  <path d="M12 12h.01" />
                  <path d="M17 12h.01" />
                  <path d="M7 12h.01" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">No device templates</h3>
              <p className="text-muted-foreground text-center max-w-sm">
                Device templates will be added to the database during setup.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {/* Solar Inverters */}
            {templatesByType["inverter"] && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-amber-100 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-amber-600">
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2" />
                      <path d="M12 20v2" />
                      <path d="m4.93 4.93 1.41 1.41" />
                      <path d="m17.66 17.66 1.41 1.41" />
                      <path d="M2 12h2" />
                      <path d="M20 12h2" />
                      <path d="m6.34 17.66-1.41 1.41" />
                      <path d="m19.07 4.93-1.41 1.41" />
                    </svg>
                  </div>
                  Solar Inverters
                </h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {templatesByType["inverter"].map((template) => (
                    <Card key={template.id}>
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-lg">{template.name}</CardTitle>
                            <CardDescription>
                              {template.brand} {template.model}
                            </CardDescription>
                          </div>
                          <Badge className={deviceTypeColors["inverter"]}>
                            Inverter
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="text-sm space-y-1">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Rated Power</span>
                            <span className="font-medium">
                              {template.rated_power_kw ? `${template.rated_power_kw} kW` : "N/A"}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Template ID</span>
                            <span className="font-mono text-xs">
                              {template.template_id}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Load Meters */}
            {templatesByType["load_meter"] && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-blue-600">
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                    </svg>
                  </div>
                  Load Meters
                </h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {templatesByType["load_meter"].map((template) => (
                    <Card key={template.id}>
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-lg">{template.name}</CardTitle>
                            <CardDescription>
                              {template.brand} {template.model}
                            </CardDescription>
                          </div>
                          <Badge className={deviceTypeColors["load_meter"]}>
                            Meter
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="text-sm space-y-1">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Template ID</span>
                            <span className="font-mono text-xs">
                              {template.template_id}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Generator Controllers */}
            {templatesByType["dg"] && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-slate-600">
                      <rect width="18" height="18" x="3" y="3" rx="2" />
                      <path d="M9 17v-2" />
                      <path d="M12 17v-4" />
                      <path d="M15 17v-6" />
                    </svg>
                  </div>
                  Generator Controllers
                </h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {templatesByType["dg"].map((template) => (
                    <Card key={template.id}>
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-lg">{template.name}</CardTitle>
                            <CardDescription>
                              {template.brand} {template.model}
                            </CardDescription>
                          </div>
                          <Badge className={deviceTypeColors["dg"]}>
                            Generator
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="text-sm space-y-1">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Template ID</span>
                            <span className="font-mono text-xs">
                              {template.template_id}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
