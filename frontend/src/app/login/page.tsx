"use client";

/**
 * Login Page
 *
 * Handles user authentication via Supabase.
 *
 * IMPORTANT: Also handles invite tokens that land here instead of /auth/set-password
 * This happens when Supabase ignores the redirect_to parameter (wildcard matching issue)
 * If we detect invite tokens in the URL fragment, we establish session and redirect.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [processingInvite, setProcessingInvite] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  // Handle invite tokens that land on /login instead of /auth/set-password
  // This happens when Supabase doesn't respect the redirect_to parameter
  // The tokens ARE in the URL fragment - we just need to process them here
  useEffect(() => {
    const handleInviteTokens = async () => {
      const hash = window.location.hash;

      // Check if URL fragment contains invite tokens
      // Format: #access_token=...&refresh_token=...&type=invite
      if (hash && hash.includes('access_token') && hash.includes('type=invite')) {
        console.log("[Login] Detected invite tokens in URL fragment, processing...");
        setProcessingInvite(true);

        try {
          // Parse tokens from fragment
          const hashParams = new URLSearchParams(hash.substring(1));
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');

          if (accessToken && refreshToken) {
            console.log("[Login] Setting session from invite tokens...");

            // Establish session using the tokens
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

            if (!error) {
              console.log("[Login] Session established successfully, redirecting to set-password");
              // Clean up URL and redirect to set-password page
              window.history.replaceState(null, '', '/login');
              router.push('/auth/set-password');
              return;
            }

            console.error("[Login] Failed to set session from invite tokens:", error);
            toast.error("Failed to process invitation. Please try again.");
          }
        } catch (err) {
          console.error("[Login] Error processing invite tokens:", err);
          toast.error("An error occurred processing your invitation.");
        }

        setProcessingInvite(false);
      }
    };

    handleInviteTokens();
  }, [supabase, router]);

  // Show loading state while processing invite tokens
  if (processingInvite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-4">
              <svg
                className="animate-spin h-8 w-8 text-primary"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span className="text-muted-foreground">Processing invitation...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success("Logged in successfully");
      router.push("/");
      router.refresh();
    } catch {
      toast.error("An error occurred during login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          {/* Logo and branding - matches sidebar style */}
          <div className="flex flex-col items-center mb-6">
            <Image
              src="/logo.svg"
              alt="Volteria Logo"
              width={200}
              height={50}
              className="h-auto w-auto max-h-14 mb-2"
            />
            <span className="text-[13px] text-muted-foreground tracking-wide">
              Energy Management
            </span>
          </div>
          <CardDescription className="text-center">Sign in to your account</CardDescription>
        </CardHeader>
        <CardContent>
          {/* MOBILE-FRIENDLY: 44px touch targets for inputs and button */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                className="min-h-[44px]"
              />
            </div>
            <Button type="submit" className="w-full min-h-[44px]" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
