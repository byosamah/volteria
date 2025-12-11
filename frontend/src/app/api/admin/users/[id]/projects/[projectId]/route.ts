/**
 * Admin User Project Assignment API - Single Assignment
 *
 * DELETE /api/admin/users/[id]/projects/[projectId] - Remove user from project
 *
 * Access:
 * - super_admin/backend_admin: Full access
 * - enterprise_admin: Only users in their enterprise
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

// Allowed roles for user management
const ALLOWED_ROLES = ["super_admin", "backend_admin", "enterprise_admin"];

/**
 * DELETE /api/admin/users/[id]/projects/[projectId]
 * Remove user from project
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; projectId: string }> }
) {
  try {
    const { id: userId, projectId } = await params;
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

    // Enterprise admin restrictions
    if (userData.role === "enterprise_admin") {
      if (targetUser.enterprise_id !== userData.enterprise_id) {
        return NextResponse.json(
          { message: "Cannot manage users outside your enterprise" },
          { status: 403 }
        );
      }
    }

    // Delete the assignment
    const { error } = await supabase
      .from("user_projects")
      .delete()
      .eq("user_id", userId)
      .eq("project_id", projectId);

    if (error) {
      console.error("[Admin Users Projects API] DELETE error:", error);
      return NextResponse.json({ message: "Failed to remove assignment" }, { status: 500 });
    }

    return NextResponse.json({ message: "User removed from project successfully" });
  } catch (error) {
    console.error("[Admin Users Projects API] DELETE unexpected error:", error);
    return NextResponse.json({ message: "An unexpected error occurred" }, { status: 500 });
  }
}
