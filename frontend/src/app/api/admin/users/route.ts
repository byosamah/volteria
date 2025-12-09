/**
 * Admin Users API
 *
 * POST /api/admin/users - Create a new user (requires super_admin role)
 *
 * Used by the enterprise admin invitation feature for direct user creation.
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
    // Debug: Log that the endpoint was called
    console.log("[Admin Users API] POST request received");

    // Get the current user to verify they have permission
    const supabase = await createServerClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();

    console.log("[Admin Users API] Current user:", currentUser?.id || "NOT AUTHENTICATED");

    if (!currentUser) {
      console.log("[Admin Users API] ERROR: No authenticated user");
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

    console.log("[Admin Users API] User role:", userData?.role || "NOT FOUND", roleError ? `Error: ${roleError.message}` : "");

    if (!userData || userData.role !== "super_admin") {
      console.log("[Admin Users API] ERROR: User is not super_admin, role:", userData?.role);
      return NextResponse.json(
        { message: "Only super admins can create users directly" },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { email, password, first_name, last_name, role, enterprise_id } = body;

    console.log("[Admin Users API] Creating user:", email, "role:", role, "enterprise_id:", enterprise_id);

    // Validate required fields
    if (!email || !password) {
      console.log("[Admin Users API] ERROR: Missing email or password");
      return NextResponse.json(
        { message: "Email and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      console.log("[Admin Users API] ERROR: Password too short");
      return NextResponse.json(
        { message: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    // Check if service key is configured (support both naming conventions)
    const hasServiceKey = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
    console.log("[Admin Users API] Service key configured:", hasServiceKey);

    if (!hasServiceKey) {
      console.log("[Admin Users API] ERROR: Neither SUPABASE_SERVICE_ROLE_KEY nor SUPABASE_SERVICE_KEY is set");
      return NextResponse.json(
        { message: "Server configuration error: Missing service key" },
        { status: 500 }
      );
    }

    // Get admin client
    const supabaseAdmin = getSupabaseAdmin();

    // Create user with Supabase Admin API
    console.log("[Admin Users API] Calling supabase.auth.admin.createUser...");
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm the email
      user_metadata: {
        first_name: first_name || "",
        last_name: last_name || "",
      },
    });

    if (createError) {
      console.error("[Admin Users API] ERROR creating auth user:", createError.message, createError);
      return NextResponse.json(
        { message: createError.message || "Failed to create user" },
        { status: 400 }
      );
    }

    if (!newUser.user) {
      console.log("[Admin Users API] ERROR: newUser.user is null");
      return NextResponse.json(
        { message: "Failed to create user" },
        { status: 500 }
      );
    }

    console.log("[Admin Users API] Auth user created successfully:", newUser.user.id);

    // Insert user record in our users table
    console.log("[Admin Users API] Inserting into users table...");
    const { error: insertError } = await supabaseAdmin
      .from("users")
      .insert({
        id: newUser.user.id,
        email: email,
        full_name: [first_name, last_name].filter(Boolean).join(" ") || null,
        role: role || "enterprise_admin",
        enterprise_id: enterprise_id || null,
      });

    if (insertError) {
      console.error("[Admin Users API] ERROR inserting user record:", insertError.message, insertError);
      // User was created in auth but not in our table - try to clean up
      console.log("[Admin Users API] Rolling back: deleting auth user...");
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      return NextResponse.json(
        { message: insertError.message || "Failed to create user record" },
        { status: 500 }
      );
    }

    console.log("[Admin Users API] SUCCESS: User created and inserted into users table");

    return NextResponse.json({
      success: true,
      user: {
        id: newUser.user.id,
        email: newUser.user.email,
      },
    });
  } catch (error) {
    console.error("[Admin Users API] UNEXPECTED ERROR:", error);
    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
    return NextResponse.json(
      { message: errorMessage },
      { status: 500 }
    );
  }
}
