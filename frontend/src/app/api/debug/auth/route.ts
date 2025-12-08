/**
 * Debug Auth API Endpoint
 *
 * Returns detailed information about the current user's authentication
 * and database query results. Used for debugging admin page redirect issues.
 *
 * Visit: /api/debug/auth (while logged in)
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const debug: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    step: "starting",
  };

  try {
    // Step 1: Create Supabase client
    debug.step = "creating_supabase_client";
    const supabase = await createClient();
    debug.supabaseClientCreated = true;

    // Step 2: Get auth user
    debug.step = "getting_auth_user";
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    debug.authUser = user
      ? {
          id: user.id,
          email: user.email,
          aud: user.aud,
          role: user.role,
          created_at: user.created_at,
        }
      : null;
    debug.authError = authError
      ? {
          message: authError.message,
          name: authError.name,
          status: authError.status,
        }
      : null;

    // Step 3: Query users table (if we have a user)
    if (user?.id) {
      debug.step = "querying_users_table";
      debug.queryingUserId = user.id;

      const { data: userData, error: queryError } = await supabase
        .from("users")
        .select("id, email, role, full_name, avatar_url, is_active, enterprise_id")
        .eq("id", user.id)
        .single();

      debug.userData = userData;
      debug.queryError = queryError
        ? {
            message: queryError.message,
            code: queryError.code,
            details: queryError.details,
            hint: queryError.hint,
          }
        : null;

      // Step 4: Role comparison
      if (userData) {
        debug.step = "role_comparison";
        debug.roleFromDb = userData.role;
        debug.roleType = typeof userData.role;
        debug.roleLength = userData.role?.length;
        debug.isSuperAdmin = userData.role === "super_admin";
        debug.isBackendAdmin = userData.role === "backend_admin";
        debug.isEnterpriseAdmin = userData.role === "enterprise_admin";
        debug.roleCheckWouldPass =
          userData.role === "super_admin" || userData.role === "backend_admin";
      }
    } else {
      debug.step = "no_auth_user";
      debug.message = "No authenticated user found - would redirect to /login";
    }

    debug.step = "complete";
    return NextResponse.json(debug, { status: 200 });
  } catch (error) {
    debug.step = "error";
    debug.error = error instanceof Error ? error.message : String(error);
    return NextResponse.json(debug, { status: 500 });
  }
}
