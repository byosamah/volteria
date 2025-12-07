"use client";

/**
 * Account Settings Form
 *
 * Allows users to update their profile and password.
 * Includes:
 * - First name / Last name fields
 * - Password change with current password verification
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { User } from "@supabase/supabase-js";

interface AccountSettingsFormProps {
  user: User | null;
  fullName: string;
}

export function AccountSettingsForm({ user, fullName }: AccountSettingsFormProps) {
  const router = useRouter();
  const supabase = createClient();

  // Profile state - split full_name into first and last
  const [profileLoading, setProfileLoading] = useState(false);
  const [profile, setProfile] = useState({
    firstName: "",
    lastName: "",
  });

  // Parse full_name into first and last name on mount
  useEffect(() => {
    if (fullName) {
      const parts = fullName.trim().split(" ");
      if (parts.length >= 2) {
        // First name is first word, last name is everything else
        setProfile({
          firstName: parts[0],
          lastName: parts.slice(1).join(" "),
        });
      } else if (parts.length === 1) {
        setProfile({
          firstName: parts[0],
          lastName: "",
        });
      }
    }
  }, [fullName]);

  // Password change state
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  // Handle profile update
  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileLoading(true);

    try {
      // Combine first and last name
      const newFullName = `${profile.firstName.trim()} ${profile.lastName.trim()}`.trim();

      if (!newFullName) {
        toast.error("Please enter your name");
        setProfileLoading(false);
        return;
      }

      // Update users table
      const { error } = await supabase
        .from("users")
        .update({ full_name: newFullName })
        .eq("id", user?.id);

      if (error) {
        console.error("Error updating profile:", error);
        toast.error(error.message || "Failed to update profile");
      } else {
        toast.success("Profile updated successfully");
        // Refresh to show updated name in sidebar
        router.refresh();
      }
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setProfileLoading(false);
    }
  };

  // Handle password change
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordLoading(true);

    // Validate current password is provided
    if (!passwords.currentPassword) {
      toast.error("Please enter your current password");
      setPasswordLoading(false);
      return;
    }

    // Validate passwords match
    if (passwords.newPassword !== passwords.confirmPassword) {
      toast.error("New passwords do not match");
      setPasswordLoading(false);
      return;
    }

    // Validate password length
    if (passwords.newPassword.length < 6) {
      toast.error("New password must be at least 6 characters");
      setPasswordLoading(false);
      return;
    }

    try {
      // First, verify current password by re-authenticating
      // Supabase requires signing in with current password to verify
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user?.email || "",
        password: passwords.currentPassword,
      });

      if (signInError) {
        toast.error("Current password is incorrect");
        setPasswordLoading(false);
        return;
      }

      // Now update to new password
      const { error } = await supabase.auth.updateUser({
        password: passwords.newPassword,
      });

      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Password updated successfully");
        setPasswords({
          currentPassword: "",
          newPassword: "",
          confirmPassword: "",
        });
      }
    } catch (err) {
      console.error("Error updating password:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Profile Form */}
      <form onSubmit={handleProfileUpdate} className="space-y-4">
        <h3 className="text-lg font-medium">Personal Information</h3>

        {/* Name Fields - side by side on larger screens */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName">First Name</Label>
            <Input
              id="firstName"
              value={profile.firstName}
              onChange={(e) =>
                setProfile((prev) => ({ ...prev, firstName: e.target.value }))
              }
              placeholder="John"
              className="min-h-[44px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="lastName">Last Name</Label>
            <Input
              id="lastName"
              value={profile.lastName}
              onChange={(e) =>
                setProfile((prev) => ({ ...prev, lastName: e.target.value }))
              }
              placeholder="Smith"
              className="min-h-[44px]"
            />
          </div>
        </div>

        {/* Email (read-only) */}
        <div className="space-y-2">
          <Label>Email Address</Label>
          <Input value={user?.email || ""} disabled className="min-h-[44px]" />
          <p className="text-xs text-muted-foreground">
            Contact an administrator to change your email
          </p>
        </div>

        <Button type="submit" disabled={profileLoading} className="min-h-[44px]">
          {profileLoading ? "Saving..." : "Save Profile"}
        </Button>
      </form>

      <Separator />

      {/* Password Change Form */}
      <form onSubmit={handlePasswordChange} className="space-y-4">
        <h3 className="text-lg font-medium">Change Password</h3>
        <p className="text-sm text-muted-foreground">
          Enter your current password to verify your identity
        </p>

        <div className="space-y-2">
          <Label htmlFor="currentPassword">Current Password</Label>
          <Input
            id="currentPassword"
            type="password"
            value={passwords.currentPassword}
            onChange={(e) =>
              setPasswords((prev) => ({ ...prev, currentPassword: e.target.value }))
            }
            placeholder="Enter current password"
            className="min-h-[44px]"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="newPassword">New Password</Label>
          <Input
            id="newPassword"
            type="password"
            value={passwords.newPassword}
            onChange={(e) =>
              setPasswords((prev) => ({ ...prev, newPassword: e.target.value }))
            }
            placeholder="Enter new password"
            className="min-h-[44px]"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm New Password</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={passwords.confirmPassword}
            onChange={(e) =>
              setPasswords((prev) => ({
                ...prev,
                confirmPassword: e.target.value,
              }))
            }
            placeholder="Confirm new password"
            className="min-h-[44px]"
            required
          />
        </div>

        <Button type="submit" disabled={passwordLoading} className="min-h-[44px]">
          {passwordLoading ? "Updating..." : "Update Password"}
        </Button>
      </form>
    </div>
  );
}
