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
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    // Get the current user to verify they have permission
    const supabase = await createServerClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();

    if (!currentUser) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401 }
      );
    }

    // Check if current user is super_admin
    const { data: userData } = await supabase
      .from("users")
      .select("role")
      .eq("id", currentUser.id)
      .single();

    if (!userData || userData.role !== "super_admin") {
      return NextResponse.json(
        { message: "Only super admins can create users directly" },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { email, password, first_name, last_name, role, enterprise_id } = body;

    // Validate required fields
    if (!email || !password) {
      return NextResponse.json(
        { message: "Email and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { message: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    // Get admin client
    const supabaseAdmin = getSupabaseAdmin();

    // Create user with Supabase Admin API
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
      console.error("Error creating user:", createError);
      return NextResponse.json(
        { message: createError.message || "Failed to create user" },
        { status: 400 }
      );
    }

    if (!newUser.user) {
      return NextResponse.json(
        { message: "Failed to create user" },
        { status: 500 }
      );
    }

    // Insert user record in our users table
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
      console.error("Error inserting user record:", insertError);
      // User was created in auth but not in our table - try to clean up
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      return NextResponse.json(
        { message: insertError.message || "Failed to create user record" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: newUser.user.id,
        email: newUser.user.email,
      },
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return NextResponse.json(
      { message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
