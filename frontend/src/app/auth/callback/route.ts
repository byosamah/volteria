/**
 * Auth Callback Route
 *
 * Handles Supabase auth callbacks (magic links, OAuth, invites, etc.)
 * Exchanges the auth code for a session and redirects to the destination.
 *
 * Special handling for invite flow:
 * - If type=invite or type=recovery, redirect to /auth/set-password
 * - This allows invited users to set their password after clicking the email link
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // Get the real origin from forwarded headers (set by Nginx reverse proxy)
  // Without this, Docker containers return internal hostname (0.0.0.0:3000)
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  const origin = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : new URL(request.url).origin;

  const code = searchParams.get("code");
  const type = searchParams.get("type"); // Supabase includes this for invite/recovery flows
  const next = searchParams.get("next") ?? "/";

  console.log("[Auth Callback] Processing:", { code: !!code, type, next });

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Check if this is an invite or recovery flow
      // In these cases, redirect to set-password page
      if (type === "invite" || type === "recovery" || type === "magiclink") {
        console.log("[Auth Callback] Invite/recovery flow detected, redirecting to set-password");
        return NextResponse.redirect(`${origin}/auth/set-password`);
      }

      // Check if the next destination is set-password (backup check)
      if (next.includes("set-password")) {
        console.log("[Auth Callback] Set-password destination detected");
        return NextResponse.redirect(`${origin}/auth/set-password`);
      }

      // Successfully authenticated - redirect to destination
      return NextResponse.redirect(`${origin}${next}`);
    }

    console.error("[Auth Callback] Error exchanging code:", error);
  }

  // Auth failed - redirect to login with error message
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
