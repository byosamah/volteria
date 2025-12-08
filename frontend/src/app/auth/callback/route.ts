/**
 * Auth Callback Route
 *
 * Handles Supabase auth callbacks (magic links, OAuth, etc.)
 * Exchanges the auth code for a session and redirects to the destination.
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Successfully authenticated - redirect to destination
      return NextResponse.redirect(`${origin}${next}`);
    }

    console.error("Auth callback error:", error);
  }

  // Auth failed - redirect to login with error message
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
