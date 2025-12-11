/**
 * Test Login API Route
 *
 * Provides automatic login for PageSpeed Insights testing.
 * Requires secret token to prevent unauthorized access.
 *
 * Usage: GET /api/test-login?token=YOUR_SECRET_TOKEN
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const expectedToken = process.env.PAGESPEED_TEST_TOKEN;

  // Validate secret token
  if (!token || token !== expectedToken) {
    return NextResponse.json(
      { error: "Unauthorized - invalid or missing token" },
      { status: 401 }
    );
  }

  // Check required environment variables
  const email = process.env.PAGESPEED_TEST_EMAIL;
  const password = process.env.PAGESPEED_TEST_PASSWORD;

  if (!email || !password) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  // Create response that we'll add cookies to
  let response = NextResponse.redirect(new URL("/", request.url));

  // Create Supabase client with cookie handling
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Sign in with the test account
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error("Test login failed:", error.message);
    return NextResponse.json(
      { error: "Login failed: " + error.message },
      { status: 401 }
    );
  }

  // Return the response with auth cookies set
  return response;
}
