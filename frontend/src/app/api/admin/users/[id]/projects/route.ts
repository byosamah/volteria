/**
 * Admin User Projects API
 *
 * GET /api/admin/users/[id]/projects - Get user's project assignments
 * POST /api/admin/users/[id]/projects - Assign user to project
 *
 * Access:
 * - super_admin/backend_admin: Full access
 * - enterprise_admin: Only users/projects in their enterprise
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

// Allowed roles for user management
const ALLOWED_ROLES = ["super_admin", "backend_admin", "enterprise_admin"];

/**
 * GET /api/admin/users/[id]/projects
 * Get user's project assignments
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params;
    const supabase = await createServerClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();

    if (!currentUser) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Get current user's role and enterprise
    const { data: userData } = await supabase
      .from("users")
      .select("role, enterprise_id")
      .eq("id", currentUser.id)
      .single();

    if (!userData || !ALLOWED_ROLES.includes(userData.role)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    // Get target user to verify enterprise access
    const { data: targetUser } = await supabase
      .from("users")
      .select("id, enterprise_id")
      .eq("id", userId)
      .single();

    if (!targetUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Enterprise admin can only see users in their enterprise
    if (userData.role === "enterprise_admin") {
      if (targetUser.enterprise_id !== userData.enterprise_id) {
        return NextResponse.json(
          { message: "Cannot access users outside your enterprise" },
          { status: 403 }
        );
      }
    }

    // Get user's project assignments
    const { data: assignments, error } = await supabase
      .from("user_projects")
      .select(`
        project_id,
        can_edit,
        can_control,
        assigned_at,
        projects:project_id (id, name, enterprise_id)
      `)
      .eq("user_id", userId);

    if (error) {
      console.error("[Admin Users Projects API] GET error:", error);
      return NextResponse.json({ message: "Failed to fetch assignments" }, { status: 500 });
    }

    // Format response
    const formattedAssignments = (assignments || []).map((row) => {
      const project = row.projects as unknown as { id: string; name: string; enterprise_id: string | null } | null;
      return {
        project_id: row.project_id,
        project_name: project?.name || null,
        enterprise_id: project?.enterprise_id || null,
        can_edit: row.can_edit || false,
        can_control: row.can_control || false,
        assigned_at: row.assigned_at,
      };
    });

    return NextResponse.json({ assignments: formattedAssignments });
  } catch (error) {
    console.error("[Admin Users Projects API] GET unexpected error:", error);
    return NextResponse.json({ message: "An unexpected error occurred" }, { status: 500 });
  }
}

/**
 * POST /api/admin/users/[id]/projects
 * Assign user to project or update assignment
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params;
    const supabase = await createServerClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();

    if (!currentUser) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Get current user's role and enterprise
    const { data: userData } = await supabase
      .from("users")
      .select("role, enterprise_id")
      .eq("id", currentUser.id)
      .single();

    if (!userData || !ALLOWED_ROLES.includes(userData.role)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const { project_id, can_edit, can_control } = body;

    if (!project_id) {
      return NextResponse.json({ message: "Project ID is required" }, { status: 400 });
    }

    // Get target user
    const { data: targetUser } = await supabase
      .from("users")
      .select("id, enterprise_id")
      .eq("id", userId)
      .single();

    if (!targetUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Get target project
    const { data: targetProject } = await supabase
      .from("projects")
      .select("id, enterprise_id")
      .eq("id", project_id)
      .single();

    if (!targetProject) {
      return NextResponse.json({ message: "Project not found" }, { status: 404 });
    }

    // Enterprise admin restrictions
    if (userData.role === "enterprise_admin") {
      // User must be in their enterprise
      if (targetUser.enterprise_id !== userData.enterprise_id) {
        return NextResponse.json(
          { message: "Cannot assign users outside your enterprise" },
          { status: 403 }
        );
      }
      // Project must be in their enterprise
      if (targetProject.enterprise_id !== userData.enterprise_id) {
        return NextResponse.json(
          { message: "Cannot assign to projects outside your enterprise" },
          { status: 403 }
        );
      }
    }

    // Check if assignment already exists
    const { data: existing } = await supabase
      .from("user_projects")
      .select("user_id")
      .eq("user_id", userId)
      .eq("project_id", project_id)
      .single();

    if (existing) {
      // Update existing assignment
      const { error: updateError } = await supabase
        .from("user_projects")
        .update({
          can_edit: can_edit || false,
          can_control: can_control || false,
        })
        .eq("user_id", userId)
        .eq("project_id", project_id);

      if (updateError) {
        console.error("[Admin Users Projects API] Update error:", updateError);
        return NextResponse.json({ message: "Failed to update assignment" }, { status: 500 });
      }
    } else {
      // Create new assignment
      const { error: insertError } = await supabase
        .from("user_projects")
        .insert({
          user_id: userId,
          project_id: project_id,
          can_edit: can_edit || false,
          can_control: can_control || false,
          assigned_by: currentUser.id,
        });

      if (insertError) {
        console.error("[Admin Users Projects API] Insert error:", insertError);
        return NextResponse.json({ message: "Failed to create assignment" }, { status: 500 });
      }
    }

    return NextResponse.json({ message: "User assigned to project successfully" });
  } catch (error) {
    console.error("[Admin Users Projects API] POST unexpected error:", error);
    return NextResponse.json({ message: "An unexpected error occurred" }, { status: 500 });
  }
}
