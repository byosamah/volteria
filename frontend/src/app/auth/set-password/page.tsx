"use client";

/**
 * Set Password Page
 *
 * Allows invited users to set their password after clicking an invitation link.
 * This page is shown when:
 * 1. An admin invites a user via email
 * 2. User clicks the invitation link
 * 3. Auth callback redirects here for password setup
 *
 * The user is already authenticated via the magic link, so they can
 * directly set their password using supabase.auth.updateUser()
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

export default function SetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  // Check if user has a valid session from the magic link
  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          // No session - redirect to login
          toast.error("Invalid or expired invitation link");
          router.push("/login");
          return;
        }

        setUserEmail(user.email || null);

        // Check if user needs to set password (user_metadata check)
        const metadata = user.user_metadata;
        console.log("[SetPassword] User metadata:", metadata);

      } catch (error) {
        console.error("[SetPassword] Error checking session:", error);
        toast.error("Something went wrong");
        router.push("/login");
      } finally {
        setCheckingSession(false);
      }
    };

    checkSession();
  }, [supabase, router]);

  // Handle password submission
  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate passwords match
      if (password !== confirmPassword) {
        toast.error("Passwords do not match");
        setLoading(false);
        return;
      }

      // Validate password length
      if (password.length < 6) {
        toast.error("Password must be at least 6 characters");
        setLoading(false);
        return;
      }

      // Update user's password
      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) {
        console.error("[SetPassword] Error updating password:", error);
        toast.error(error.message || "Failed to set password");
        setLoading(false);
        return;
      }

      // Get current user to check for metadata (role, enterprise_id)
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        const metadata = user.user_metadata;
        const role = metadata?.role || "enterprise_admin";
        const enterpriseId = metadata?.enterprise_id;
        const firstName = metadata?.first_name || "";
        const lastName = metadata?.last_name || "";
        const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;

        console.log("[SetPassword] Creating user record with:", { role, enterpriseId, fullName });

        // Create the user record in the users table
        // This might already exist if using Direct Create, so we use upsert behavior
        const { error: insertError } = await supabase
          .from("users")
          .upsert({
            id: user.id,
            email: user.email,
            full_name: fullName,
            role: role,
            enterprise_id: enterpriseId || null,
          }, {
            onConflict: "id",
            ignoreDuplicates: false,
          });

        if (insertError) {
          console.error("[SetPassword] Error creating user record:", insertError);
          // Don't fail - the user can still log in, just might not have role
        }
      }

      toast.success("Password set successfully! Redirecting...");

      // Redirect to dashboard
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 1000);

    } catch (error) {
      console.error("[SetPassword] Unexpected error:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Show loading while checking session
  if (checkingSession) {
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
              <span className="text-muted-foreground">Verifying invitation...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          {/* Logo and branding - matches login page style */}
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
          <CardDescription className="text-center">
            Set your password to complete registration
            {userEmail && (
              <span className="block mt-2 font-medium text-foreground">
                {userEmail}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                minLength={6}
                className="min-h-[44px]"
              />
              <p className="text-xs text-muted-foreground">
                Must be at least 6 characters
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
                minLength={6}
                className="min-h-[44px]"
              />
            </div>
            <Button type="submit" className="w-full min-h-[44px]" disabled={loading}>
              {loading ? "Setting Password..." : "Set Password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
