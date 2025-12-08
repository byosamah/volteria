/**
 * Enterprise Management Page
 *
 * Admin page for managing enterprises (organizations).
 * Only accessible to super_admin users.
 *
 * Features:
 * - List all enterprises
 * - Create new enterprise
 * - View enterprise details
 * - Invite enterprise admin
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import { EnterprisesList } from "./enterprises-list";

export default async function EnterprisesPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Check user role - only super_admin can access
  let userProfile: { role: string | null; full_name: string | null; avatar_url: string | null } | null = null;
  if (user?.id) {
    const { data: userData } = await supabase
      .from("users")
      .select("role, full_name, avatar_url")
      .eq("id", user.id)
      .single();
    userProfile = userData;
  }
  const userRole = userProfile?.role || null;

  // Redirect if not super_admin
  if (userRole !== "super_admin") {
    redirect("/");
  }

  // Fetch enterprises
  let enterprises: Array<{
    id: string;
    name: string;
    enterprise_id: string;
    contact_email: string | null;
    city: string | null;
    country: string | null;
    is_active: boolean;
    created_at: string;
    _count?: {
      projects: number;
      users: number;
    };
  }> = [];

  try {
    const { data, error } = await supabase
      .from("enterprises")
      .select("id, name, enterprise_id, contact_email, city, country, is_active, created_at")
      .order("name");

    if (!error && data) {
      enterprises = data;
    }
  } catch {
    // Table might not exist yet
  }

  return (
    <DashboardLayout user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}>
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-bold">Enterprises</h1>
              <Badge variant="secondary">Admin</Badge>
            </div>
            <p className="text-muted-foreground text-sm md:text-base">
              Manage organizations and their administrators
            </p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Enterprises</CardDescription>
              <CardTitle className="text-3xl">{enterprises.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Active</CardDescription>
              <CardTitle className="text-3xl text-green-600">
                {enterprises.filter((e) => e.is_active).length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Inactive</CardDescription>
              <CardTitle className="text-3xl text-gray-400">
                {enterprises.filter((e) => !e.is_active).length}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Enterprises List */}
        <EnterprisesList enterprises={enterprises} />
      </div>
    </DashboardLayout>
  );
}
