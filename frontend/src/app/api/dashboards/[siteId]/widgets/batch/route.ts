/**
 * API Route: Batch Widget Update
 *
 * PUT /api/dashboards/[siteId]/widgets/batch - Batch update widget positions
 *
 * Used when user drags/drops multiple widgets or rearranges the layout.
 * Accepts an array of widget position updates.
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

interface WidgetPositionUpdate {
  id: string;
  grid_row: number;
  grid_col: number;
  grid_width?: number;
  grid_height?: number;
  z_index?: number;
}

export async function PUT(
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
    const updates: WidgetPositionUpdate[] = body.widgets || [];
    const gridColumns: number | undefined = body.grid_columns;
    const gridRows: number | undefined = body.grid_rows;

    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: "No widget updates provided" }, { status: 400 });
    }

    // Verify dashboard exists for this site
    const { data: dashboard } = await supabase
      .from("site_dashboards")
      .select("id")
      .eq("site_id", siteId)
      .single();

    if (!dashboard) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }

    // Update dashboard grid dimensions if provided
    if (gridColumns !== undefined && gridRows !== undefined) {
      await supabase
        .from("site_dashboards")
        .update({ grid_columns: gridColumns, grid_rows: gridRows })
        .eq("id", dashboard.id);
    }

    // Process each widget update
    const results = await Promise.all(
      updates.map(async (update) => {
        // Build update data
        const updateData: Record<string, unknown> = {
          grid_row: update.grid_row,
          grid_col: update.grid_col,
        };
        if (update.grid_width !== undefined) updateData.grid_width = update.grid_width;
        if (update.grid_height !== undefined) updateData.grid_height = update.grid_height;
        if (update.z_index !== undefined) updateData.z_index = update.z_index;

        const { data, error } = await supabase
          .from("dashboard_widgets")
          .update(updateData)
          .eq("id", update.id)
          .eq("dashboard_id", dashboard.id)
          .select()
          .single();

        return { id: update.id, success: !error, data, error: error?.message };
      })
    );

    // Check if any updates failed
    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      return NextResponse.json(
        {
          error: "Some widget updates failed",
          results,
          failedCount: failures.length,
          successCount: results.length - failures.length
        },
        { status: 207 } // 207 Multi-Status
      );
    }

    return NextResponse.json({
      success: true,
      updatedCount: results.length,
      widgets: results.map((r) => r.data)
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
