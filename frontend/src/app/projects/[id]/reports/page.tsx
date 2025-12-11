/**
 * Reports Dashboard Page
 *
 * ⚠️ PHASE 4 - Reporting & Analytics
 *
 * Provides analytics and reporting for project data:
 * - Energy summary (daily/weekly/monthly totals)
 * - Peak load analysis
 * - Solar efficiency metrics
 * - DG utilization statistics
 * - Export functionality (CSV)
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, BarChart3, TrendingUp, Zap, Fuel, Sun, Download } from "lucide-react";
import { EnergyConsumptionChart } from "@/components/charts/energy-consumption-chart";
import { PeakLoadChart } from "@/components/charts/peak-load-chart";
import { EfficiencyMetricsCard } from "@/components/reports/efficiency-metrics-card";
import { ExportDataButton } from "@/components/reports/export-data-button";

// Page props with project ID from URL
interface ReportsPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ReportsPage({ params }: ReportsPageProps) {
  const { id: projectId } = await params;
  const supabase = await createClient();

  // Get authenticated user
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) {
    redirect("/login");
  }

  // Get user profile with role
  const { data: userProfile } = await supabase
    .from("users")
    .select("id, email, full_name, role, avatar_url, enterprise_id")
    .eq("id", authUser.id)
    .single();

  if (!userProfile) {
    redirect("/login");
  }

  // Fetch project data
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, location")
    .eq("id", projectId)
    .single();

  if (projectError || !project) {
    notFound();
  }

  // Fetch sites for this project
  const { data: sites } = await supabase
    .from("sites")
    .select("id, name")
    .eq("project_id", projectId)
    .order("name");

  // Fetch summary statistics from control_logs (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: logsSummary } = await supabase
    .from("control_logs")
    .select("total_load_kw, solar_output_kw, dg_power_kw, solar_limit_pct, safe_mode_active")
    .eq("project_id", projectId)
    .gte("timestamp", thirtyDaysAgo.toISOString())
    .order("timestamp", { ascending: false })
    .limit(1000);

  // Calculate summary metrics
  const totalRecords = logsSummary?.length || 0;
  const avgLoad = totalRecords > 0
    ? logsSummary!.reduce((sum, log) => sum + (log.total_load_kw || 0), 0) / totalRecords
    : 0;
  const avgSolar = totalRecords > 0
    ? logsSummary!.reduce((sum, log) => sum + (log.solar_output_kw || 0), 0) / totalRecords
    : 0;
  const avgDg = totalRecords > 0
    ? logsSummary!.reduce((sum, log) => sum + (log.dg_power_kw || 0), 0) / totalRecords
    : 0;
  const avgSolarLimit = totalRecords > 0
    ? logsSummary!.reduce((sum, log) => sum + (log.solar_limit_pct || 0), 0) / totalRecords
    : 0;
  const safeModeCount = logsSummary?.filter(log => log.safe_mode_active).length || 0;
  const safeModePercentage = totalRecords > 0 ? (safeModeCount / totalRecords) * 100 : 0;

  // Calculate peak values
  const peakLoad = logsSummary?.reduce((max, log) => Math.max(max, log.total_load_kw || 0), 0) || 0;
  const peakSolar = logsSummary?.reduce((max, log) => Math.max(max, log.solar_output_kw || 0), 0) || 0;

  // Calculate solar efficiency (actual vs potential based on limit)
  const solarEfficiency = avgSolarLimit > 0 ? (avgSolarLimit / 100) * 100 : 100;

  return (
    <DashboardLayout
      user={{
        email: userProfile.email,
        full_name: userProfile.full_name,
        role: userProfile.role,
        avatar_url: userProfile.avatar_url,
        id: userProfile.id,
      }}
    >
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header with back button */}
        <div className="space-y-2">
          {/* 44px touch target for back button */}
          <Link
            href={`/projects/${projectId}`}
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] -ml-2 pl-2"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Project
          </Link>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                <BarChart3 className="h-6 w-6 md:h-8 md:w-8 text-primary" />
                Reports & Analytics
              </h1>
              <p className="text-muted-foreground">
                {project.name} - Last 30 days
              </p>
            </div>

            {/* Export button */}
            <ExportDataButton projectId={projectId} />
          </div>
        </div>

        {/* Summary Stats Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* Average Load */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <Zap className="h-4 w-4" />
                Avg. Load
              </CardDescription>
              <CardTitle className="text-2xl md:text-3xl">
                {avgLoad.toFixed(1)} <span className="text-base font-normal">kW</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Peak: {peakLoad.toFixed(1)} kW
              </p>
            </CardContent>
          </Card>

          {/* Average Solar */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <Sun className="h-4 w-4 text-yellow-500" />
                Avg. Solar
              </CardDescription>
              <CardTitle className="text-2xl md:text-3xl text-[#6baf4f]">
                {avgSolar.toFixed(1)} <span className="text-base font-normal">kW</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Peak: {peakSolar.toFixed(1)} kW
              </p>
            </CardContent>
          </Card>

          {/* Average DG */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <Fuel className="h-4 w-4 text-gray-500" />
                Avg. DG
              </CardDescription>
              <CardTitle className="text-2xl md:text-3xl text-gray-600">
                {avgDg.toFixed(1)} <span className="text-base font-normal">kW</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                DG provides backup power
              </p>
            </CardContent>
          </Card>

          {/* Solar Efficiency */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <TrendingUp className="h-4 w-4 text-green-500" />
                Solar Utilization
              </CardDescription>
              <CardTitle className="text-2xl md:text-3xl">
                {avgSolarLimit.toFixed(0)}<span className="text-base font-normal">%</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Avg. power limit applied
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Charts Grid */}
        <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
          {/* Energy Consumption Chart - Daily/Weekly/Monthly bars */}
          <EnergyConsumptionChart projectId={projectId} />

          {/* Peak Load Analysis - Time of day heatmap */}
          <PeakLoadChart projectId={projectId} />
        </div>

        {/* Efficiency Metrics */}
        <EfficiencyMetricsCard
          avgSolarLimit={avgSolarLimit}
          safeModePercentage={safeModePercentage}
          totalRecords={totalRecords}
        />

        {/* Sites breakdown (if multiple sites) */}
        {sites && sites.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Sites Overview</CardTitle>
              <CardDescription>
                Performance breakdown by site
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sites.map((site) => (
                  <Link
                    key={site.id}
                    href={`/projects/${projectId}/sites/${site.id}`}
                    className="block p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{site.name}</span>
                      <ChevronLeft className="h-4 w-4 rotate-180 text-muted-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
