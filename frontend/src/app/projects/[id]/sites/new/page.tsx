/**
 * New Site Page
 *
 * Multi-step wizard to create a new site within a project.
 * Sites are physical locations with one controller each.
 *
 * Steps:
 * 1. Basic Information (name, location, description)
 * 2. Control Method (on-site controller vs gateway API)
 * 3. Grid & Operation Mode (off-grid, operation mode)
 * 4. Control Settings (DG reserve, control interval)
 * 5. Logging Settings (intervals, retention, cloud sync)
 * 6. Safe Mode Settings (timeout, thresholds)
 * 7. Review & Create (summary with edit links)
 */

"use client";

import { use } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { SiteCreationWizard } from "./site-creation-wizard";

export default function NewSitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Unwrap the params Promise using React.use()
  const { id: projectId } = use(params);

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <SiteCreationWizard projectId={projectId} />
      </div>
    </DashboardLayout>
  );
}
