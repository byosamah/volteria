/**
 * User Management Page
 *
 * Admin page for managing all users in the system.
 * Access:
 * - super_admin / backend_admin: See all users, full edit access
 * - enterprise_admin: See only users in their enterprise
 *
 * Features:
 * - List users with search and filters
 * - Create new users (email invite or direct create)
 * - Edit user details and role
 * - Assign users to projects
 * - Delete users (super_admin only)
 */

import { createClient } from "@/lib/supabase/server";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import { UsersList } from "./users-list";

export default async function UsersPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get user profile with role and enterprise
  const { data: userProfile, error: profileError } = await supabase
    .from("users")
    .select("role, full_name, avatar_url, enterprise_id")
    .eq("id", user.id)
    .single();

  if (profileError || !userProfile) {
    redirect("/");
  }

  // Check access - only super_admin, backend_admin, or enterprise_admin can access
  const allowedRoles = ["super_admin", "backend_admin", "enterprise_admin"];
  if (!allowedRoles.includes(userProfile.role)) {
    redirect("/");
  }

  // Fetch users based on role
  // Enterprise admin only sees their enterprise's users
  let usersQuery = supabase
    .from("users")
    .select(`
      id,
      email,
      role,
      full_name,
      is_active,
      enterprise_id,
      avatar_url,
      created_at,
      enterprises:enterprise_id (name)
    `)
    .order("created_at", { ascending: false });

  // Enterprise admin: filter to their enterprise only
  if (userProfile.role === "enterprise_admin") {
    if (!userProfile.enterprise_id) {
      // Enterprise admin without enterprise - show empty list
      usersQuery = usersQuery.eq("enterprise_id", "none");
    } else {
      usersQuery = usersQuery.eq("enterprise_id", userProfile.enterprise_id);
    }
  }

  const { data: users, error: usersError } = await usersQuery;

  if (usersError) {
    console.error("Failed to fetch users:", usersError);
  }

  const usersList = users || [];

  // Fetch enterprises list (for super admin dropdown in filters/forms)
  let enterprises: Array<{ id: string; name: string }> = [];
  if (userProfile.role !== "enterprise_admin") {
    const { data: enterprisesData } = await supabase
      .from("enterprises")
      .select("id, name")
      .eq("is_active", true)
      .order("name");

    enterprises = enterprisesData || [];
  }

  // Fetch projects (for project assignment in edit dialog)
  // Enterprise admin only sees their enterprise's projects
  let projectsQuery = supabase
    .from("projects")
    .select("id, name, enterprise_id")
    .eq("is_active", true)
    .order("name");

  if (userProfile.role === "enterprise_admin" && userProfile.enterprise_id) {
    projectsQuery = projectsQuery.eq("enterprise_id", userProfile.enterprise_id);
  }

  const { data: projects } = await projectsQuery;

  // Calculate stats
  const totalUsers = usersList.length;
  const activeUsers = usersList.filter((u) => u.is_active).length;
  const inactiveUsers = usersList.filter((u) => !u.is_active).length;
  const enterpriseAdminCount = usersList.filter(
    (u) => u.role === "enterprise_admin" || u.role === "admin"
  ).length;

  return (
    <DashboardLayout
      user={{
        email: user?.email,
        full_name: userProfile?.full_name || undefined,
        avatar_url: userProfile?.avatar_url || undefined,
        role: userProfile?.role || undefined,
      }}
    >
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-bold">Users</h1>
              <Badge variant="secondary">Admin</Badge>
            </div>
            <p className="text-muted-foreground text-sm md:text-base">
              {userProfile.role === "enterprise_admin"
                ? "Manage users in your enterprise"
                : "Manage all users in the system"}
            </p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Users</CardDescription>
              <CardTitle className="text-3xl">{totalUsers}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Active</CardDescription>
              <CardTitle className="text-3xl text-green-600">{activeUsers}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Inactive</CardDescription>
              <CardTitle className="text-3xl text-gray-400">{inactiveUsers}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Enterprise Admins</CardDescription>
              <CardTitle className="text-3xl text-blue-600">{enterpriseAdminCount}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Users List Component */}
        <UsersList
          users={usersList}
          enterprises={enterprises}
          projects={projects || []}
          currentUser={{
            id: user.id,
            role: userProfile.role,
            enterprise_id: userProfile.enterprise_id,
          }}
        />
      </div>
    </DashboardLayout>
  );
}
