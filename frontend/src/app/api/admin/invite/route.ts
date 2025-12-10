/**
 * Admin Invite API
 *
 * POST /api/admin/invite - Send an invitation email to a new user
 *
 * Uses Supabase Admin API to invite a user by email.
 * The user receives an email with a link to set their password.
 * User metadata (role, enterprise_id) is stored for later use when the user completes setup.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

// Create admin client lazily to avoid build-time errors
function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Support both naming conventions for the service key
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

export async function POST(request: NextRequest) {
  try {
    console.log("[Admin Invite API] POST request received");

    // Get the current user to verify they have permission
    const supabase = await createServerClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();

    console.log("[Admin Invite API] Current user:", currentUser?.id || "NOT AUTHENTICATED");

    if (!currentUser) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401 }
      );
    }

    // Check if current user is super_admin
    const { data: userData, error: roleError } = await supabase
      .from("users")
      .select("role")
      .eq("id", currentUser.id)
      .single();

    console.log("[Admin Invite API] User role:", userData?.role || "NOT FOUND", roleError ? `Error: ${roleError.message}` : "");

    if (!userData || userData.role !== "super_admin") {
      return NextResponse.json(
        { message: "Only super admins can invite users" },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { email, first_name, last_name, role, enterprise_id } = body;

    console.log("[Admin Invite API] Inviting user:", email, "role:", role, "enterprise_id:", enterprise_id);

    // Validate required fields
    if (!email) {
      return NextResponse.json(
        { message: "Email is required" },
        { status: 400 }
      );
    }

    // Check if service key is configured
    const hasServiceKey = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
    console.log("[Admin Invite API] Service key configured:", hasServiceKey);

    if (!hasServiceKey) {
      return NextResponse.json(
        { message: "Server configuration error: Missing service key" },
        { status: 500 }
      );
    }

    // Get admin client
    const supabaseAdmin = getSupabaseAdmin();

    // Use Supabase Admin API to invite user by email
    // This sends an invitation email with a link to set their password
    console.log("[Admin Invite API] Calling inviteUserByEmail...");

    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        // Store user metadata that will be available when they complete setup
        data: {
          role: role || "enterprise_admin",
          enterprise_id: enterprise_id || null,
          first_name: first_name || "",
          last_name: last_name || "",
        },
        // Redirect URL after they click the email link
        // IMPORTANT: Must go to /auth/callback (route handler) NOT /auth/set-password (page)
        // The callback exchanges the auth code for a session, then redirects to set-password
        redirectTo: "https://volteria.org/auth/callback",
      }
    );

    if (inviteError) {
      console.error("[Admin Invite API] Error inviting user:", inviteError.message, inviteError);
      return NextResponse.json(
        { message: inviteError.message || "Failed to send invitation" },
        { status: 400 }
      );
    }

    console.log("[Admin Invite API] SUCCESS: Invitation sent to", email);

    return NextResponse.json({
      success: true,
      message: `Invitation sent to ${email}`,
      user: {
        id: inviteData.user?.id,
        email: inviteData.user?.email,
      },
    });

  } catch (error) {
    console.error("[Admin Invite API] UNEXPECTED ERROR:", error);
    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
    return NextResponse.json(
      { message: errorMessage },
      { status: 500 }
    );
  }
}
