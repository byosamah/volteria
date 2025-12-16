"use client";

/**
 * Users List Component
 *
 * Client component for displaying and managing users.
 * Features:
 * - Search by name/email
 * - Filter by role, enterprise, status
 * - Create user (email invite or direct)
 * - Edit user with project assignment
 * - Delete user with password verification
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Search, Plus, Pencil, Trash2, UserPlus, Mail, Key, ChevronDown, ChevronUp } from "lucide-react";
import { ProjectNotificationSettings, DEFAULT_NOTIFICATION_SETTINGS } from "@/components/users/project-notification-settings";
import { UserProjectNotificationSettings } from "@/lib/types";

// Type definitions
interface User {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
  enterprise_id: string | null;
  avatar_url: string | null;
  created_at: string;
  enterprises: { name: string } | null;
}

interface Enterprise {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  enterprise_id: string | null;
}

interface CurrentUser {
  id: string;
  role: string;
  enterprise_id: string | null;
}

interface ProjectAssignment {
  project_id: string;
  project_name: string | null;
  can_edit: boolean;
  can_control: boolean;
}

interface UsersListProps {
  users: User[];
  enterprises: Enterprise[];
  projects: Project[];
  currentUser: CurrentUser;
}

// Role badge colors
const roleColors: Record<string, string> = {
  super_admin: "bg-red-100 text-red-800 border-red-200",
  backend_admin: "bg-purple-100 text-purple-800 border-purple-200",
  enterprise_admin: "bg-blue-100 text-blue-800 border-blue-200",
  admin: "bg-blue-100 text-blue-800 border-blue-200",
  configurator: "bg-yellow-100 text-yellow-800 border-yellow-200",
  viewer: "bg-gray-100 text-gray-800 border-gray-200",
};

// Role display names
const roleNames: Record<string, string> = {
  super_admin: "Super Admin",
  backend_admin: "Backend Admin",
  enterprise_admin: "Enterprise Admin",
  admin: "Admin",
  configurator: "Configurator",
  viewer: "Viewer",
};

export function UsersList({ users: initialUsers, enterprises, projects, currentUser }: UsersListProps) {
  const router = useRouter();
  const supabase = createClient();

  // State
  const [users, setUsers] = useState(initialUsers);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [enterpriseFilter, setEnterpriseFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createMethod, setCreateMethod] = useState<"email" | "direct">("email");
  const [createLoading, setCreateLoading] = useState(false);
  const [createData, setCreateData] = useState({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
    phone: "",
    role: "viewer",
    enterprise_id: "",
  });

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editData, setEditData] = useState({
    full_name: "",
    phone: "",
    role: "",
    enterprise_id: "",
    is_active: true,
  });
  const [userProjects, setUserProjects] = useState<ProjectAssignment[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  // Notification settings state
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [projectNotificationSettings, setProjectNotificationSettings] = useState<
    Record<string, UserProjectNotificationSettings>
  >({});

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Filter users
  const filteredUsers = users.filter((u) => {
    // Search filter
    if (searchQuery) {
      const search = searchQuery.toLowerCase();
      const matchesSearch =
        u.email.toLowerCase().includes(search) ||
        (u.full_name && u.full_name.toLowerCase().includes(search));
      if (!matchesSearch) return false;
    }

    // Role filter
    if (roleFilter !== "all" && u.role !== roleFilter) return false;

    // Enterprise filter
    if (enterpriseFilter !== "all") {
      if (enterpriseFilter === "none" && u.enterprise_id !== null) return false;
      if (enterpriseFilter !== "none" && u.enterprise_id !== enterpriseFilter) return false;
    }

    // Status filter
    if (statusFilter === "active" && !u.is_active) return false;
    if (statusFilter === "inactive" && u.is_active) return false;

    return true;
  });

  // Get available roles based on current user's role
  const getAvailableRoles = () => {
    if (currentUser.role === "enterprise_admin") {
      return [
        { value: "configurator", label: "Configurator" },
        { value: "viewer", label: "Viewer" },
      ];
    }
    return [
      { value: "super_admin", label: "Super Admin" },
      { value: "backend_admin", label: "Backend Admin" },
      { value: "enterprise_admin", label: "Enterprise Admin" },
      { value: "configurator", label: "Configurator" },
      { value: "viewer", label: "Viewer" },
    ];
  };

  // Get initials for avatar
  const getInitials = (name: string | null, email: string) => {
    if (name) {
      const parts = name.split(" ");
      return parts.map((p) => p[0]).join("").toUpperCase().slice(0, 2);
    }
    return email[0].toUpperCase();
  };

  // Handle create user
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);

    try {
      // Validate
      if (!createData.email.trim()) {
        toast.error("Email is required");
        setCreateLoading(false);
        return;
      }

      if (createMethod === "direct" && (!createData.password || createData.password.length < 6)) {
        toast.error("Password must be at least 6 characters");
        setCreateLoading(false);
        setCreateData(prev => ({ ...prev, password: "" })); // Security: clear password on validation error
        return;
      }

      const fullName = [createData.first_name, createData.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();

      const endpoint = createMethod === "email" ? "/api/admin/invite" : "/api/admin/users";

      const payload: Record<string, string | undefined> = {
        email: createData.email.trim(),
        role: createData.role,
        first_name: createData.first_name.trim() || undefined,
        last_name: createData.last_name.trim() || undefined,
        phone: createData.phone.trim() || undefined,
      };

      // Add enterprise_id if set
      if (createData.enterprise_id) {
        payload.enterprise_id = createData.enterprise_id;
      } else if (currentUser.role === "enterprise_admin" && currentUser.enterprise_id) {
        // Enterprise admin: auto-assign to their enterprise
        payload.enterprise_id = currentUser.enterprise_id;
      }

      if (createMethod === "direct") {
        payload.password = createData.password;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Safely parse JSON response (may fail on malformed responses)
      let result;
      try {
        result = await response.json();
      } catch {
        toast.error("Invalid server response");
        setCreateLoading(false);
        setCreateData(prev => ({ ...prev, password: "" }));
        return;
      }

      if (!response.ok) {
        toast.error(result.message || "Failed to create user");
        setCreateLoading(false);
        setCreateData(prev => ({ ...prev, password: "" })); // Security: clear password on error
        return;
      }

      toast.success(
        createMethod === "email"
          ? "Invitation sent successfully"
          : "User created successfully"
      );

      setCreateOpen(false);
      setCreateData({
        email: "",
        password: "",
        first_name: "",
        last_name: "",
        phone: "",
        role: "viewer",
        enterprise_id: "",
      });
      router.refresh();
    } catch (err) {
      console.error("Create user error:", err);
      toast.error("An unexpected error occurred");
      setCreateData(prev => ({ ...prev, password: "" })); // Security: clear password on error
    } finally {
      setCreateLoading(false);
    }
  };

  // Open edit dialog
  const openEditDialog = async (user: User) => {
    setEditUser(user);
    setEditData({
      full_name: user.full_name || "",
      phone: user.phone || "",
      role: user.role,
      enterprise_id: user.enterprise_id || "",
      is_active: user.is_active,
    });
    setEditOpen(true);
    // Reset notification state
    setExpandedProjects(new Set());
    setProjectNotificationSettings({});

    // Check if Enterprise Admin is editing themselves
    const isSelfEditingEnterpriseAdmin =
      currentUser.role === "enterprise_admin" &&
      user.id === currentUser.id;

    setProjectsLoading(true);
    try {
      if (isSelfEditingEnterpriseAdmin) {
        // Enterprise Admin editing themselves: auto-assign ALL enterprise projects
        // Filter projects that belong to their enterprise
        const enterpriseProjects = projects.filter(
          (p) => p.enterprise_id === currentUser.enterprise_id
        );

        // Create assignments with full permissions for all enterprise projects
        const autoAssignments: ProjectAssignment[] = enterpriseProjects.map((p) => ({
          project_id: p.id,
          project_name: p.name,
          can_edit: true,
          can_control: true,
        }));

        setUserProjects(autoAssignments);
      } else {
        // Normal case: fetch user's actual project assignments
        const response = await fetch(`/api/admin/users/${user.id}/projects`);
        if (response.ok) {
          const data = await response.json();
          setUserProjects(data.assignments || []);
        }
      }
    } catch (err) {
      console.error("Failed to fetch user projects:", err);
    } finally {
      setProjectsLoading(false);
    }
  };

  // Handle edit user
  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;

    setEditLoading(true);

    try {
      // Build request body - only include enterprise_id if user can change it
      // Only super_admin and backend_admin can change enterprise assignment
      const canModifyEnterprise = ["super_admin", "backend_admin"].includes(currentUser.role);
      const requestBody: Record<string, unknown> = {
        full_name: editData.full_name.trim() || null,
        phone: editData.phone.trim() || null,
        role: editData.role,
        is_active: editData.is_active,
      };
      if (canModifyEnterprise) {
        requestBody.enterprise_id = editData.enterprise_id || null;
      }

      const response = await fetch(`/api/admin/users/${editUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      // Safely parse JSON response
      let result;
      try {
        result = await response.json();
      } catch {
        toast.error("Invalid server response");
        setEditLoading(false);
        return;
      }

      if (!response.ok) {
        toast.error(result.message || "Failed to update user");
        setEditLoading(false);
        return;
      }

      toast.success("User updated successfully");
      setEditOpen(false);
      router.refresh();
    } catch (err) {
      console.error("Edit user error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setEditLoading(false);
    }
  };

  // Handle project assignment toggle
  const handleProjectToggle = async (projectId: string, field: "can_edit" | "can_control", value: boolean) => {
    if (!editUser) return;

    const existingAssignment = userProjects.find((p) => p.project_id === projectId);

    try {
      const response = await fetch(`/api/admin/users/${editUser.id}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          can_edit: field === "can_edit" ? value : existingAssignment?.can_edit || false,
          can_control: field === "can_control" ? value : existingAssignment?.can_control || false,
        }),
      });

      if (response.ok) {
        // Update local state
        setUserProjects((prev) => {
          const existing = prev.find((p) => p.project_id === projectId);
          if (existing) {
            return prev.map((p) =>
              p.project_id === projectId ? { ...p, [field]: value } : p
            );
          }
          const project = projects.find((p) => p.id === projectId);
          return [
            ...prev,
            {
              project_id: projectId,
              project_name: project?.name || null,
              can_edit: field === "can_edit" ? value : false,
              can_control: field === "can_control" ? value : false,
            },
          ];
        });
        toast.success("Project assignment updated");
      }
    } catch (err) {
      console.error("Project assignment error:", err);
      toast.error("Failed to update project assignment");
    }
  };

  // Handle remove from project
  const handleRemoveFromProject = async (projectId: string) => {
    if (!editUser) return;

    try {
      const response = await fetch(`/api/admin/users/${editUser.id}/projects/${projectId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setUserProjects((prev) => prev.filter((p) => p.project_id !== projectId));
        // Also remove notification settings from state
        setProjectNotificationSettings((prev) => {
          const updated = { ...prev };
          delete updated[projectId];
          return updated;
        });
        // Collapse if expanded
        setExpandedProjects((prev) => {
          const updated = new Set(prev);
          updated.delete(projectId);
          return updated;
        });
        toast.success("User removed from project");
      }
    } catch (err) {
      console.error("Remove from project error:", err);
      toast.error("Failed to remove user from project");
    }
  };

  // Toggle project expansion for notification settings
  const toggleProjectExpansion = async (projectId: string) => {
    const isCurrentlyExpanded = expandedProjects.has(projectId);

    if (isCurrentlyExpanded) {
      // Collapse
      setExpandedProjects((prev) => {
        const updated = new Set(prev);
        updated.delete(projectId);
        return updated;
      });
    } else {
      // Expand and fetch settings if not already loaded
      setExpandedProjects((prev) => new Set(prev).add(projectId));

      // Fetch notification settings if not already loaded
      if (!projectNotificationSettings[projectId] && editUser) {
        try {
          const response = await fetch(
            `/api/admin/users/${editUser.id}/projects/${projectId}/notifications`
          );
          if (response.ok) {
            const settings = await response.json();
            setProjectNotificationSettings((prev) => ({
              ...prev,
              [projectId]: settings,
            }));
          }
        } catch (err) {
          console.error("Failed to fetch notification settings:", err);
          // Use defaults on error
          setProjectNotificationSettings((prev) => ({
            ...prev,
            [projectId]: DEFAULT_NOTIFICATION_SETTINGS,
          }));
        }
      }
    }
  };

  // Update notification settings for a project
  const updateNotificationSettings = async (
    projectId: string,
    settings: UserProjectNotificationSettings
  ) => {
    if (!editUser) return;

    // Optimistically update UI
    setProjectNotificationSettings((prev) => ({
      ...prev,
      [projectId]: settings,
    }));

    // Save to server
    try {
      const response = await fetch(
        `/api/admin/users/${editUser.id}/projects/${projectId}/notifications`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
        }
      );

      if (!response.ok) {
        toast.error("Failed to save notification settings");
      }
    } catch (err) {
      console.error("Update notification settings error:", err);
      toast.error("Failed to save notification settings");
    }
  };

  // Open delete dialog
  const openDeleteDialog = (user: User) => {
    setDeleteUser(user);
    setDeletePassword("");
    setDeleteOpen(true);
  };

  // Handle delete user
  const handleDelete = async () => {
    if (!deleteUser || !deletePassword) return;

    setDeleteLoading(true);

    try {
      const response = await fetch(`/api/admin/users/${deleteUser.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      });

      // Safely parse JSON response
      let result;
      try {
        result = await response.json();
      } catch {
        toast.error("Invalid server response");
        setDeleteLoading(false);
        setDeletePassword("");
        return;
      }

      if (!response.ok) {
        toast.error(result.message || "Failed to delete user");
        setDeleteLoading(false);
        setDeletePassword(""); // Security: clear password on error
        return;
      }

      toast.success("User deleted successfully");

      // Optimistic UI update - remove user from local state immediately
      // This provides instant feedback without waiting for router.refresh()
      setUsers(prevUsers => prevUsers.filter(u => u.id !== deleteUser.id));

      // Clean up dialog state
      setDeleteOpen(false);
      setDeleteUser(null);
      setDeletePassword("");

      // Still refresh to sync with server (but UI is already updated)
      router.refresh();
    } catch (err) {
      console.error("Delete user error:", err);
      toast.error("An unexpected error occurred");
      setDeletePassword(""); // Security: clear password on error
    } finally {
      setDeleteLoading(false);
    }
  };

  // Check if user can be deleted (only super_admin can delete)
  const canDelete = currentUser.role === "super_admin";

  // Check if user can change enterprise (only super_admin and backend_admin)
  const canChangeEnterprise = ["super_admin", "backend_admin"].includes(currentUser.role);

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            {/* Search */}
            <div className="flex-1">
              <Label htmlFor="search" className="sr-only">
                Search
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Search by name or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Role Filter */}
            <div className="w-full md:w-40">
              <Label htmlFor="role-filter" className="sr-only">
                Role
              </Label>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger id="role-filter">
                  <SelectValue placeholder="All Roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                  <SelectItem value="backend_admin">Backend Admin</SelectItem>
                  <SelectItem value="enterprise_admin">Enterprise Admin</SelectItem>
                  <SelectItem value="configurator">Configurator</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Enterprise Filter (only for super admin) */}
            {canChangeEnterprise && (
              <div className="w-full md:w-48">
                <Label htmlFor="enterprise-filter" className="sr-only">
                  Enterprise
                </Label>
                <Select value={enterpriseFilter} onValueChange={setEnterpriseFilter}>
                  <SelectTrigger id="enterprise-filter">
                    <SelectValue placeholder="All Enterprises" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Enterprises</SelectItem>
                    <SelectItem value="none">No Enterprise</SelectItem>
                    {enterprises.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Status Filter */}
            <div className="w-full md:w-32">
              <Label htmlFor="status-filter" className="sr-only">
                Status
              </Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="status-filter">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Create Button */}
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* MOBILE: Card view for small screens */}
      <div className="sm:hidden space-y-3">
        {filteredUsers.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No users found
            </CardContent>
          </Card>
        ) : (
          filteredUsers.map((user) => (
            <Card key={user.id}>
              <CardContent className="p-4">
                {/* Header: Avatar + Name + Actions */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Avatar className="h-10 w-10 flex-shrink-0">
                      <AvatarImage src={user.avatar_url || undefined} />
                      <AvatarFallback className="text-sm">
                        {getInitials(user.full_name, user.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">
                        {user.full_name || "No name"}
                      </p>
                      <p className="text-sm text-muted-foreground truncate">
                        {user.email}
                      </p>
                    </div>
                  </div>
                  {/* Action Buttons - 44px touch targets */}
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditDialog(user)}
                      className="min-w-[44px] min-h-[44px]"
                      aria-label={`Edit user ${user.full_name || user.email}`}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    {canDelete && user.id !== currentUser.id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openDeleteDialog(user)}
                        className="min-w-[44px] min-h-[44px]"
                        aria-label={`Delete user ${user.full_name || user.email}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Badges: Role, Enterprise, Status */}
                <div className="flex flex-wrap gap-2">
                  <Badge
                    variant="outline"
                    className={roleColors[user.role] || roleColors.viewer}
                  >
                    {roleNames[user.role] || user.role}
                  </Badge>
                  {canChangeEnterprise && user.enterprises?.name && (
                    <Badge variant="outline">
                      {user.enterprises.name}
                    </Badge>
                  )}
                  <Badge variant={user.is_active ? "default" : "secondary"}>
                    {user.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* DESKTOP: Table view for larger screens */}
      <Card className="hidden sm:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                {canChangeEnterprise && <TableHead>Enterprise</TableHead>}
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canChangeEnterprise ? 5 : 4} className="text-center py-8 text-muted-foreground">
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={user.avatar_url || undefined} />
                          <AvatarFallback className="text-xs">
                            {getInitials(user.full_name, user.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="font-medium truncate max-w-[200px]">
                            {user.full_name || "No name"}
                          </div>
                          <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                            {user.email}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={roleColors[user.role] || roleColors.viewer}
                      >
                        {roleNames[user.role] || user.role}
                      </Badge>
                    </TableCell>
                    {canChangeEnterprise && (
                      <TableCell>
                        {user.enterprises?.name || (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge variant={user.is_active ? "default" : "secondary"}>
                        {user.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(user)}
                          className="min-w-[44px] min-h-[44px]"
                          aria-label={`Edit user ${user.full_name || user.email}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {canDelete && user.id !== currentUser.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openDeleteDialog(user)}
                            className="min-w-[44px] min-h-[44px]"
                            aria-label={`Delete user ${user.full_name || user.email}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>
              Create a new user account or send an email invitation.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            {/* Creation Method Toggle */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant={createMethod === "email" ? "default" : "outline"}
                size="sm"
                onClick={() => setCreateMethod("email")}
                className="flex-1"
              >
                <Mail className="h-4 w-4 mr-2" />
                Email Invite
              </Button>
              <Button
                type="button"
                variant={createMethod === "direct" ? "default" : "outline"}
                size="sm"
                onClick={() => setCreateMethod("direct")}
                className="flex-1"
              >
                <Key className="h-4 w-4 mr-2" />
                Direct Create
              </Button>
            </div>

            {/* Name Fields */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="first_name">First Name</Label>
                <Input
                  id="first_name"
                  value={createData.first_name}
                  onChange={(e) =>
                    setCreateData({ ...createData, first_name: e.target.value })
                  }
                  placeholder="John"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name">Last Name</Label>
                <Input
                  id="last_name"
                  value={createData.last_name}
                  onChange={(e) =>
                    setCreateData({ ...createData, last_name: e.target.value })
                  }
                  placeholder="Doe"
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                required
                value={createData.email}
                onChange={(e) =>
                  setCreateData({ ...createData, email: e.target.value })
                }
                placeholder="john@example.com"
              />
            </div>

            {/* Mobile Number */}
            <div className="space-y-2">
              <Label htmlFor="phone">Mobile Number</Label>
              <Input
                id="phone"
                type="tel"
                value={createData.phone}
                onChange={(e) =>
                  setCreateData({ ...createData, phone: e.target.value })
                }
                placeholder="+966 50 123 4567"
              />
              <p className="text-xs text-muted-foreground">
                For receiving alarm notifications
              </p>
            </div>

            {/* Password (for direct creation) */}
            {createMethod === "direct" && (
              <div className="space-y-2">
                <Label htmlFor="password">Password *</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  value={createData.password}
                  onChange={(e) =>
                    setCreateData({ ...createData, password: e.target.value })
                  }
                  placeholder="Minimum 6 characters"
                />
              </div>
            )}

            {/* Role */}
            <div className="space-y-2">
              <Label htmlFor="create-role">Role *</Label>
              <Select
                value={createData.role}
                onValueChange={(value) =>
                  setCreateData({ ...createData, role: value })
                }
              >
                <SelectTrigger id="create-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getAvailableRoles().map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Enterprise (only for super admin) */}
            {canChangeEnterprise && (
              <div className="space-y-2">
                <Label htmlFor="create-enterprise">Enterprise</Label>
                <Select
                  value={createData.enterprise_id || "none"}
                  onValueChange={(value) =>
                    setCreateData({ ...createData, enterprise_id: value === "none" ? "" : value })
                  }
                >
                  <SelectTrigger id="create-enterprise">
                    <SelectValue placeholder="No enterprise" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Enterprise</SelectItem>
                    {enterprises.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createLoading}>
                {createLoading
                  ? "Creating..."
                  : createMethod === "email"
                  ? "Send Invitation"
                  : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user details and project assignments.
            </DialogDescription>
          </DialogHeader>

          {editUser && (
            <form onSubmit={handleEdit} className="space-y-6">
              {/* User Info */}
              <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={editUser.avatar_url || undefined} />
                  <AvatarFallback>
                    {getInitials(editUser.full_name, editUser.email)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-medium">{editUser.email}</div>
                  <div className="text-sm text-muted-foreground">
                    Created {new Date(editUser.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* Full Name */}
              <div className="space-y-2">
                <Label htmlFor="edit-name">Full Name</Label>
                <Input
                  id="edit-name"
                  value={editData.full_name}
                  onChange={(e) =>
                    setEditData({ ...editData, full_name: e.target.value })
                  }
                  placeholder="Full name"
                />
              </div>

              {/* Mobile Number */}
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Mobile Number</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  value={editData.phone}
                  onChange={(e) =>
                    setEditData({ ...editData, phone: e.target.value })
                  }
                  placeholder="+966 50 123 4567"
                />
                <p className="text-xs text-muted-foreground">
                  For receiving alarm notifications
                </p>
              </div>

              {/* Role */}
              {/* Lock role when Enterprise Admin is editing themselves */}
              {(() => {
                const isSelfEditingEnterpriseAdmin =
                  currentUser.role === "enterprise_admin" &&
                  editUser?.id === currentUser.id;

                return (
                  <div className="space-y-2">
                    <Label htmlFor="edit-role">Role</Label>
                    {isSelfEditingEnterpriseAdmin ? (
                      // Read-only display for self-editing Enterprise Admin
                      <div className="flex items-center h-10 px-3 border rounded-md bg-muted">
                        <Badge className={roleColors["enterprise_admin"]}>
                          Enterprise Admin
                        </Badge>
                        <span className="ml-2 text-xs text-muted-foreground">
                          (Cannot change your own role)
                        </span>
                      </div>
                    ) : (
                      <Select
                        value={editData.role}
                        onValueChange={(value) =>
                          setEditData({ ...editData, role: value })
                        }
                      >
                        <SelectTrigger id="edit-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableRoles().map((role) => (
                            <SelectItem key={role.value} value={role.value}>
                              {role.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                );
              })()}

              {/* Enterprise (only for super admin) */}
              {canChangeEnterprise && (
                <div className="space-y-2">
                  <Label htmlFor="edit-enterprise">Enterprise</Label>
                  <Select
                    value={editData.enterprise_id || "none"}
                    onValueChange={(value) =>
                      setEditData({ ...editData, enterprise_id: value === "none" ? "" : value })
                    }
                  >
                    <SelectTrigger id="edit-enterprise">
                      <SelectValue placeholder="No enterprise" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Enterprise</SelectItem>
                      {enterprises.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Active Status */}
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="edit-active"
                  checked={editData.is_active}
                  onCheckedChange={(checked) =>
                    setEditData({ ...editData, is_active: checked as boolean })
                  }
                />
                <Label htmlFor="edit-active">Active account</Label>
              </div>

              {/* Project Assignments */}
              {(() => {
                // Check if Enterprise Admin is editing themselves
                const isSelfEditingEnterpriseAdmin =
                  currentUser.role === "enterprise_admin" &&
                  editUser?.id === currentUser.id;

                return (
                  <div className="space-y-3">
                    <Label>Project Assignments</Label>

                    {/* Info message for Enterprise Admin self-edit */}
                    {isSelfEditingEnterpriseAdmin && (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                        As an Enterprise Admin, you have full access to all projects in your enterprise.
                        You can customize alarm notification settings for each project below.
                      </div>
                    )}

                    {projectsLoading ? (
                      <div className="text-sm text-muted-foreground">
                        Loading projects...
                      </div>
                    ) : userProjects.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        No projects available
                      </div>
                    ) : (
                      <div className="border rounded-lg divide-y max-h-[350px] overflow-y-auto">
                        {userProjects.map((assignment) => {
                          const project = projects.find(
                            (p) => p.id === assignment.project_id
                          );
                          const isExpanded = expandedProjects.has(assignment.project_id);
                          const notificationSettings =
                            projectNotificationSettings[assignment.project_id];

                          return (
                            <div key={assignment.project_id} className="p-3">
                              {/* Project header row */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 flex-1">
                                  {/* Expand/collapse button for notification settings */}
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0"
                                    onClick={() =>
                                      toggleProjectExpansion(assignment.project_id)
                                    }
                                  >
                                    {isExpanded ? (
                                      <ChevronUp className="h-4 w-4" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4" />
                                    )}
                                  </Button>
                                  <div className="font-medium text-sm">
                                    {assignment.project_name || project?.name || "Unknown Project"}
                                  </div>
                                </div>

                                {/* Show read-only badges for Enterprise Admin self-edit, or checkboxes for others */}
                                {isSelfEditingEnterpriseAdmin ? (
                                  <div className="flex items-center gap-2">
                                    <Badge variant="secondary" className="text-xs">
                                      Full Access
                                    </Badge>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2">
                                      <Checkbox
                                        id={`edit-${assignment.project_id}`}
                                        checked={assignment.can_edit || false}
                                        onCheckedChange={(checked) =>
                                          handleProjectToggle(
                                            assignment.project_id,
                                            "can_edit",
                                            checked as boolean
                                          )
                                        }
                                      />
                                      <Label
                                        htmlFor={`edit-${assignment.project_id}`}
                                        className="text-xs"
                                      >
                                        Edit
                                      </Label>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Checkbox
                                        id={`control-${assignment.project_id}`}
                                        checked={assignment.can_control || false}
                                        onCheckedChange={(checked) =>
                                          handleProjectToggle(
                                            assignment.project_id,
                                            "can_control",
                                            checked as boolean
                                          )
                                        }
                                      />
                                      <Label
                                        htmlFor={`control-${assignment.project_id}`}
                                        className="text-xs"
                                      >
                                        Control
                                      </Label>
                                    </div>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        handleRemoveFromProject(assignment.project_id)
                                      }
                                    >
                                      <Trash2 className="h-3 w-3 text-destructive" />
                                    </Button>
                                  </div>
                                )}
                              </div>

                            {/* Notification settings - collapsible */}
                            {isExpanded && (
                              <div className="mt-3 ml-8">
                                {notificationSettings ? (
                                  <ProjectNotificationSettings
                                    settings={notificationSettings}
                                    onChange={(newSettings) =>
                                      updateNotificationSettings(
                                        assignment.project_id,
                                        newSettings
                                      )
                                    }
                                  />
                                ) : (
                                  <div className="text-sm text-muted-foreground py-2">
                                    Loading notification settings...
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
              })()}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={editLoading}>
                  {editLoading ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete User Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The user will be permanently removed
              from the system.
            </DialogDescription>
          </DialogHeader>

          {deleteUser && (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <div className="font-medium">
                  {deleteUser.full_name || deleteUser.email}
                </div>
                <div className="text-sm text-muted-foreground">
                  {deleteUser.email}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="delete-password">
                  Enter your password to confirm
                </Label>
                <Input
                  id="delete-password"
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Your password"
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDeleteOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deleteLoading || !deletePassword}
                  onClick={handleDelete}
                >
                  {deleteLoading ? "Deleting..." : "Delete User"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
