/**
 * API Route: Dashboard Widgets
 *
 * GET /api/dashboards/[siteId]/widgets - List all widgets for a site's dashboard
 * POST /api/dashboards/[siteId]/widgets - Add a new widget
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await params;
    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get dashboard for site
    const { data: dashboard } = await supabase
      .from("site_dashboards")
      .select("id")
      .eq("site_id", siteId)
      .single();

    if (!dashboard) {
      return NextResponse.json({ widgets: [] });
    }

    // Get all widgets for this dashboard
    const { data: widgets, error } = await supabase
      .from("dashboard_widgets")
      .select("*")
      .eq("dashboard_id", dashboard.id)
      .order("z_index", { ascending: true });

    if (error) {
      return NextResponse.json({ error: "Failed to fetch widgets" }, { status: 500 });
    }

    return NextResponse.json({ widgets: widgets || [] });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await params;
    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Get or create dashboard for site
    let { data: dashboard } = await supabase
      .from("site_dashboards")
      .select("id")
      .eq("site_id", siteId)
      .single();

    if (!dashboard) {
      // Create default dashboard
      const { data: newDashboard, error: createDashboardError } = await supabase
        .from("site_dashboards")
        .insert({
          site_id: siteId,
          name: "Main Dashboard",
          grid_columns: 12,
          grid_rows: 8,
          refresh_interval_seconds: 30,
          created_by: user.id,
          updated_by: user.id,
        })
        .select("id")
        .single();

      if (createDashboardError) {
        return NextResponse.json({ error: "Failed to create dashboard" }, { status: 500 });
      }
      dashboard = newDashboard;
    }

    // Check widget count limit (max 30)
    const { count } = await supabase
      .from("dashboard_widgets")
      .select("*", { count: "exact", head: true })
      .eq("dashboard_id", dashboard.id);

    if (count && count >= 30) {
      return NextResponse.json(
        { error: "Maximum widget limit (30) reached" },
        { status: 400 }
      );
    }

    // Create the widget
    const { data: widget, error } = await supabase
      .from("dashboard_widgets")
      .insert({
        dashboard_id: dashboard.id,
        widget_type: body.widget_type,
        grid_row: body.grid_row || 1,
        grid_col: body.grid_col || 1,
        grid_width: body.grid_width || 2,
        grid_height: body.grid_height || 2,
        config: body.config || {},
        z_index: body.z_index || 0,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to create widget" }, { status: 500 });
    }

    return NextResponse.json(widget);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
