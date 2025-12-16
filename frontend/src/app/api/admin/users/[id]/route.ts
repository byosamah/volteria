/**
 * Admin User API - Single User Operations
 *
 * PATCH /api/admin/users/[id] - Update a user
 * DELETE /api/admin/users/[id] - Delete a user (requires password verification)
 *
 * Access:
 * - super_admin: Full access
 * - backend_admin: Can update users, cannot delete
 * - enterprise_admin: Can update users in their enterprise only
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

// Allowed roles for user management
const ALLOWED_ROLES = ["super_admin", "backend_admin", "enterprise_admin"];

// Create admin client lazily
function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing Supabase configuration");
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * PATCH /api/admin/users/[id]
 * Update a user's profile
 */
export async function PATCH(
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

    // Get target user
    const { data: targetUser } = await supabase
      .from("users")
      .select("id, enterprise_id, role")
      .eq("id", userId)
      .single();

    if (!targetUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Enterprise admin restrictions
    if (userData.role === "enterprise_admin") {
      // Can only edit users in their enterprise
      if (targetUser.enterprise_id !== userData.enterprise_id) {
        return NextResponse.json(
          { message: "Cannot edit users outside your enterprise" },
          { status: 403 }
        );
      }
    }

    // Parse request body
    const body = await request.json();
    const { full_name, role, enterprise_id, is_active, phone } = body;

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (full_name !== undefined) {
      updateData.full_name = full_name;
    }

    if (phone !== undefined) {
      updateData.phone = phone || null;
    }

    if (is_active !== undefined) {
      updateData.is_active = is_active;
    }

    if (role !== undefined) {
      // Enterprise admin can only assign configurator/viewer
      if (userData.role === "enterprise_admin" && !["configurator", "viewer"].includes(role)) {
        return NextResponse.json(
          { message: "Enterprise admins can only assign configurator or viewer roles" },
          { status: 403 }
        );
      }
      updateData.role = role;
    }

    if (enterprise_id !== undefined) {
      // Only super_admin and backend_admin can change enterprise
      if (!["super_admin", "backend_admin"].includes(userData.role)) {
        return NextResponse.json(
          { message: "Only super admins can change user enterprise assignment" },
          { status: 403 }
        );
      }
      updateData.enterprise_id = enterprise_id || null;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ message: "No fields to update" }, { status: 400 });
    }

    // Update user
    const { data: updatedUser, error } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", userId)
      .select()
      .single();

    if (error) {
      console.error("[Admin Users API] PATCH error:", error);
      return NextResponse.json({ message: "Failed to update user" }, { status: 500 });
    }

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    console.error("[Admin Users API] PATCH unexpected error:", error);
    return NextResponse.json({ message: "An unexpected error occurred" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/users/[id]
 * Delete a user (requires password verification)
 */
export async function DELETE(
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

    // Get current user's role
    const { data: userData } = await supabase
      .from("users")
      .select("role, email")
      .eq("id", currentUser.id)
      .single();

    // Only super_admin can delete users
    if (!userData || userData.role !== "super_admin") {
      return NextResponse.json(
        { message: "Only super admins can delete users" },
        { status: 403 }
      );
    }

    // Prevent self-deletion
    if (userId === currentUser.id) {
      return NextResponse.json(
        { message: "Cannot delete your own account" },
        { status: 400 }
      );
    }

    // Parse request body for password verification
    const body = await request.json();
    const { password } = body;

    if (!password) {
      return NextResponse.json(
        { message: "Password is required to delete a user" },
        { status: 400 }
      );
    }

    // Verify password by re-authenticating
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: userData.email,
      password,
    });

    if (authError) {
      return NextResponse.json(
        { message: "Incorrect password" },
        { status: 401 }
      );
    }

    // Check if target user exists
    const { data: targetUser } = await supabase
      .from("users")
      .select("id")
      .eq("id", userId)
      .single();

    if (!targetUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Get admin client for deletion
    const supabaseAdmin = getSupabaseAdmin();

    // Delete from users table first
    const { error: deleteError } = await supabaseAdmin
      .from("users")
      .delete()
      .eq("id", userId);

    if (deleteError) {
      console.error("[Admin Users API] DELETE error:", deleteError);
      return NextResponse.json({ message: "Failed to delete user" }, { status: 500 });
    }

    // Delete from Supabase Auth
    try {
      await supabaseAdmin.auth.admin.deleteUser(userId);
    } catch (err) {
      console.error("[Admin Users API] Warning: Failed to delete auth user:", err);
      // Continue - profile is deleted
    }

    return NextResponse.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("[Admin Users API] DELETE unexpected error:", error);
    return NextResponse.json({ message: "An unexpected error occurred" }, { status: 500 });
  }
}
