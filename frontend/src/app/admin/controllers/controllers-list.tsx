"use client";

/**
 * Controllers List Component
 *
 * Client component for displaying and managing controllers.
 * Includes create dialog, status management, and passcode display.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { ControllerRebootAction, REBOOTABLE_STATUSES } from "@/components/controllers/controller-reboot-action";

interface Controller {
  id: string;
  serial_number: string;
  status: string;
  firmware_version: string | null;
  notes: string | null;
  passcode: string | null;
  enterprise_id: string | null;
  created_at: string;
  approved_hardware: {
    name: string;
    hardware_type: string;
  } | null;
  enterprises: {
    name: string;
  } | null;
  last_heartbeat: string | null;
  pending_restart: boolean | null;
  ssh_port: number | null;
  wizard_step: number | null;
}

// Standard SSH credentials (same for all controllers)
const SSH_USERNAME = "voltadmin";
const SSH_PASSWORD = "Solar@1996";
const SSH_CENTRAL_SERVER = "159.223.224.203";

// Helper to determine if controller is online (heartbeat within last 90 seconds)
// Note: Controllers send heartbeats every 30 seconds
// Using 90 seconds (instead of 60) provides buffer for network latency and clock skew
// This means a controller must miss 2+ heartbeats before showing offline
const isControllerOnline = (lastHeartbeat: string | null): boolean => {
  if (!lastHeartbeat) return false;
  const thresholdMs = 90 * 1000; // 90 seconds
  return Date.now() - new Date(lastHeartbeat).getTime() < thresholdMs;
};

// Helper to format time since last heartbeat
const formatTimeSince = (timestamp: string | null): string => {
  if (!timestamp) return "Never";
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
};

interface HardwareType {
  id: string;
  name: string;
  hardware_type: string;
}

interface ControllersListProps {
  controllers: Controller[];
  hardwareTypes: HardwareType[];
  initialHeartbeats?: Record<string, string>;
}

// Status badge colors
// draft = gray, ready = yellow (can be claimed), claimed = blue (owned but no site)
// deployed = green (on a site), deactivated = amber (disabled), eol = red (decommissioned)
const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  ready: "bg-yellow-100 text-yellow-800",
  claimed: "bg-blue-100 text-blue-800",
  deployed: "bg-green-100 text-green-800",
  deactivated: "bg-amber-100 text-amber-800",
  eol: "bg-red-100 text-red-800",
};

export function ControllersList({ controllers: initialControllers, hardwareTypes, initialHeartbeats = {} }: ControllersListProps) {
  const router = useRouter();
  const supabase = createClient();

  const [controllers, setControllers] = useState(initialControllers);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editController, setEditController] = useState<Controller | null>(null);
  const [editFormData, setEditFormData] = useState({
    firmware_version: "",
    notes: "",
    status: "",
  });

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteController, setDeleteController] = useState<Controller | null>(null);
  const [deletePassword, setDeletePassword] = useState("");

  // Deactivate dialog state
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivateController, setDeactivateController] = useState<Controller | null>(null);
  const [deactivatePassword, setDeactivatePassword] = useState("");
  const [deactivateUsage, setDeactivateUsage] = useState<{ project_name: string; site_name: string }[]>([]);
  const [loadingUsage, setLoadingUsage] = useState(false);

  // Restart dialog state
  const [restartOpen, setRestartOpen] = useState(false);
  const [restartController, setRestartController] = useState<Controller | null>(null);
  const [restartLoading, setRestartLoading] = useState(false);

  // SSH password reveal state
  const [sshPasswordOpen, setSshPasswordOpen] = useState(false);
  const [sshPasswordController, setSshPasswordController] = useState<Controller | null>(null);
  const [sshVerifyPassword, setSshVerifyPassword] = useState("");
  const [sshPasswordRevealed, setSshPasswordRevealed] = useState(false);
  const [sshPasswordLoading, setSshPasswordLoading] = useState(false);

  // Create form state
  const [formData, setFormData] = useState({
    serial_number: "",
    hardware_type_id: "",
    firmware_version: "",
    notes: "",
  });

  // Heartbeat polling state - for auto-updating connection status
  // Initialize with server-side data so we have correct status on first render
  const [heartbeats, setHeartbeats] = useState<Record<string, string>>(initialHeartbeats);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch heartbeats from API with retry logic for transient failures
  const fetchHeartbeats = useCallback(async () => {
    setIsRefreshing(true);
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch("/api/controllers/heartbeats");
        if (res.ok) {
          const data = await res.json();
          // Only update if we got valid data (not an error object)
          if (!data.error && typeof data === "object") {
            // Merge new heartbeats with existing ones to prevent false offline flickers
            // Only update a timestamp if it's newer than what we have
            setHeartbeats((prev) => {
              const merged = { ...prev };
              for (const [controllerId, timestamp] of Object.entries(data)) {
                const newTime = new Date(timestamp as string).getTime();
                const existingTime = prev[controllerId] ? new Date(prev[controllerId]).getTime() : 0;
                // Only update if new timestamp is more recent (or we didn't have one)
                if (newTime >= existingTime) {
                  merged[controllerId] = timestamp as string;
                }
              }
              return merged;
            });
            setLastUpdated(new Date());
          }
          setIsRefreshing(false);
          return; // Success, exit
        }
        // Non-OK response, will retry
        lastError = new Error(`HTTP ${res.status}`);
      } catch (error) {
        lastError = error as Error;
      }

      // Wait 1 second before retry (except on last attempt)
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // All retries failed - keep existing heartbeat data (don't clear it)
    console.error("Failed to fetch heartbeats after retries:", lastError);
    setIsRefreshing(false);
  }, []);

  // Smart polling effect - polls every 30s when tab is visible
  useEffect(() => {
    // Initial fetch
    fetchHeartbeats();
    setIsPolling(true);

    // Set up polling interval
    let intervalId: NodeJS.Timeout;

    const startPolling = () => {
      intervalId = setInterval(fetchHeartbeats, 30000); // 30 seconds
    };

    // Handle tab visibility changes
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab is hidden - stop polling
        clearInterval(intervalId);
        setIsPolling(false);
      } else {
        // Tab is visible - fetch immediately and resume polling
        fetchHeartbeats();
        startPolling();
        setIsPolling(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    startPolling();

    // Cleanup
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchHeartbeats]);

  // Helper to get heartbeat for a controller (polled data or initial prop)
  const getControllerHeartbeat = (controllerId: string, initialHeartbeat: string | null): string | null => {
    return heartbeats[controllerId] || initialHeartbeat;
  };

  // Filter controllers - search by serial number, hardware name, or enterprise name
  const filteredControllers = controllers.filter((c) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      searchQuery === "" ||
      c.serial_number.toLowerCase().includes(query) ||
      c.approved_hardware?.name.toLowerCase().includes(query) ||
      c.enterprises?.name.toLowerCase().includes(query);

    const matchesStatus = statusFilter === "all" || c.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Handle create controller
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!formData.serial_number.trim()) {
        toast.error("Serial number is required");
        setLoading(false);
        return;
      }

      if (!formData.hardware_type_id) {
        toast.error("Hardware type is required");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("controllers")
        .insert({
          serial_number: formData.serial_number.trim(),
          hardware_type_id: formData.hardware_type_id,
          firmware_version: formData.firmware_version.trim() || null,
          notes: formData.notes.trim() || null,
          status: "draft",
        })
        .select(`
          id,
          serial_number,
          status,
          firmware_version,
          passcode,
          enterprise_id,
          created_at,
          approved_hardware:hardware_type_id (
            name,
            hardware_type
          )
        `)
        .single();

      if (error) {
        console.error("Error creating controller:", error);
        if (error.code === "23505") {
          toast.error("Serial number already exists");
        } else {
          toast.error(error.message || "Failed to create controller");
        }
        setLoading(false);
        return;
      }

      toast.success("Controller registered successfully");
      // Add enterprises: null since new controllers aren't assigned to an enterprise yet
      // Supabase returns relations as arrays, extract first element
      const hwData = Array.isArray(data.approved_hardware)
        ? data.approved_hardware[0]
        : data.approved_hardware;
      const newController: Controller = {
        id: data.id,
        serial_number: data.serial_number,
        status: data.status,
        firmware_version: data.firmware_version,
        notes: null,
        passcode: data.passcode,
        enterprise_id: data.enterprise_id,
        created_at: data.created_at,
        approved_hardware: hwData || null,
        enterprises: null,
        last_heartbeat: null, // New controllers haven't sent heartbeats yet
        pending_restart: null, // New controllers don't have pending restart
        ssh_port: null, // SSH port assigned by setup script
        wizard_step: null, // New controllers created here haven't gone through wizard
      };
      setControllers([newController, ...controllers]);
      setCreateOpen(false);
      setFormData({
        serial_number: "",
        hardware_type_id: "",
        firmware_version: "",
        notes: "",
      });
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Handle status change
  const handleStatusChange = async (controllerId: string, newStatus: string) => {
    const { data, error } = await supabase
      .from("controllers")
      .update({ status: newStatus })
      .eq("id", controllerId)
      .select("passcode")
      .single();

    if (error) {
      toast.error("Failed to update status");
      return;
    }

    // Update local state
    setControllers(
      controllers.map((c) =>
        c.id === controllerId
          ? { ...c, status: newStatus, passcode: data.passcode }
          : c
      )
    );

    toast.success(`Controller status updated to ${newStatus}`);
    router.refresh();
  };

  // Copy passcode to clipboard
  const copyPasscode = (passcode: string) => {
    navigator.clipboard.writeText(passcode);
    toast.success("Passcode copied to clipboard");
  };

  // Open edit dialog
  const openEditDialog = (controller: Controller) => {
    setEditController(controller);
    setEditFormData({
      firmware_version: controller.firmware_version || "",
      notes: controller.notes || "",
      status: controller.status,
    });
    setEditOpen(true);
  };

  // Handle edit form changes
  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setEditFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Handle edit submit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editController) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("controllers")
        .update({
          firmware_version: editFormData.firmware_version.trim() || null,
          notes: editFormData.notes.trim() || null,
          status: editFormData.status,
        })
        .eq("id", editController.id)
        .select("passcode")
        .single();

      if (error) {
        console.error("Error updating controller:", error);
        toast.error(error.message || "Failed to update controller");
        return;
      }

      // Update local state
      setControllers(
        controllers.map((c) =>
          c.id === editController.id
            ? {
                ...c,
                firmware_version: editFormData.firmware_version.trim() || null,
                notes: editFormData.notes.trim() || null,
                status: editFormData.status,
                passcode: data.passcode,
              }
            : c
        )
      );

      toast.success("Controller updated successfully");
      setEditOpen(false);
      setEditController(null);
      router.refresh();
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Open delete dialog
  const openDeleteDialog = (controller: Controller) => {
    setDeleteController(controller);
    setDeletePassword("");
    setDeleteOpen(true);
  };

  // Handle delete submit
  const handleDeleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteController) return;

    if (!deletePassword) {
      toast.error("Password is required to delete a controller");
      return;
    }

    setLoading(true);
    try {
      // Verify password by attempting to re-authenticate
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        toast.error("Could not verify user");
        return;
      }

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: deletePassword,
      });

      if (authError) {
        toast.error("Incorrect password");
        return;
      }

      // First, delete related site_master_devices entries
      const { error: masterDevicesError } = await supabase
        .from("site_master_devices")
        .delete()
        .eq("controller_id", deleteController.id);

      if (masterDevicesError) {
        console.error("Error removing site assignments:", masterDevicesError);
        // Continue anyway - the controller might not have site assignments
      }

      // Then, delete controller heartbeats
      const { error: heartbeatsError } = await supabase
        .from("controller_heartbeats")
        .delete()
        .eq("controller_id", deleteController.id);

      if (heartbeatsError) {
        console.error("Error removing heartbeats:", heartbeatsError);
        // Continue anyway - the controller might not have heartbeats
      }

      // Finally, HARD DELETE the controller record
      const { error } = await supabase
        .from("controllers")
        .delete()
        .eq("id", deleteController.id);

      if (error) {
        console.error("Error deleting controller:", error);
        toast.error(error.message || "Failed to delete controller");
        return;
      }

      // Remove from local state
      setControllers(controllers.filter((c) => c.id !== deleteController.id));

      toast.success("Controller permanently deleted");
      setDeleteOpen(false);
      setDeleteController(null);
      setDeletePassword("");
      router.refresh();
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Open deactivate dialog - also fetches usage info
  const openDeactivateDialog = async (controller: Controller) => {
    setDeactivateController(controller);
    setDeactivatePassword("");
    setDeactivateUsage([]);
    setDeactivateOpen(true);

    // Fetch usage info - where is this controller used?
    setLoadingUsage(true);
    try {
      // Check site_master_devices for where this controller is assigned
      const { data, error } = await supabase
        .from("site_master_devices")
        .select(`
          sites (
            name,
            projects (
              name
            )
          )
        `)
        .eq("controller_id", controller.id);

      if (!error && data) {
        const usage = data
          .filter((d) => d.sites)
          .map((d) => {
            // Supabase returns relations as arrays or objects depending on the query
            const site = Array.isArray(d.sites) ? d.sites[0] : d.sites;
            const project = site?.projects;
            const projectData = Array.isArray(project) ? project[0] : project;
            return {
              project_name: projectData?.name || "Unknown Project",
              site_name: site?.name || "Unknown Site",
            };
          });
        setDeactivateUsage(usage);
      }
    } catch (err) {
      console.error("Error fetching usage:", err);
    } finally {
      setLoadingUsage(false);
    }
  };

  // Handle deactivate submit
  const handleDeactivateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deactivateController) return;

    if (!deactivatePassword) {
      toast.error("Password is required to deactivate a controller");
      return;
    }

    setLoading(true);
    try {
      // Verify password by attempting to re-authenticate
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        toast.error("Could not verify user");
        return;
      }

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: deactivatePassword,
      });

      if (authError) {
        toast.error("Incorrect password");
        return;
      }

      // Set status to deactivated
      const { error } = await supabase
        .from("controllers")
        .update({ status: "deactivated" })
        .eq("id", deactivateController.id);

      if (error) {
        console.error("Error deactivating controller:", error);
        toast.error(error.message || "Failed to deactivate controller");
        return;
      }

      // Update local state
      setControllers(
        controllers.map((c) =>
          c.id === deactivateController.id
            ? { ...c, status: "deactivated" }
            : c
        )
      );

      toast.success("Controller deactivated successfully");
      setDeactivateOpen(false);
      setDeactivateController(null);
      setDeactivatePassword("");
      setDeactivateUsage([]);
      router.refresh();
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Open restart dialog
  const openRestartDialog = (controller: Controller) => {
    setRestartController(controller);
    setRestartOpen(true);
  };

  // Handle restart submit
  const handleRestartSubmit = async () => {
    if (!restartController) return;

    setRestartLoading(true);
    try {
      const { error } = await supabase
        .from("controllers")
        .update({
          pending_restart: true,
          restart_requested_at: new Date().toISOString(),
        })
        .eq("id", restartController.id);

      if (error) {
        console.error("Error sending restart command:", error);
        toast.error("Failed to send restart command");
        return;
      }

      // Update local state
      setControllers(
        controllers.map((c) =>
          c.id === restartController.id
            ? { ...c, pending_restart: true }
            : c
        )
      );

      toast.success("Restart command sent to controller");
      setRestartOpen(false);
      setRestartController(null);
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setRestartLoading(false);
    }
  };

  // Open SSH password reveal dialog
  const openSshPasswordDialog = (controller: Controller) => {
    setSshPasswordController(controller);
    setSshVerifyPassword("");
    setSshPasswordRevealed(false);
    setSshPasswordOpen(true);
  };

  // Handle SSH password verification
  const handleSshPasswordVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sshPasswordController) return;

    if (!sshVerifyPassword) {
      toast.error("Please enter your password");
      return;
    }

    setSshPasswordLoading(true);
    try {
      // Verify password by attempting to re-authenticate
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        toast.error("Could not verify user");
        return;
      }

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: sshVerifyPassword,
      });

      if (authError) {
        toast.error("Incorrect password");
        return;
      }

      // Password verified - reveal SSH password
      setSshPasswordRevealed(true);
      toast.success("SSH password revealed");
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setSshPasswordLoading(false);
    }
  };

  return (
    <>
      {/* Search and Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <Input
            placeholder="Search by serial, hardware, or enterprise..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 min-h-[44px]"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="min-h-[44px] px-3 rounded-md border border-input bg-background"
        >
          <option value="all">All Status</option>
          <option value="draft">Draft</option>
          <option value="ready">Ready</option>
          <option value="claimed">Claimed</option>
          <option value="deployed">Deployed</option>
          <option value="deactivated">Deactivated</option>
          <option value="eol">End of Life</option>
        </select>

        <Button asChild className="min-h-[44px]">
          <Link href="/admin/controllers/wizard">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4 mr-2"
            >
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            Register Controller
          </Link>
        </Button>

        {/* Auto-refresh status indicator */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {isPolling && (
            <span className="flex items-center gap-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="hidden sm:inline">Live</span>
            </span>
          )}
          {lastUpdated && (
            <span className="hidden sm:inline">
              Updated {formatTimeSince(lastUpdated.toISOString())}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchHeartbeats}
            disabled={isRefreshing}
            className="h-8 w-8 p-0"
            title="Refresh connection status"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
          </Button>
        </div>
      </div>

      {/* Controllers Table */}
      {filteredControllers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6 text-muted-foreground"
              >
                <rect width="20" height="14" x="2" y="3" rx="2" />
                <line x1="8" x2="16" y1="21" y2="21" />
                <line x1="12" x2="12" y1="17" y2="21" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">No controllers found</h3>
            <p className="text-muted-foreground text-center max-w-sm">
              {searchQuery || statusFilter !== "all"
                ? "Try adjusting your filters."
                : "Register your first controller to get started."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* MOBILE-FRIENDLY: Card view for mobile */}
          <div className="sm:hidden space-y-3">
            {filteredControllers.map((controller) => (
              <Card key={controller.id} className="p-4">
                <div className="space-y-3">
                  {/* Header: Serial & Status */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono font-medium">{controller.serial_number}</p>
                      <p className="text-sm text-muted-foreground">
                        {controller.approved_hardware?.name || "Unknown"}
                      </p>
                    </div>
                    <Badge className={statusColors[controller.status]}>
                      {controller.status}
                    </Badge>
                  </div>

                  {/* Info Grid */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-muted-foreground">Connection</p>
                      {(() => {
                        const heartbeat = getControllerHeartbeat(controller.id, controller.last_heartbeat);
                        if (isControllerOnline(heartbeat)) {
                          return (
                            <div className="flex items-center gap-1.5">
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                              </span>
                              <span className="text-green-600 font-medium">Online</span>
                            </div>
                          );
                        } else if (heartbeat) {
                          return <span className="text-muted-foreground">{formatTimeSince(heartbeat)}</span>;
                        } else {
                          return <span className="text-muted-foreground">—</span>;
                        }
                      })()}
                    </div>
                    <div>
                      <p className="text-muted-foreground">Enterprise</p>
                      <p>{controller.enterprises?.name || "Not claimed"}</p>
                    </div>
                    {controller.ssh_port && (
                      <div className="col-span-2">
                        <p className="text-muted-foreground">SSH Access</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="bg-muted px-2 py-1 rounded text-xs">
                            ssh {SSH_USERNAME}@{SSH_CENTRAL_SERVER} -p {controller.ssh_port}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const cmd = `ssh ${SSH_USERNAME}@${SSH_CENTRAL_SERVER} -p ${controller.ssh_port}`;
                              navigator.clipboard.writeText(cmd);
                              toast.success("SSH command copied");
                            }}
                            className="h-8 w-8 p-0"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                            </svg>
                          </Button>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">Pass:</span>
                          <code className="bg-muted px-1 rounded text-xs">••••••••</code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openSshPasswordDialog(controller)}
                            className="h-6 px-2 text-xs"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 mr-1">
                              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                            View
                          </Button>
                        </div>
                      </div>
                    )}
                    {controller.passcode && (
                      <div className="col-span-2">
                        <p className="text-muted-foreground">Passcode</p>
                        <div className="flex items-center gap-2">
                          <code className="bg-muted px-2 py-1 rounded text-sm">
                            {controller.passcode}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyPasscode(controller.passcode!)}
                            className="h-8 w-8 p-0"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                            </svg>
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-2 border-t">
                    {controller.status === "draft" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStatusChange(controller.id, "ready")}
                        className="min-h-[44px] flex-1"
                      >
                        Mark Ready
                      </Button>
                    )}
                    {controller.status === "ready" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStatusChange(controller.id, "draft")}
                        className="min-h-[44px] flex-1"
                      >
                        Back to Draft
                      </Button>
                    )}
                    {/* Edit/Resume Wizard button - mobile */}
                    {controller.wizard_step != null ? (
                      <Link href={`/admin/controllers/wizard?id=${controller.id}`}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-[44px] text-blue-600 border-blue-600 hover:bg-blue-50"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-1">
                            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                            <polyline points="14 2 14 8 20 8" />
                            <path d="m9 15 2 2 4-4" />
                          </svg>
                          Resume
                        </Button>
                      </Link>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(controller)}
                        disabled={controller.status === "deployed"}
                        className="min-h-[44px] min-w-[44px]"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                          <path d="m15 5 4 4" />
                        </svg>
                      </Button>
                    )}
                    {/* Reboot button - mobile (for ready, claimed, deployed) */}
                    {REBOOTABLE_STATUSES.includes(controller.status) && (
                      <ControllerRebootAction
                        controllerId={controller.id}
                        controllerName={controller.serial_number}
                        controllerStatus={controller.status}
                        lastHeartbeat={getControllerHeartbeat(controller.id, controller.last_heartbeat)}
                        variant="icon"
                        size="sm"
                      />
                    )}
                    {!["deployed", "deactivated", "eol"].includes(controller.status) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openDeactivateDialog(controller)}
                        className="min-h-[44px] min-w-[44px] text-amber-600 hover:text-amber-700"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <circle cx="12" cy="12" r="10" />
                          <rect x="9" y="9" width="6" height="6" rx="1" />
                        </svg>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openDeleteDialog(controller)}
                      disabled={controller.status === "deployed"}
                      className="min-h-[44px] min-w-[44px] text-destructive hover:text-destructive"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <path d="M3 6h18" />
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      </svg>
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Desktop: Table view */}
          <Card className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Connection</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Hardware</TableHead>
                  <TableHead>Serial Number</TableHead>
                  <TableHead>SSH Access</TableHead>
                  <TableHead>Passcode</TableHead>
                  <TableHead>Enterprise</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredControllers.map((controller) => (
                  <TableRow key={controller.id}>
                    <TableCell>
                      {/* Connection status with pulse animation for online */}
                      {(() => {
                        const heartbeat = getControllerHeartbeat(controller.id, controller.last_heartbeat);
                        if (isControllerOnline(heartbeat)) {
                          return (
                            <div className="flex items-center gap-2">
                              <span className="relative flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                              </span>
                              <span className="text-sm text-green-600 font-medium">Online</span>
                            </div>
                          );
                        } else if (heartbeat) {
                          return (
                            <div className="flex items-center gap-2">
                              <span className="relative flex h-3 w-3">
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-400"></span>
                              </span>
                              <span className="text-sm text-muted-foreground">
                                {formatTimeSince(heartbeat)}
                              </span>
                            </div>
                          );
                        } else {
                          return <span className="text-sm text-muted-foreground">—</span>;
                        }
                      })()}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColors[controller.status]}>
                        {controller.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {controller.approved_hardware?.name || "Unknown"}
                    </TableCell>
                    <TableCell className="font-mono font-medium">
                      {controller.serial_number}
                    </TableCell>
                    <TableCell>
                      {/* SSH Access - only show if controller has ssh_port assigned */}
                      {controller.ssh_port ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <code className="bg-muted px-2 py-1 rounded text-xs">
                              ssh {SSH_USERNAME}@{SSH_CENTRAL_SERVER} -p {controller.ssh_port}
                            </code>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                const cmd = `ssh ${SSH_USERNAME}@${SSH_CENTRAL_SERVER} -p ${controller.ssh_port}`;
                                navigator.clipboard.writeText(cmd);
                                toast.success("SSH command copied");
                              }}
                              className="h-6 w-6 p-0"
                              title="Copy SSH command"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-3 w-3"
                              >
                                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                              </svg>
                            </Button>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <span>Pass:</span>
                            <code className="bg-muted px-1 rounded">••••••••</code>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openSshPasswordDialog(controller)}
                              className="h-5 px-1.5 text-xs"
                              title="View SSH password (requires verification)"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-3 w-3 mr-1"
                              >
                                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                              View
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not configured</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {controller.passcode ? (
                        <div className="flex items-center gap-2">
                          <code className="bg-muted px-2 py-1 rounded text-sm">
                            {controller.passcode}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyPasscode(controller.passcode!)}
                            className="h-8 w-8 p-0"
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
                              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                            </svg>
                          </Button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {controller.enterprises?.name || (
                        <span className="text-muted-foreground">Not claimed</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {/* Status change buttons */}
                        {controller.status === "draft" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleStatusChange(controller.id, "ready")}
                          >
                            Mark Ready
                          </Button>
                        )}
                        {controller.status === "ready" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleStatusChange(controller.id, "draft")}
                          >
                            Back to Draft
                          </Button>
                        )}

                        {/* Edit/Resume Wizard button - desktop */}
                        {controller.wizard_step != null ? (
                          <Link href={`/admin/controllers/wizard?id=${controller.id}`}>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-blue-600 border-blue-600 hover:bg-blue-50"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-4 w-4 mr-1"
                              >
                                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                                <polyline points="14 2 14 8 20 8" />
                                <path d="m9 15 2 2 4-4" />
                              </svg>
                              Resume Wizard
                            </Button>
                          </Link>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(controller)}
                            disabled={controller.status === "deployed"}
                            title={controller.status === "deployed" ? "Cannot edit deployed controller" : "Edit controller"}
                            className="h-8 w-8 p-0"
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
                              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                              <path d="m15 5 4 4" />
                            </svg>
                          </Button>
                        )}

                        {/* Reboot button - for ready, claimed, deployed controllers */}
                        {REBOOTABLE_STATUSES.includes(controller.status) && (
                          <ControllerRebootAction
                            controllerId={controller.id}
                            controllerName={controller.serial_number}
                            controllerStatus={controller.status}
                            lastHeartbeat={getControllerHeartbeat(controller.id, controller.last_heartbeat)}
                            variant="icon"
                            size="sm"
                          />
                        )}

                        {/* Deactivate button - only for non-deployed, non-deactivated, non-eol */}
                        {!["deployed", "deactivated", "eol"].includes(controller.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDeactivateDialog(controller)}
                            title="Deactivate controller"
                            className="h-8 w-8 p-0 text-amber-600 hover:text-amber-700"
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
                              <circle cx="12" cy="12" r="10" />
                              <rect x="9" y="9" width="6" height="6" rx="1" />
                            </svg>
                          </Button>
                        )}

                        {/* Delete button - disabled when deployed */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openDeleteDialog(controller)}
                          disabled={controller.status === "deployed"}
                          title={controller.status === "deployed" ? "Cannot delete deployed controller" : "Delete controller"}
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
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
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {/* Create Controller Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Register Controller</DialogTitle>
            <DialogDescription>
              Add a new controller hardware unit to the system.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="serial_number">
                Serial Number <span className="text-red-500">*</span>
              </Label>
              <Input
                id="serial_number"
                name="serial_number"
                placeholder="e.g., RPI5-2024-001"
                value={formData.serial_number}
                onChange={handleChange}
                className="min-h-[44px] font-mono"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hardware_type_id">
                Hardware Type <span className="text-red-500">*</span>
              </Label>
              <select
                id="hardware_type_id"
                name="hardware_type_id"
                value={formData.hardware_type_id}
                onChange={handleChange}
                className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
                required
              >
                <option value="">Select hardware type...</option>
                {hardwareTypes.map((hw) => (
                  <option key={hw.id} value={hw.id}>
                    {hw.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="firmware_version">Firmware Version</Label>
              <Input
                id="firmware_version"
                name="firmware_version"
                placeholder="e.g., 1.0.0"
                value={formData.firmware_version}
                onChange={handleChange}
                className="min-h-[44px]"
              />
            </div>

            <DialogFooter className="flex-col gap-2 sm:flex-row pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                className="min-h-[44px] w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading} className="min-h-[44px] w-full sm:w-auto">
                {loading ? "Registering..." : "Register Controller"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Controller Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Controller</DialogTitle>
            <DialogDescription>
              Update controller details. Serial number and hardware type cannot be changed.
            </DialogDescription>
          </DialogHeader>

          {editController && (
            <form onSubmit={handleEditSubmit} className="space-y-4 py-4">
              {/* Read-only info */}
              <div className="space-y-2">
                <Label>Serial Number</Label>
                <div className="px-3 py-2 bg-muted rounded-md font-mono text-sm">
                  {editController.serial_number}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Hardware Type</Label>
                <div className="px-3 py-2 bg-muted rounded-md text-sm">
                  {editController.approved_hardware?.name || "Unknown"}
                </div>
              </div>

              {/* Editable fields */}
              <div className="space-y-2">
                <Label htmlFor="edit_firmware_version">Firmware Version</Label>
                <Input
                  id="edit_firmware_version"
                  name="firmware_version"
                  placeholder="e.g., 1.0.0"
                  value={editFormData.firmware_version}
                  onChange={handleEditChange}
                  className="min-h-[44px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit_notes">Notes</Label>
                <textarea
                  id="edit_notes"
                  name="notes"
                  placeholder="Any additional notes about this controller..."
                  value={editFormData.notes}
                  onChange={handleEditChange}
                  rows={3}
                  className="w-full min-h-[80px] px-3 py-2 rounded-md border border-input bg-background resize-none"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit_status">Status</Label>
                <select
                  id="edit_status"
                  name="status"
                  value={editFormData.status}
                  onChange={handleEditChange}
                  className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background"
                >
                  <option value="draft">Draft</option>
                  <option value="ready">Ready</option>
                  <option value="claimed">Claimed</option>
                  <option value="deactivated">Deactivated</option>
                  <option value="eol">End of Life</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  Note: &quot;Deployed&quot; status can only be set when assigning to a site.
                </p>
              </div>

              <DialogFooter className="flex-col gap-2 sm:flex-row pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditOpen(false)}
                  className="min-h-[44px] w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={loading} className="min-h-[44px] w-full sm:w-auto">
                  {loading ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Controller Dialog - PERMANENT/HARD DELETE */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
              DELETE Controller - PERMANENT
            </DialogTitle>
            <DialogDescription>
              This action is IRREVERSIBLE and cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteController && (
            <form onSubmit={handleDeleteSubmit} className="space-y-4 py-4">
              <div className="p-4 bg-destructive/10 border-2 border-destructive/30 rounded-lg">
                <p className="text-sm font-semibold text-destructive mb-2">
                  WARNING: This will PERMANENTLY delete all data!
                </p>
                <p className="text-sm">
                  Deleting controller{" "}
                  <span className="font-mono font-semibold">{deleteController.serial_number}</span>{" "}
                  will permanently remove:
                </p>
                <ul className="text-sm mt-2 ml-4 list-disc space-y-1">
                  <li>Controller registration</li>
                  <li>All associated heartbeat data</li>
                  <li>Site assignments</li>
                </ul>
                <p className="text-sm font-semibold text-destructive mt-3">
                  This data CANNOT be recovered.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="delete_password">
                  Enter your password to confirm <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="delete_password"
                  type="password"
                  placeholder="Your password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  className="min-h-[44px]"
                  required
                />
              </div>

              <DialogFooter className="flex-col gap-2 sm:flex-row pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDeleteOpen(false)}
                  className="min-h-[44px] w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={loading || !deletePassword}
                  className="min-h-[44px] w-full sm:w-auto"
                >
                  {loading ? "Deleting..." : "DELETE PERMANENTLY"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Deactivate Controller Dialog */}
      <Dialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5 text-amber-600"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              Deactivate Controller
            </DialogTitle>
            <DialogDescription>
              This will prevent the controller from operating or being deployed.
            </DialogDescription>
          </DialogHeader>

          {deactivateController && (
            <form onSubmit={handleDeactivateSubmit} className="space-y-4 py-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-800">
                  Are you sure you want to deactivate controller{" "}
                  <span className="font-mono font-semibold">{deactivateController.serial_number}</span>?
                </p>
                <p className="text-sm text-amber-700 mt-2">
                  This controller will no longer be able to be deployed or operate.
                </p>
              </div>

              {/* Show usage warning if controller is used in projects */}
              {loadingUsage ? (
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">Checking usage...</p>
                </div>
              ) : deactivateUsage.length > 0 && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm font-semibold text-red-800 mb-2">
                    Warning: This controller is currently used in the following projects:
                  </p>
                  <ul className="text-sm text-red-700 space-y-1 ml-4 list-disc">
                    {deactivateUsage.map((usage, idx) => (
                      <li key={idx}>
                        {usage.project_name} (Site: {usage.site_name})
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm text-red-700 mt-2">
                    Deactivating will stop all control operations for these sites.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="deactivate_password">
                  Enter your password to confirm <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="deactivate_password"
                  type="password"
                  placeholder="Your password"
                  value={deactivatePassword}
                  onChange={(e) => setDeactivatePassword(e.target.value)}
                  className="min-h-[44px]"
                  required
                />
              </div>

              <DialogFooter className="flex-col gap-2 sm:flex-row pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDeactivateOpen(false)}
                  className="min-h-[44px] w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading || !deactivatePassword}
                  className="min-h-[44px] w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {loading ? "Deactivating..." : "Deactivate Controller"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Restart Controller Dialog */}
      <Dialog open={restartOpen} onOpenChange={setRestartOpen}>
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5 text-blue-600"
              >
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
              Restart Controller
            </DialogTitle>
            <DialogDescription>
              Send a restart command to this controller.
            </DialogDescription>
          </DialogHeader>

          {restartController && (
            <div className="space-y-4 py-4">
              {/* Controller info */}
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm">
                  <span className="text-muted-foreground">Serial Number:</span>{" "}
                  <span className="font-mono font-medium">{restartController.serial_number}</span>
                </p>
                <p className="text-sm mt-1">
                  <span className="text-muted-foreground">Hardware:</span>{" "}
                  {restartController.approved_hardware?.name || "Unknown"}
                </p>
              </div>

              {/* Info message */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg dark:bg-blue-950/30 dark:border-blue-900">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  The controller will restart within its next polling cycle (typically within 1-5 minutes).
                  The controller will briefly go offline during the restart.
                </p>
              </div>

              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setRestartOpen(false);
                    setRestartController(null);
                  }}
                  className="min-h-[44px] w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRestartSubmit}
                  disabled={restartLoading}
                  className="min-h-[44px] w-full sm:w-auto bg-blue-600 hover:bg-blue-700"
                >
                  {restartLoading ? "Sending..." : "Restart Controller"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* SSH Password Reveal Dialog */}
      <Dialog open={sshPasswordOpen} onOpenChange={(open) => {
        setSshPasswordOpen(open);
        if (!open) {
          setSshPasswordController(null);
          setSshVerifyPassword("");
          setSshPasswordRevealed(false);
        }
      }}>
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5 text-purple-600"
              >
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              SSH Credentials
            </DialogTitle>
            <DialogDescription>
              Enter your admin password to reveal SSH credentials.
            </DialogDescription>
          </DialogHeader>

          {sshPasswordController && (
            <div className="space-y-4 py-4">
              {/* Controller info */}
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm">
                  <span className="text-muted-foreground">Controller:</span>{" "}
                  <span className="font-mono font-medium">{sshPasswordController.serial_number}</span>
                </p>
                <p className="text-sm mt-1">
                  <span className="text-muted-foreground">SSH Command:</span>
                </p>
                <code className="block mt-1 bg-zinc-900 text-green-400 px-2 py-1 rounded text-xs font-mono">
                  ssh {SSH_USERNAME}@{SSH_CENTRAL_SERVER} -p {sshPasswordController.ssh_port}
                </code>
              </div>

              {!sshPasswordRevealed ? (
                <form onSubmit={handleSshPasswordVerify} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ssh_verify_password">
                      Your Password <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="ssh_verify_password"
                      type="password"
                      placeholder="Enter your admin password"
                      value={sshVerifyPassword}
                      onChange={(e) => setSshVerifyPassword(e.target.value)}
                      className="min-h-[44px]"
                      autoFocus
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      For security, verify your identity to view SSH password.
                    </p>
                  </div>

                  <DialogFooter className="flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setSshPasswordOpen(false)}
                      className="min-h-[44px] w-full sm:w-auto"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={sshPasswordLoading || !sshVerifyPassword}
                      className="min-h-[44px] w-full sm:w-auto bg-purple-600 hover:bg-purple-700"
                    >
                      {sshPasswordLoading ? "Verifying..." : "Verify & Reveal"}
                    </Button>
                  </DialogFooter>
                </form>
              ) : (
                <div className="space-y-4">
                  {/* Revealed SSH Password */}
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg dark:bg-green-950/30 dark:border-green-900">
                    <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">
                      SSH Password Revealed
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="bg-white dark:bg-zinc-900 px-3 py-2 rounded text-lg font-mono font-bold border">
                        {SSH_PASSWORD}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(SSH_PASSWORD);
                          toast.success("SSH password copied");
                        }}
                        className="h-9"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-4 w-4 mr-1"
                        >
                          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                        </svg>
                        Copy
                      </Button>
                    </div>
                  </div>

                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setSshPasswordOpen(false)}
                      className="min-h-[44px] w-full sm:w-auto"
                    >
                      Close
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
