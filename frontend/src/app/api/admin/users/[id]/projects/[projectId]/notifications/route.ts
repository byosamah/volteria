/**
 * User Project Notification Settings API
 *
 * GET /api/admin/users/[id]/projects/[projectId]/notifications - Get notification settings
 * PATCH /api/admin/users/[id]/projects/[projectId]/notifications - Update notification settings
 *
 * Access:
 * - super_admin/backend_admin: Full access
 * - enterprise_admin: Only users in their enterprise
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

// Allowed roles for user management
const ALLOWED_ROLES = ["super_admin", "backend_admin", "enterprise_admin"];

// Valid severity levels
const VALID_SEVERITIES = ["info", "warning", "major", "critical"];

/**
 * GET /api/admin/users/[id]/projects/[projectId]/notifications
 * Get notification settings for a user-project pair
 */
export async function GET(
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

    // Get notification settings
    const { data: settings, error } = await supabase
      .from("user_project_notifications")
      .select("*")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows returned (which is ok - use defaults)
      console.error("[Notifications API] GET error:", error);
      return NextResponse.json({ message: "Failed to fetch settings" }, { status: 500 });
    }

    // Return settings or defaults
    const response = settings || {
      // Default values when no settings exist
      email_enabled: true,
      email_min_severity: "major",
      email_on_active: true,
      email_on_resolved: false,
      sms_enabled: false,
      sms_phone_number: null,
      sms_min_severity: "critical",
      sms_on_active: true,
      sms_on_resolved: false,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[Notifications API] GET unexpected error:", error);
    return NextResponse.json({ message: "An unexpected error occurred" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/users/[id]/projects/[projectId]/notifications
 * Update notification settings for a user-project pair
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; projectId: string }> }
) {
  try {
    const { id: userId, projectId } = await params;
    const body = await request.json();
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

    // Validate severity fields
    if (body.email_min_severity && !VALID_SEVERITIES.includes(body.email_min_severity)) {
      return NextResponse.json(
        { message: `Invalid email_min_severity. Must be one of: ${VALID_SEVERITIES.join(", ")}` },
        { status: 400 }
      );
    }
    if (body.sms_min_severity && !VALID_SEVERITIES.includes(body.sms_min_severity)) {
      return NextResponse.json(
        { message: `Invalid sms_min_severity. Must be one of: ${VALID_SEVERITIES.join(", ")}` },
        { status: 400 }
      );
    }

    // Build update object with only allowed fields
    const allowedFields = [
      "email_enabled",
      "email_min_severity",
      "email_on_active",
      "email_on_resolved",
      "sms_enabled",
      "sms_phone_number",
      "sms_min_severity",
      "sms_on_active",
      "sms_on_resolved",
    ];

    const updateData: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ message: "No valid fields to update" }, { status: 400 });
    }

    // Check if settings already exist
    const { data: existingSettings } = await supabase
      .from("user_project_notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .single();

    let result;

    if (existingSettings) {
      // Update existing settings
      result = await supabase
        .from("user_project_notifications")
        .update(updateData)
        .eq("user_id", userId)
        .eq("project_id", projectId)
        .select()
        .single();
    } else {
      // Create new settings with defaults + provided values
      const newSettings = {
        user_id: userId,
        project_id: projectId,
        email_enabled: true,
        email_min_severity: "major",
        email_on_active: true,
        email_on_resolved: false,
        sms_enabled: false,
        sms_phone_number: null,
        sms_min_severity: "critical",
        sms_on_active: true,
        sms_on_resolved: false,
        ...updateData,
      };

      result = await supabase
        .from("user_project_notifications")
        .insert(newSettings)
        .select()
        .single();
    }

    if (result.error) {
      console.error("[Notifications API] PATCH error:", result.error);
      return NextResponse.json({ message: "Failed to update settings" }, { status: 500 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    console.error("[Notifications API] PATCH unexpected error:", error);
    return NextResponse.json({ message: "An unexpected error occurred" }, { status: 500 });
  }
}
