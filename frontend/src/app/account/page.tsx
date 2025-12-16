/**
 * Account Settings Page
 *
 * Personal account settings including:
 * - Profile information (name)
 * - Password change (with current password verification)
 * - Account details (read-only)
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountSettingsForm } from "./account-settings-form";
import Link from "next/link";

export default async function AccountPage() {
  const supabase = await createClient();

  // Get current user from auth
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Get user profile from users table
  let userProfile: { full_name: string | null; role: string | null; avatar_url: string | null } | null = null;
  if (user?.id) {
    const { data } = await supabase
      .from("users")
      .select("full_name, role, avatar_url")
      .eq("id", user.id)
      .single();
    userProfile = data;
  }

  return (
    <DashboardLayout user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}>
      {/* MOBILE-FRIENDLY: Responsive padding with max-width on larger screens */}
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4 md:space-y-6">
        {/* Header - responsive text sizes */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Account Settings</h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Manage your personal account and profile
          </p>
        </div>

        {/* Profile Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Update your personal information
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AccountSettingsForm
              user={user}
              fullName={userProfile?.full_name || ""}
              avatarUrl={userProfile?.avatar_url}
            />
          </CardContent>
        </Card>

        {/* Account Info (Read-only) */}
        <Card>
          <CardHeader>
            <CardTitle>Account Details</CardTitle>
            <CardDescription>
              Information about your account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Email</p>
              <p className="font-medium">{user?.email}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Role</p>
              <p className="font-medium capitalize">
                {userProfile?.role?.replace("_", " ") || "User"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">User ID</p>
              <p className="font-mono text-xs">{user?.id}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Account Created</p>
              <p className="font-medium">
                {user?.created_at
                  ? new Date(user.created_at).toLocaleDateString()
                  : "Unknown"}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Preferences Link */}
        <Card>
          <CardHeader>
            <CardTitle>Preferences</CardTitle>
            <CardDescription>
              Manage your notification settings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/settings/notifications"
              className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5 text-primary"
                  >
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium group-hover:text-primary transition-colors">
                    Notification Preferences
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Configure email and in-app alerts
                  </p>
                </div>
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </Link>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
