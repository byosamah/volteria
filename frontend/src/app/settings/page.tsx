/**
 * System Settings Page
 *
 * Displays enterprise information (read-only):
 * - Enterprise name and ID
 * - Contact information
 * - Address details
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default async function SettingsPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch user profile including enterprise_id
  let userProfile: {
    full_name: string | null;
    avatar_url: string | null;
    role: string | null;
    enterprise_id: string | null;
  } | null = null;

  if (user?.id) {
    const { data } = await supabase
      .from("users")
      .select("full_name, avatar_url, role, enterprise_id")
      .eq("id", user.id)
      .single();
    userProfile = data;
  }

  // Fetch enterprise information if user belongs to one
  let enterprise: {
    id: string;
    name: string;
    enterprise_id: string;
    contact_email: string | null;
    contact_phone: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    created_at: string;
    is_active: boolean;
  } | null = null;

  if (userProfile?.enterprise_id) {
    const { data } = await supabase
      .from("enterprises")
      .select("id, name, enterprise_id, contact_email, contact_phone, address, city, country, created_at, is_active")
      .eq("id", userProfile.enterprise_id)
      .single();
    enterprise = data;
  }

  return (
    <DashboardLayout user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
        enterprise_id: userProfile?.enterprise_id || undefined,
      }}>
      {/* MOBILE-FRIENDLY: Responsive padding with max-width on larger screens */}
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4 md:space-y-6">
        {/* Header - responsive text sizes */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">System Settings</h1>
          <p className="text-muted-foreground text-sm md:text-base">
            General system information
          </p>
        </div>

        {/* Settings Navigation Cards */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Notification Preferences Link */}
          <Link href="/settings/notifications" className="group">
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
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
                <div className="flex-1">
                  <p className="font-medium group-hover:text-primary transition-colors">
                    Notification Preferences
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Configure email and in-app alerts
                  </p>
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
              </CardContent>
            </Card>
          </Link>

          {/* Account Link */}
          <Link href="/account" className="group">
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
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
                    <circle cx="12" cy="8" r="5" />
                    <path d="M20 21a8 8 0 0 0-16 0" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="font-medium group-hover:text-primary transition-colors">
                    Account Settings
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Profile, password, and security
                  </p>
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
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Enterprise Information */}
        {enterprise ? (
          <>
            {/* Enterprise Details Card */}
            <Card>
              <CardHeader>
                <CardTitle>Enterprise Information</CardTitle>
                <CardDescription>
                  Your organization details
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Enterprise Name</p>
                    <p className="font-medium">{enterprise.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Enterprise ID</p>
                    <p className="font-mono text-sm">{enterprise.enterprise_id}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    enterprise.is_active
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
                  }`}>
                    {enterprise.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Contact Information Card */}
            <Card>
              <CardHeader>
                <CardTitle>Contact Information</CardTitle>
                <CardDescription>
                  Enterprise contact details
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Contact Email</p>
                    <p className="font-medium">{enterprise.contact_email || "Not provided"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Contact Phone</p>
                    <p className="font-medium">{enterprise.contact_phone || "Not provided"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Address Card - only show if any address field is provided */}
            {(enterprise.address || enterprise.city || enterprise.country) && (
              <Card>
                <CardHeader>
                  <CardTitle>Address</CardTitle>
                  <CardDescription>
                    Enterprise location
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {enterprise.address && (
                    <div>
                      <p className="text-sm text-muted-foreground">Street Address</p>
                      <p className="font-medium">{enterprise.address}</p>
                    </div>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {enterprise.city && (
                      <div>
                        <p className="text-sm text-muted-foreground">City</p>
                        <p className="font-medium">{enterprise.city}</p>
                      </div>
                    )}
                    {enterprise.country && (
                      <div>
                        <p className="text-sm text-muted-foreground">Country</p>
                        <p className="font-medium">{enterprise.country}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Registration Info */}
            <Card>
              <CardHeader>
                <CardTitle>Registration</CardTitle>
                <CardDescription>
                  Account registration details
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div>
                  <p className="text-sm text-muted-foreground">Registered On</p>
                  <p className="font-medium">
                    {enterprise.created_at
                      ? new Date(enterprise.created_at).toLocaleDateString()
                      : "Unknown"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          /* No Enterprise - Show basic info */
          <Card>
            <CardHeader>
              <CardTitle>System Information</CardTitle>
              <CardDescription>
                General information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                No enterprise information available. Contact your administrator if you believe this is an error.
              </p>
              <div>
                <p className="text-sm text-muted-foreground">Your Role</p>
                <p className="font-medium capitalize">{userProfile?.role?.replace(/_/g, ' ') || "Unknown"}</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
