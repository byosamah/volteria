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

// Enterprise settings schema
interface EnterpriseSettings {
  defaults: {
    dg_reserve_kw: number;
    control_interval_ms: number;
  };
  features: {
    remote_control_enabled: boolean;
    data_export_enabled: boolean;
    api_access_enabled: boolean;
  };
  notifications: {
    email_alerts: boolean;
    alert_threshold_pct: number;
  };
}

// Default settings for new enterprises
const DEFAULT_ENTERPRISE_SETTINGS: EnterpriseSettings = {
  defaults: {
    dg_reserve_kw: 0,
    control_interval_ms: 1000,
  },
  features: {
    remote_control_enabled: true,
    data_export_enabled: true,
    api_access_enabled: false,
  },
  notifications: {
    email_alerts: true,
    alert_threshold_pct: 80,
  },
};

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
  is_active: boolean;
  created_at: string;
  settings: EnterpriseSettings | null;
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
  controller_status: string;
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

  // Check if current user is super_admin
  const isSuperAdmin = currentUser.role === "super_admin";

  // Settings form state
  const [formData, setFormData] = useState({
    contact_email: enterprise.contact_email || "",
    contact_phone: enterprise.contact_phone || "",
    address: enterprise.address || "",
    city: enterprise.city || "",
    country: enterprise.country || "",
    is_active: enterprise.is_active,
  });

  // Enterprise-specific settings (stored in JSONB `settings` field)
  const [enterpriseSettings, setEnterpriseSettings] = useState<EnterpriseSettings>(() => {
    // Merge existing settings with defaults to ensure all fields exist
    // Type assertion for the JSONB settings field
    const existing = (enterprise.settings || {}) as Partial<EnterpriseSettings>;
    return {
      defaults: {
        dg_reserve_kw: existing.defaults?.dg_reserve_kw ?? DEFAULT_ENTERPRISE_SETTINGS.defaults.dg_reserve_kw,
        control_interval_ms: existing.defaults?.control_interval_ms ?? DEFAULT_ENTERPRISE_SETTINGS.defaults.control_interval_ms,
      },
      features: {
        remote_control_enabled: existing.features?.remote_control_enabled ?? DEFAULT_ENTERPRISE_SETTINGS.features.remote_control_enabled,
        data_export_enabled: existing.features?.data_export_enabled ?? DEFAULT_ENTERPRISE_SETTINGS.features.data_export_enabled,
        api_access_enabled: existing.features?.api_access_enabled ?? DEFAULT_ENTERPRISE_SETTINGS.features.api_access_enabled,
      },
      notifications: {
        email_alerts: existing.notifications?.email_alerts ?? DEFAULT_ENTERPRISE_SETTINGS.notifications.email_alerts,
        alert_threshold_pct: existing.notifications?.alert_threshold_pct ?? DEFAULT_ENTERPRISE_SETTINGS.notifications.alert_threshold_pct,
      },
    };
  });

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  // Handle enterprise settings changes
  const handleSettingsChange = (
    category: keyof EnterpriseSettings,
    field: string,
    value: number | boolean
  ) => {
    setEnterpriseSettings((prev) => ({
      ...prev,
      [category]: {
        ...prev[category],
        [field]: value,
      },
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
          is_active: formData.is_active,
          // Include enterprise-specific settings in JSONB field
          settings: enterpriseSettings,
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

  // Get status badge variant for controllers
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "deployed":
        return <Badge className="bg-green-500">Deployed</Badge>;
      case "ready":
        return <Badge className="bg-yellow-500">Ready</Badge>;
      default:
        return <Badge variant="secondary">Draft</Badge>;
    }
  };

  // Get status badge for controller_status (projects)
  const getProjectStatusBadge = (status: string) => {
    switch (status) {
      case "online":
        return <Badge className="bg-green-500">Online</Badge>;
      case "offline":
        return <Badge variant="destructive">Offline</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  return (
    <Tabs defaultValue="controllers" className="w-full">
      {/* Tab navigation - scrollable on mobile */}
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="controllers" className="flex-shrink-0">
          Controllers ({controllers.length})
        </TabsTrigger>
        <TabsTrigger value="projects" className="flex-shrink-0">
          Projects ({projects.length})
        </TabsTrigger>
        <TabsTrigger value="users" className="flex-shrink-0">
          Users ({users.length})
        </TabsTrigger>
        <TabsTrigger value="settings" className="flex-shrink-0">
          Settings
        </TabsTrigger>
      </TabsList>

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
                        {getProjectStatusBadge(project.controller_status)}
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

        {/* Enterprise System Settings */}
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>System Settings</CardTitle>
            <CardDescription>
              Configure default values and feature access for this enterprise.
              These settings apply to all projects and sites within the enterprise.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Default Site Values */}
            <div className="space-y-4">
              <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                Default Site Values
              </h4>
              <p className="text-sm text-muted-foreground">
                These values will be used as defaults when creating new sites.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="dg_reserve_kw">Default DG Reserve (kW)</Label>
                  <Input
                    id="dg_reserve_kw"
                    type="number"
                    min="0"
                    step="1"
                    value={enterpriseSettings.defaults.dg_reserve_kw}
                    onChange={(e) =>
                      handleSettingsChange("defaults", "dg_reserve_kw", Number(e.target.value))
                    }
                    className="min-h-[44px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    Minimum power the DG should maintain
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="control_interval_ms">Control Interval (ms)</Label>
                  <Input
                    id="control_interval_ms"
                    type="number"
                    min="100"
                    max="10000"
                    step="100"
                    value={enterpriseSettings.defaults.control_interval_ms}
                    onChange={(e) =>
                      handleSettingsChange("defaults", "control_interval_ms", Number(e.target.value))
                    }
                    className="min-h-[44px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    How often the control loop runs (1000 = 1 second)
                  </p>
                </div>
              </div>
            </div>

            {/* Feature Toggles */}
            <div className="space-y-4 border-t pt-6">
              <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                Feature Access
              </h4>
              <p className="text-sm text-muted-foreground">
                Control which features are available to this enterprise.
              </p>
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 border rounded-lg">
                  <input
                    type="checkbox"
                    id="remote_control_enabled"
                    checked={enterpriseSettings.features.remote_control_enabled}
                    onChange={(e) =>
                      handleSettingsChange("features", "remote_control_enabled", e.target.checked)
                    }
                    className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <div className="flex-1">
                    <Label htmlFor="remote_control_enabled" className="cursor-pointer">
                      Remote Control
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Allow users to remotely control site settings and devices
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 border rounded-lg">
                  <input
                    type="checkbox"
                    id="data_export_enabled"
                    checked={enterpriseSettings.features.data_export_enabled}
                    onChange={(e) =>
                      handleSettingsChange("features", "data_export_enabled", e.target.checked)
                    }
                    className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <div className="flex-1">
                    <Label htmlFor="data_export_enabled" className="cursor-pointer">
                      Data Export
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Allow users to export control logs and reports
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 border rounded-lg">
                  <input
                    type="checkbox"
                    id="api_access_enabled"
                    checked={enterpriseSettings.features.api_access_enabled}
                    onChange={(e) =>
                      handleSettingsChange("features", "api_access_enabled", e.target.checked)
                    }
                    className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <div className="flex-1">
                    <Label htmlFor="api_access_enabled" className="cursor-pointer">
                      API Access
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Allow programmatic access to data via REST API
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Notification Settings */}
            <div className="space-y-4 border-t pt-6">
              <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                Notifications
              </h4>
              <p className="text-sm text-muted-foreground">
                Configure alert thresholds and notification preferences.
              </p>
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 border rounded-lg">
                  <input
                    type="checkbox"
                    id="email_alerts"
                    checked={enterpriseSettings.notifications.email_alerts}
                    onChange={(e) =>
                      handleSettingsChange("notifications", "email_alerts", e.target.checked)
                    }
                    className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <div className="flex-1">
                    <Label htmlFor="email_alerts" className="cursor-pointer">
                      Email Alerts
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Send email notifications for critical alarms
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="alert_threshold_pct">
                    Alert Threshold ({enterpriseSettings.notifications.alert_threshold_pct}%)
                  </Label>
                  <input
                    id="alert_threshold_pct"
                    type="range"
                    min="50"
                    max="100"
                    step="5"
                    value={enterpriseSettings.notifications.alert_threshold_pct}
                    onChange={(e) =>
                      handleSettingsChange("notifications", "alert_threshold_pct", Number(e.target.value))
                    }
                    className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                  />
                  <p className="text-xs text-muted-foreground">
                    Send alert when DG load exceeds this percentage of capacity
                  </p>
                </div>
              </div>
            </div>

            {/* Save System Settings Button */}
            <div className="flex justify-end pt-4 border-t">
              <Button
                onClick={async () => {
                  setSaving(true);
                  try {
                    const { error } = await supabase
                      .from("enterprises")
                      .update({ settings: enterpriseSettings })
                      .eq("id", enterprise.id);
                    if (error) throw error;
                    toast.success("System settings saved");
                    router.refresh();
                  } catch (err) {
                    console.error(err);
                    toast.error("Failed to save settings");
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
                className="min-h-[44px]"
              >
                {saving ? "Saving..." : "Save System Settings"}
              </Button>
            </div>
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
          <CardContent>
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
    </Tabs>
  );
}
