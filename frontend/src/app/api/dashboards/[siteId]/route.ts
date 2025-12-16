/**
 * API Route: Dashboard Configuration
 *
 * GET /api/dashboards/[siteId] - Get dashboard for a site
 * POST /api/dashboards/[siteId] - Create/update dashboard
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

    // Try to fetch existing dashboard
    const { data: dashboard, error } = await supabase
      .from("site_dashboards")
      .select("*")
      .eq("site_id", siteId)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows returned (not an error for us)
      return NextResponse.json({ error: "Failed to fetch dashboard" }, { status: 500 });
    }

    if (dashboard) {
      return NextResponse.json(dashboard);
    }

    // Create default dashboard if none exists
    const { data: newDashboard, error: createError } = await supabase
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
      .select()
      .single();

    if (createError) {
      return NextResponse.json({ error: "Failed to create dashboard" }, { status: 500 });
    }

    return NextResponse.json(newDashboard);
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

    // Use upsert to create or update in a single operation
    // This eliminates the extra SELECT query to check existence
    const { data, error } = await supabase
      .from("site_dashboards")
      .upsert(
        {
          site_id: siteId,
          name: body.name || "Main Dashboard",
          grid_columns: body.grid_columns || 12,
          grid_rows: body.grid_rows || 8,
          refresh_interval_seconds: body.refresh_interval_seconds || 30,
          updated_by: user.id,
        },
        {
          onConflict: "site_id",
          ignoreDuplicates: false, // Update on conflict, don't ignore
        }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to save dashboard" }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
