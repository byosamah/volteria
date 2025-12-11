/**
 * Admin Users API
 *
 * GET /api/admin/users - List users (filtered by role/enterprise for enterprise_admin)
 * POST /api/admin/users - Create a new user
 *
 * Access:
 * - super_admin/backend_admin: Full access to all users
 * - enterprise_admin: Access only to users in their enterprise
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

// Allowed roles for user management
const ALLOWED_ROLES = ["super_admin", "backend_admin", "enterprise_admin"];

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

/**
 * GET /api/admin/users
 * List users with optional enterprise filtering
 */
export async function GET() {
  try {
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

    // Build query
    let query = supabase
      .from("users")
      .select(`
        id,
        email,
        role,
        full_name,
        is_active,
        enterprise_id,
        avatar_url,
        created_at,
        enterprises:enterprise_id (name)
      `)
      .order("created_at", { ascending: false });

    // Enterprise admin: filter to their enterprise only
    if (userData.role === "enterprise_admin") {
      if (!userData.enterprise_id) {
        return NextResponse.json({ users: [] });
      }
      query = query.eq("enterprise_id", userData.enterprise_id);
    }

    const { data: users, error } = await query;

    if (error) {
      console.error("[Admin Users API] GET error:", error);
      return NextResponse.json({ message: "Failed to fetch users" }, { status: 500 });
    }

    return NextResponse.json({ users: users || [] });
  } catch (error) {
    console.error("[Admin Users API] GET unexpected error:", error);
    return NextResponse.json({ message: "An unexpected error occurred" }, { status: 500 });
  }
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

    // Check if current user has permission
    const { data: userData, error: roleError } = await supabase
      .from("users")
      .select("role, enterprise_id")
      .eq("id", currentUser.id)
      .single();

    console.log("[Admin Users API] User role:", userData?.role || "NOT FOUND", roleError ? `Error: ${roleError.message}` : "");

    if (!userData || !ALLOWED_ROLES.includes(userData.role)) {
      console.log("[Admin Users API] ERROR: User role not allowed:", userData?.role);
      return NextResponse.json(
        { message: "You don't have permission to create users" },
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

    // Enterprise admin restrictions
    let finalEnterpriseId = enterprise_id;
    let finalRole = role || "viewer";

    if (userData.role === "enterprise_admin") {
      // Can only create configurator and viewer roles
      if (finalRole && !["configurator", "viewer"].includes(finalRole)) {
        console.log("[Admin Users API] ERROR: Enterprise admin cannot create role:", finalRole);
        return NextResponse.json(
          { message: "Enterprise admins can only create configurator and viewer users" },
          { status: 403 }
        );
      }
      // Force assignment to their enterprise
      finalEnterpriseId = userData.enterprise_id;
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
        role: finalRole,
        enterprise_id: finalEnterpriseId || null,
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
