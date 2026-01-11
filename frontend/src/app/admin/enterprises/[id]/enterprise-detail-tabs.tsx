"use client";

/**
 * Enterprise Detail Tabs Component
 *
 * Client component for displaying enterprise data in tabs:
 * - Controllers Tab: List of controllers claimed by this enterprise
 * - Projects Tab: List of projects belonging to this enterprise
 * - Users Tab: List of users assigned to this enterprise
 * - Settings Tab: Edit enterprise info, toggle active status
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import Link from "next/link";

// Types for the component props
interface Enterprise {
  id: string;
  name: string;
  enterprise_id: string;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  timezone: string | null;
  subscription_plan: string | null;
  is_active: boolean;
  created_at: string;
}

interface Controller {
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
}

interface Project {
  id: string;
  name: string;
  location: string | null;
  description: string | null;
  site_count: number;
  created_at: string;
}

interface User {
  id: string;
  email: string;
  full_name: string | null;
  role: string | null;
  is_active: boolean;
  created_at: string;
}

interface CurrentUser {
  id: string;
  email: string;
  role: string;
}

interface EnterpriseDetailTabsProps {
  enterprise: Enterprise;
  controllers: Controller[];
  projects: Project[];
  users: User[];
  currentUser: CurrentUser;
}

export function EnterpriseDetailTabs({
  enterprise,
  controllers,
  projects,
  users,
  currentUser,
}: EnterpriseDetailTabsProps) {
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);

  // Delete user state
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Delete enterprise state
  const [showDeleteEnterprise, setShowDeleteEnterprise] = useState(false);
  const [confirmEnterpriseName, setConfirmEnterpriseName] = useState("");
  const [enterpriseDeletePassword, setEnterpriseDeletePassword] = useState("");
  const [enterpriseDeleteLoading, setEnterpriseDeleteLoading] = useState(false);

  // Check if current user is super_admin
  const isSuperAdmin = currentUser.role === "super_admin";

  // Settings form state
  const [formData, setFormData] = useState({
    contact_email: enterprise.contact_email || "",
    contact_phone: enterprise.contact_phone || "",
    address: enterprise.address || "",
    city: enterprise.city || "",
    country: enterprise.country || "",
    timezone: enterprise.timezone || "UTC",
    subscription_plan: enterprise.subscription_plan || "starter",
    is_active: enterprise.is_active,
  });

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  // Handle settings save
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const { error } = await supabase
        .from("enterprises")
        .update({
          contact_email: formData.contact_email.trim() || null,
          contact_phone: formData.contact_phone.trim() || null,
          address: formData.address.trim() || null,
          city: formData.city.trim() || null,
          country: formData.country.trim() || null,
          timezone: formData.timezone,
          subscription_plan: formData.subscription_plan,
          is_active: formData.is_active,
        })
        .eq("id", enterprise.id);

      if (error) {
        console.error("Error updating enterprise:", error);
        toast.error(error.message || "Failed to update enterprise");
        return;
      }

      toast.success("Enterprise updated successfully");
      router.refresh();
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setSaving(false);
    }
  };

  // Handle user deletion with password verification
  const handleDeleteUser = async () => {
    if (!userToDelete || !confirmPassword) return;

    setDeleteLoading(true);

    try {
      // Step 1: Verify super admin's password by re-authenticating
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: currentUser.email,
        password: confirmPassword,
      });

      if (authError) {
        toast.error("Incorrect password. Please try again.");
        setDeleteLoading(false);
        return;
      }

      // Step 2: Delete user from database
      const { error: deleteError } = await supabase
        .from("users")
        .delete()
        .eq("id", userToDelete.id);

      if (deleteError) {
        console.error("Error deleting user:", deleteError);
        toast.error(deleteError.message || "Failed to delete user");
        setDeleteLoading(false);
        return;
      }

      // Step 3: Success - close dialog and refresh
      toast.success(`User ${userToDelete.full_name || userToDelete.email} deleted successfully`);
      setUserToDelete(null);
      setConfirmPassword("");
      router.refresh();
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setDeleteLoading(false);
    }
  };

  // Handle enterprise deletion with password verification (HARD DELETE)
  // This now DELETES all attached users (not just unassigns)
  const handleDeleteEnterprise = async () => {
    // Validate inputs
    if (confirmEnterpriseName !== enterprise.name) {
      toast.error("Enterprise name does not match");
      return;
    }
    if (!enterpriseDeletePassword) {
      toast.error("Please enter your password");
      return;
    }

    setEnterpriseDeleteLoading(true);

    try {
      // Step 1: Verify super admin's password by re-authenticating
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: currentUser.email,
        password: enterpriseDeletePassword,
      });

      if (authError) {
        toast.error("Incorrect password. Please try again.");
        setEnterpriseDeleteLoading(false);
        return;
      }

      // Step 2: Get all users belonging to this enterprise
      const { data: usersToDelete, error: usersError } = await supabase
        .from("users")
        .select("id, email, full_name")
        .eq("enterprise_id", enterprise.id);

      if (usersError) {
        console.error("Error fetching users:", usersError);
        toast.error("Failed to fetch enterprise users");
        setEnterpriseDeleteLoading(false);
        return;
      }

      // Step 3: Delete each user via API (handles both DB and Supabase Auth)
      if (usersToDelete && usersToDelete.length > 0) {
        toast.info(`Deleting ${usersToDelete.length} user(s)...`);

        for (const user of usersToDelete) {
          // Skip current user (can't delete yourself)
          if (user.id === currentUser.id) continue;

          try {
            const response = await fetch(`/api/admin/users/${user.id}`, {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password: enterpriseDeletePassword }),
            });

            if (!response.ok) {
              const result = await response.json();
              console.error(`Failed to delete user ${user.email}:`, result.message);
              // Continue with other users even if one fails
            }
          } catch (err) {
            console.error(`Error deleting user ${user.email}:`, err);
            // Continue with other users
          }
        }
      }

      // Step 4: Unassign projects (keep them but remove enterprise link)
      await supabase
        .from("projects")
        .update({ enterprise_id: null })
        .eq("enterprise_id", enterprise.id);

      // Step 5: Release controllers (set back to 'ready' status)
      await supabase
        .from("controllers")
        .update({ enterprise_id: null, status: "ready", claimed_at: null, claimed_by: null })
        .eq("enterprise_id", enterprise.id);

      // Step 6: Delete the enterprise record
      const { error: deleteError } = await supabase
        .from("enterprises")
        .delete()
        .eq("id", enterprise.id);

      if (deleteError) {
        console.error("Error deleting enterprise:", deleteError);
        toast.error(deleteError.message || "Failed to delete enterprise");
        setEnterpriseDeleteLoading(false);
        return;
      }

      // Step 7: Success - redirect to enterprises list
      const deletedUsersCount = usersToDelete?.filter(u => u.id !== currentUser.id).length || 0;
      toast.success(
        `Enterprise "${enterprise.name}" and ${deletedUsersCount} user(s) deleted successfully`
      );
      router.push("/admin/enterprises");
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setEnterpriseDeleteLoading(false);
    }
  };

  // Get status badge variant for controllers - matches My Controllers page styling
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "deployed":
        return <Badge className="bg-green-100 text-green-800">Deployed</Badge>;
      case "claimed":
        return <Badge className="bg-blue-100 text-blue-800">Claimed</Badge>;
      case "ready":
        return <Badge className="bg-yellow-100 text-yellow-800">Ready</Badge>;
      case "deactivated":
        return <Badge className="bg-amber-100 text-amber-800">Deactivated</Badge>;
      case "eol":
        return <Badge className="bg-red-100 text-red-800">EOL</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">Draft</Badge>;
    }
  };

  // Get site count badge for projects
  const getSiteCountBadge = (count: number) => {
    if (count === 0) {
      return <Badge variant="secondary">No sites</Badge>;
    }
    return <Badge variant="outline">{count} site{count !== 1 ? 's' : ''}</Badge>;
  };

  return (
    <Tabs defaultValue="controllers" className="w-full">
      {/* Tab navigation - scrollable on mobile with scroll indicator */}
      <div className="scroll-fade-right">
        <TabsList className="w-full justify-start overflow-x-auto scrollbar-hide">
          <TabsTrigger value="controllers" className="flex-shrink-0 min-h-[44px]">
            Controllers ({controllers.length})
          </TabsTrigger>
          <TabsTrigger value="projects" className="flex-shrink-0 min-h-[44px]">
            Projects ({projects.length})
          </TabsTrigger>
          <TabsTrigger value="users" className="flex-shrink-0 min-h-[44px]">
            Users ({users.length})
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex-shrink-0 min-h-[44px]">
            Settings
          </TabsTrigger>
        </TabsList>
      </div>

      {/* Controllers Tab */}
      <TabsContent value="controllers" className="mt-4">
        {controllers.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-muted-foreground">
                  <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                  <path d="M12 18h.01" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">No Controllers</h3>
              <p className="text-muted-foreground text-center max-w-sm">
                No controllers have been claimed by this enterprise yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {controllers.map((controller) => (
              <Card key={controller.id}>
                <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-muted-foreground">
                        <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                        <path d="M12 18h.01" />
                      </svg>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium">{controller.serial_number}</span>
                        {getStatusBadge(controller.status)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {controller.approved_hardware?.name || "Unknown Hardware"}
                        {controller.firmware_version && ` • v${controller.firmware_version}`}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground sm:text-right">
                    {controller.claimed_at && (
                      <div>Claimed {new Date(controller.claimed_at).toLocaleDateString()}</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </TabsContent>

      {/* Projects Tab */}
      <TabsContent value="projects" className="mt-4">
        {projects.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-muted-foreground">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">No Projects</h3>
              <p className="text-muted-foreground text-center max-w-sm">
                No projects have been created for this enterprise yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <Card key={project.id}>
                <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-muted-foreground">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        <polyline points="9 22 9 12 15 12 15 22" />
                      </svg>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/projects/${project.id}`}
                          className="font-medium hover:underline"
                        >
                          {project.name}
                        </Link>
                        {getSiteCountBadge(project.site_count)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {project.location || "No location"}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground sm:text-right">
                    Created {new Date(project.created_at).toLocaleDateString()}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </TabsContent>

      {/* Users Tab */}
      <TabsContent value="users" className="mt-4">
        {users.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-muted-foreground">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">No Users</h3>
              <p className="text-muted-foreground text-center max-w-sm">
                No users have been assigned to this enterprise yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {users.map((user) => (
              <Card key={user.id}>
                <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-medium text-primary">
                        {user.full_name
                          ? user.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
                          : user.email[0].toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{user.full_name || user.email}</span>
                        <Badge variant={user.is_active ? "default" : "secondary"}>
                          {user.role?.replace("_", " ") || "user"}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">{user.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-sm text-muted-foreground sm:text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <span className={`h-2 w-2 rounded-full ${user.is_active ? "bg-green-500" : "bg-gray-400"}`} />
                        {user.is_active ? "Active" : "Inactive"}
                      </div>
                      <div>Joined {new Date(user.created_at).toLocaleDateString()}</div>
                    </div>
                    {/* Delete button - only for super_admin, not for self */}
                    {isSuperAdmin && user.id !== currentUser.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                        onClick={() => setUserToDelete(user)}
                        title="Delete user"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-4 w-4"
                        >
                          <path d="M3 6h18" />
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          <line x1="10" x2="10" y1="11" y2="17" />
                          <line x1="14" x2="14" y1="11" y2="17" />
                        </svg>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </TabsContent>

      {/* Settings Tab */}
      <TabsContent value="settings" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Enterprise Settings</CardTitle>
            <CardDescription>
              Update enterprise contact information and status.
              <br />
              <span className="text-yellow-600 text-xs">
                Note: Enterprise name cannot be changed after creation.
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              {/* Read-only fields */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Enterprise Name</Label>
                  <Input
                    value={enterprise.name}
                    disabled
                    className="min-h-[44px] bg-muted"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Enterprise ID</Label>
                  <Input
                    value={enterprise.enterprise_id}
                    disabled
                    className="min-h-[44px] bg-muted font-mono"
                  />
                </div>
              </div>

              {/* Editable fields */}
              <div className="space-y-2">
                <Label htmlFor="contact_email">Contact Email</Label>
                <Input
                  id="contact_email"
                  name="contact_email"
                  type="email"
                  placeholder="e.g., contact@enterprise.com"
                  value={formData.contact_email}
                  onChange={handleChange}
                  className="min-h-[44px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact_phone">Contact Phone</Label>
                <Input
                  id="contact_phone"
                  name="contact_phone"
                  placeholder="e.g., +971 50 123 4567"
                  value={formData.contact_phone}
                  onChange={handleChange}
                  className="min-h-[44px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  name="address"
                  placeholder="e.g., 123 Main Street"
                  value={formData.address}
                  onChange={handleChange}
                  className="min-h-[44px]"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    name="city"
                    placeholder="e.g., Dubai"
                    value={formData.city}
                    onChange={handleChange}
                    className="min-h-[44px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    name="country"
                    placeholder="e.g., UAE"
                    value={formData.country}
                    onChange={handleChange}
                    className="min-h-[44px]"
                  />
                </div>
              </div>

              {/* Timezone */}
              <div className="space-y-2">
                <Label htmlFor="timezone">
                  Timezone <span className="text-red-500">*</span>
                </Label>
                <select
                  id="timezone"
                  value={formData.timezone}
                  onChange={(e) => setFormData((prev) => ({ ...prev, timezone: e.target.value }))}
                  className="w-full h-10 px-3 rounded-md border border-input bg-background min-h-[44px]"
                  required
                >
                  <optgroup label="Common Timezones">
                    <option value="UTC">UTC (Coordinated Universal Time)</option>
                    <option value="Asia/Dubai">Asia/Dubai (Gulf Standard Time, UTC+4)</option>
                    <option value="Asia/Riyadh">Asia/Riyadh (Arabia Standard Time, UTC+3)</option>
                    <option value="Asia/Kuwait">Asia/Kuwait (Arabia Standard Time, UTC+3)</option>
                    <option value="Asia/Qatar">Asia/Qatar (Arabia Standard Time, UTC+3)</option>
                    <option value="Asia/Bahrain">Asia/Bahrain (Arabia Standard Time, UTC+3)</option>
                    <option value="Africa/Cairo">Africa/Cairo (Eastern European Time, UTC+2)</option>
                    <option value="Europe/London">Europe/London (GMT/BST)</option>
                    <option value="Europe/Paris">Europe/Paris (CET/CEST)</option>
                    <option value="Europe/Berlin">Europe/Berlin (CET/CEST)</option>
                    <option value="America/New_York">America/New_York (Eastern Time)</option>
                    <option value="America/Chicago">America/Chicago (Central Time)</option>
                    <option value="America/Denver">America/Denver (Mountain Time)</option>
                    <option value="America/Los_Angeles">America/Los_Angeles (Pacific Time)</option>
                    <option value="Asia/Singapore">Asia/Singapore (Singapore Time, UTC+8)</option>
                    <option value="Asia/Hong_Kong">Asia/Hong_Kong (Hong Kong Time, UTC+8)</option>
                    <option value="Asia/Tokyo">Asia/Tokyo (Japan Standard Time, UTC+9)</option>
                    <option value="Australia/Sydney">Australia/Sydney (AEST/AEDT)</option>
                  </optgroup>
                  <optgroup label="Middle East">
                    <option value="Asia/Muscat">Asia/Muscat (Oman, UTC+4)</option>
                    <option value="Asia/Baghdad">Asia/Baghdad (Iraq, UTC+3)</option>
                    <option value="Asia/Amman">Asia/Amman (Jordan, UTC+3)</option>
                    <option value="Asia/Beirut">Asia/Beirut (Lebanon, UTC+2)</option>
                    <option value="Asia/Jerusalem">Asia/Jerusalem (Israel, UTC+2)</option>
                  </optgroup>
                  <optgroup label="Africa">
                    <option value="Africa/Johannesburg">Africa/Johannesburg (South Africa, UTC+2)</option>
                    <option value="Africa/Lagos">Africa/Lagos (Nigeria, UTC+1)</option>
                    <option value="Africa/Nairobi">Africa/Nairobi (Kenya, UTC+3)</option>
                  </optgroup>
                  <optgroup label="Asia Pacific">
                    <option value="Asia/Kolkata">Asia/Kolkata (India, UTC+5:30)</option>
                    <option value="Asia/Karachi">Asia/Karachi (Pakistan, UTC+5)</option>
                    <option value="Asia/Bangkok">Asia/Bangkok (Thailand, UTC+7)</option>
                    <option value="Asia/Jakarta">Asia/Jakarta (Indonesia, UTC+7)</option>
                    <option value="Asia/Manila">Asia/Manila (Philippines, UTC+8)</option>
                    <option value="Asia/Seoul">Asia/Seoul (South Korea, UTC+9)</option>
                    <option value="Asia/Shanghai">Asia/Shanghai (China, UTC+8)</option>
                  </optgroup>
                </select>
                <p className="text-xs text-muted-foreground">
                  Enterprise timezone for analysis and reporting
                </p>
              </div>

              {/* Subscription Plan */}
              <div className="space-y-2">
                <Label htmlFor="subscription_plan">
                  Subscription Plan <span className="text-red-500">*</span>
                </Label>
                <select
                  id="subscription_plan"
                  value={formData.subscription_plan}
                  onChange={(e) => setFormData((prev) => ({ ...prev, subscription_plan: e.target.value }))}
                  className="w-full h-10 px-3 rounded-md border border-input bg-background min-h-[44px]"
                  required
                >
                  <option value="starter">Starter</option>
                  <option value="advanced">Advance</option>
                  <option value="pro">Pro</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  The subscription tier determines feature access and limits
                </p>
              </div>

              {/* Active status toggle */}
              <div className="flex items-center gap-3 p-4 border rounded-lg">
                <input
                  type="checkbox"
                  id="is_active"
                  name="is_active"
                  checked={formData.is_active}
                  onChange={handleChange}
                  className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <div>
                  <Label htmlFor="is_active" className="cursor-pointer">
                    Enterprise Active
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Inactive enterprises cannot create new projects or claim controllers.
                  </p>
                </div>
              </div>

              {/* Save button */}
              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={saving} className="min-h-[44px]">
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="mt-4 border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
            <CardDescription>
              These actions are irreversible. Please be careful.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Deactivate Enterprise */}
            <div className="flex items-center justify-between p-4 border border-destructive/30 rounded-lg">
              <div>
                <p className="font-medium">Deactivate Enterprise</p>
                <p className="text-sm text-muted-foreground">
                  This will prevent any activity from this enterprise.
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={() => {
                  setFormData((prev) => ({ ...prev, is_active: false }));
                  toast.info("Toggle saved. Click 'Save Changes' to apply.");
                }}
                disabled={!formData.is_active}
                className="min-h-[44px]"
              >
                Deactivate
              </Button>
            </div>

            {/* Delete Enterprise - only for super_admin */}
            {isSuperAdmin && (
              <div className="flex items-center justify-between p-4 border border-red-500 rounded-lg bg-red-50/50">
                <div>
                  <p className="font-medium text-red-700">Delete Enterprise</p>
                  <p className="text-sm text-red-600/80">
                    Permanently delete this enterprise and unassign all users, projects, and controllers.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setShowDeleteEnterprise(true)}
                  className="min-h-[44px] bg-red-600 hover:bg-red-700"
                >
                  Delete
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Delete User Confirmation Dialog with Password */}
      <Dialog
        open={!!userToDelete}
        onOpenChange={(open) => {
          if (!open) {
            setUserToDelete(null);
            setConfirmPassword("");
          }
        }}
      >
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5 text-red-600"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </div>
              Delete User
            </DialogTitle>
            <DialogDescription className="pt-2">
              Are you sure you want to delete{" "}
              <strong>{userToDelete?.full_name || userToDelete?.email}</strong>?
              <br />
              <span className="text-red-600">
                This will permanently remove this user from the system. This action cannot be undone.
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="confirm-password">
                Enter your password to confirm
              </Label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="Your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="min-h-[44px]"
                autoComplete="current-password"
              />
              <p className="text-xs text-muted-foreground">
                For security, please enter your password to confirm this action.
              </p>
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => {
                setUserToDelete(null);
                setConfirmPassword("");
              }}
              disabled={deleteLoading}
              className="min-h-[44px] w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteUser}
              disabled={deleteLoading || !confirmPassword}
              className="min-h-[44px] w-full sm:w-auto"
            >
              {deleteLoading ? "Deleting..." : "Delete User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Enterprise Confirmation Dialog with Password */}
      <Dialog
        open={showDeleteEnterprise}
        onOpenChange={(open) => {
          if (!open) {
            setShowDeleteEnterprise(false);
            setConfirmEnterpriseName("");
            setEnterpriseDeletePassword("");
          }
        }}
      >
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5 text-red-600"
                >
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                </svg>
              </div>
              Delete Enterprise
            </DialogTitle>
            <DialogDescription className="pt-2 space-y-2">
              <span>
                Are you sure you want to <strong className="text-red-600">PERMANENTLY</strong> delete{" "}
                <strong>&quot;{enterprise.name}&quot;</strong>?
              </span>
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
                <p className="font-medium text-red-700 mb-2">This action will:</p>
                <ul className="list-disc list-inside text-red-600 space-y-1">
                  <li>Remove all enterprise settings</li>
                  <li className="font-bold">
                    PERMANENTLY DELETE {users.length} user(s) attached to this enterprise
                  </li>
                  <li>Unassign all projects from this enterprise</li>
                  <li>Release all claimed controllers</li>
                </ul>
                <p className="mt-2 font-bold text-red-700">This action cannot be undone!</p>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Type enterprise name to confirm */}
            <div className="space-y-2">
              <Label htmlFor="confirm-enterprise-name">
                Type <span className="font-mono font-bold">{enterprise.name}</span> to confirm
              </Label>
              <Input
                id="confirm-enterprise-name"
                type="text"
                placeholder="Enterprise name"
                value={confirmEnterpriseName}
                onChange={(e) => setConfirmEnterpriseName(e.target.value)}
                className="min-h-[44px]"
              />
            </div>

            {/* Password field */}
            <div className="space-y-2">
              <Label htmlFor="enterprise-delete-password">
                Enter your password
              </Label>
              <Input
                id="enterprise-delete-password"
                type="password"
                placeholder="Your password"
                value={enterpriseDeletePassword}
                onChange={(e) => setEnterpriseDeletePassword(e.target.value)}
                className="min-h-[44px]"
                autoComplete="current-password"
              />
              <p className="text-xs text-muted-foreground">
                For security, please enter your password to confirm this action.
              </p>
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteEnterprise(false);
                setConfirmEnterpriseName("");
                setEnterpriseDeletePassword("");
              }}
              disabled={enterpriseDeleteLoading}
              className="min-h-[44px] w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteEnterprise}
              disabled={
                enterpriseDeleteLoading ||
                confirmEnterpriseName !== enterprise.name ||
                !enterpriseDeletePassword
              }
              className="min-h-[44px] w-full sm:w-auto bg-red-600 hover:bg-red-700"
            >
              {enterpriseDeleteLoading ? "Deleting..." : "Delete Enterprise"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
