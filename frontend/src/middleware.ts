/**
 * Middleware
 *
 * Handles Supabase auth code exchange on ANY page.
 * When a magic link redirects with ?code=xxx, this middleware:
 * 1. Exchanges the code for a session
 * 2. Sets auth cookies
 * 3. Redirects to the same page without the code parameter
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Check for auth code in URL (from magic link / OAuth)
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    // Exchange code for session
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Success - redirect appropriately
      const currentPath = request.nextUrl.pathname;

      // If landing on /login after auth, redirect to dashboard instead
      if (currentPath === "/login") {
        return NextResponse.redirect(new URL("/", request.url));
      }

      // Otherwise, redirect to same page without code parameter
      const url = request.nextUrl.clone();
      url.searchParams.delete("code");
      return NextResponse.redirect(url);
    }

    // If exchange failed, continue to page (will show login)
    console.error("Auth code exchange failed:", error);
  }

  // Refresh session if needed (keeps user logged in)
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - Static assets (svg, png, jpg, etc.)
     * - API routes (handled separately)
     */
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
