"use client";

/**
 * Account Settings Form
 *
 * Allows users to update their profile and password.
 * Includes:
 * - First name / Last name fields
 * - Password change with current password verification
 */

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { User } from "@supabase/supabase-js";

interface AccountSettingsFormProps {
  user: User | null;
  fullName: string;
  avatarUrl?: string | null;
}

export function AccountSettingsForm({ user, fullName, avatarUrl }: AccountSettingsFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Avatar state
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState(avatarUrl || "");

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

  // Handle avatar upload
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Please upload a JPEG, PNG, GIF, or WebP image");
      return;
    }

    // Validate file size (2MB max)
    const maxSize = 2 * 1024 * 1024; // 2MB
    if (file.size > maxSize) {
      toast.error("Image must be smaller than 2MB");
      return;
    }

    setAvatarLoading(true);

    try {
      // Generate unique filename
      const fileExt = file.name.split(".").pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(fileName, file, {
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadError) {
        console.error("Error uploading avatar:", uploadError);
        toast.error("Failed to upload image. Please try again.");
        setAvatarLoading(false);
        return;
      }

      // Get public URL
      const { data: publicUrlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(fileName);

      const newAvatarUrl = publicUrlData.publicUrl;

      // Update user record with avatar URL
      const { error: updateError } = await supabase
        .from("users")
        .update({ avatar_url: newAvatarUrl })
        .eq("id", user.id);

      if (updateError) {
        console.error("Error updating avatar URL:", updateError);
        toast.error("Failed to update profile picture");
        setAvatarLoading(false);
        return;
      }

      setCurrentAvatarUrl(newAvatarUrl);
      toast.success("Profile picture updated!");
      router.refresh();
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setAvatarLoading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Get user initials for avatar fallback
  const userInitials = fullName
    ? fullName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : user?.email?.charAt(0).toUpperCase() || "U";

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
      {/* Avatar Upload Section */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Profile Picture</h3>
        <div className="flex items-center gap-6">
          {/* Avatar Preview */}
          <Avatar className="h-24 w-24">
            <AvatarImage src={currentAvatarUrl} alt="Profile picture" />
            <AvatarFallback className="text-2xl bg-primary text-primary-foreground">
              {userInitials}
            </AvatarFallback>
          </Avatar>

          <div className="space-y-2">
            {/* Hidden file input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleAvatarUpload}
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
            />

            {/* Upload button */}
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarLoading}
              className="min-h-[44px]"
            >
              {avatarLoading ? (
                <>
                  <svg
                    className="animate-spin -ml-1 mr-2 h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Uploading...
                </>
              ) : (
                <>
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
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" x2="12" y1="3" y2="15" />
                  </svg>
                  Upload Photo
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground">
              JPEG, PNG, GIF, or WebP. Max 2MB.
            </p>
          </div>
        </div>
      </div>

      <Separator />

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
