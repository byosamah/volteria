/**
 * Enterprise Detail Page
 *
 * Shows detailed information about a specific enterprise including:
 * - Header with name, ID, status
 * - Stats cards (projects, controllers, users)
 * - Tabs: Controllers, Projects, Users, Settings
 *
 * Only accessible to super_admin users.
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { EnterpriseDetailTabs } from "./enterprise-detail-tabs";

export default async function EnterpriseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Check user role - only super_admin can access
  let userProfile: { role: string | null; full_name: string | null; avatar_url: string | null } | null = null;
  if (user?.id) {
    const { data: userData, error } = await supabase
      .from("users")
      .select("role, full_name, avatar_url")
      .eq("id", user.id)
      .single();

    // Error handling: Log and redirect if query fails
    if (error) {
      console.error("Failed to fetch user role:", error);
      redirect("/");
    }
    userProfile = userData;
  }
  const userRole = userProfile?.role;

  // Redirect if not super_admin (this page requires super_admin only)
  if (!userRole || userRole !== "super_admin") {
    redirect("/");
  }

  // Fetch enterprise details
  const { data: enterprise, error: enterpriseError } = await supabase
    .from("enterprises")
    .select("*")
    .eq("id", id)
    .single();

  if (enterpriseError || !enterprise) {
    notFound();
  }

  // Fetch controllers claimed by this enterprise
  let controllers: Array<{
    id: string;
    serial_number: string;
    status: string;
    firmware_version: string | null;
    passcode: string | null;
    created_at: string;
    claimed_at: string | null;
    approved_hardware: {
      name: string;
      hardware_type: string;
    } | null;
  }> = [];

  try {
    const { data, error } = await supabase
      .from("controllers")
      .select(`
        id,
        serial_number,
        status,
        firmware_version,
        passcode,
        created_at,
        claimed_at,
        approved_hardware:hardware_type_id (
          name,
          hardware_type
        )
      `)
      .eq("enterprise_id", id)
      .order("claimed_at", { ascending: false });

    if (!error && data) {
      // Transform Supabase data - relations come as arrays, extract first element
      controllers = data.map((item) => ({
        ...item,
        approved_hardware: Array.isArray(item.approved_hardware)
          ? item.approved_hardware[0] || null
          : item.approved_hardware,
      })) as typeof controllers;
    }
  } catch {
    // Table might not exist yet
  }

  // Fetch projects belonging to this enterprise
  let projects: Array<{
    id: string;
    name: string;
    location: string | null;
    controller_status: string;
    created_at: string;
  }> = [];

  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, location, controller_status, created_at")
      .eq("enterprise_id", id)
      .order("name");

    if (!error && data) {
      projects = data;
    }
  } catch {
    // Table might not exist yet
  }

  // Fetch users assigned to this enterprise
  let users: Array<{
    id: string;
    email: string;
    full_name: string | null;
    role: string | null;
    is_active: boolean;
    created_at: string;
  }> = [];

  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, email, full_name, role, is_active, created_at")
      .eq("enterprise_id", id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      users = data;
    }
  } catch {
    // Table might not exist yet
  }

  // Calculate stats
  const onlineProjects = projects.filter((p) => p.controller_status === "online").length;

  return (
    <DashboardLayout user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}>
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Back Link + Header */}
        <div className="flex items-start gap-3">
          <Link
            href="/admin/enterprises"
            className="mt-1 text-muted-foreground hover:text-foreground"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-bold">{enterprise.name}</h1>
              <Badge variant={enterprise.is_active ? "default" : "secondary"}>
                {enterprise.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-muted-foreground">
              <span className="font-mono">{enterprise.enterprise_id}</span>
              {enterprise.contact_email && (
                <span className="flex items-center gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                  {enterprise.contact_email}
                </span>
              )}
              {(enterprise.city || enterprise.country) && (
                <span className="flex items-center gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  {[enterprise.city, enterprise.country].filter(Boolean).join(", ")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Controllers</CardDescription>
              <CardTitle className="text-3xl">{controllers.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Projects</CardDescription>
              <CardTitle className="text-3xl">{projects.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Online Projects</CardDescription>
              <CardTitle className="text-3xl text-green-600">{onlineProjects}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Users</CardDescription>
              <CardTitle className="text-3xl">{users.length}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Tabs Component (Client) */}
        <EnterpriseDetailTabs
          enterprise={enterprise}
          controllers={controllers}
          projects={projects}
          users={users}
          currentUser={{
            id: user?.id || "",
            email: user?.email || "",
            role: userProfile?.role || "",
          }}
        />
      </div>
    </DashboardLayout>
  );
}
