/**
 * API Route: Individual Dashboard Widget
 *
 * PATCH /api/dashboards/[siteId]/widgets/[widgetId] - Update a widget
 * DELETE /api/dashboards/[siteId]/widgets/[widgetId] - Delete a widget
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ siteId: string; widgetId: string }> }
) {
  try {
    const { siteId, widgetId } = await params;
    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Verify widget exists and belongs to site's dashboard
    const { data: dashboard } = await supabase
      .from("site_dashboards")
      .select("id")
      .eq("site_id", siteId)
      .single();

    if (!dashboard) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }

    const { data: existingWidget } = await supabase
      .from("dashboard_widgets")
      .select("id")
      .eq("id", widgetId)
      .eq("dashboard_id", dashboard.id)
      .single();

    if (!existingWidget) {
      return NextResponse.json({ error: "Widget not found" }, { status: 404 });
    }

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};
    if (body.grid_row !== undefined) updateData.grid_row = body.grid_row;
    if (body.grid_col !== undefined) updateData.grid_col = body.grid_col;
    if (body.grid_width !== undefined) updateData.grid_width = body.grid_width;
    if (body.grid_height !== undefined) updateData.grid_height = body.grid_height;
    if (body.config !== undefined) updateData.config = body.config;
    if (body.z_index !== undefined) updateData.z_index = body.z_index;

    // Update the widget
    const { data: widget, error } = await supabase
      .from("dashboard_widgets")
      .update(updateData)
      .eq("id", widgetId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to update widget" }, { status: 500 });
    }

    return NextResponse.json(widget);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ siteId: string; widgetId: string }> }
) {
  try {
    const { siteId, widgetId } = await params;
    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify widget exists and belongs to site's dashboard
    const { data: dashboard } = await supabase
      .from("site_dashboards")
      .select("id")
      .eq("site_id", siteId)
      .single();

    if (!dashboard) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }

    const { data: existingWidget } = await supabase
      .from("dashboard_widgets")
      .select("id")
      .eq("id", widgetId)
      .eq("dashboard_id", dashboard.id)
      .single();

    if (!existingWidget) {
      return NextResponse.json({ error: "Widget not found" }, { status: 404 });
    }

    // Delete the widget
    const { error } = await supabase
      .from("dashboard_widgets")
      .delete()
      .eq("id", widgetId);

    if (error) {
      return NextResponse.json({ error: "Failed to delete widget" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
