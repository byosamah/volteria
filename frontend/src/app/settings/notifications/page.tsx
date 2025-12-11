"use client";

/**
 * Notification Preferences Page
 *
 * Allows users to configure how they receive notifications:
 * - Email notifications (critical, warning, daily summary)
 * - In-app notifications
 * - Quiet hours settings
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import Link from "next/link";

// Notification preferences type
interface NotificationPreferences {
  id: string;
  user_id: string;
  email_enabled: boolean;
  email_critical: boolean;
  email_warning: boolean;
  email_info: boolean;
  email_daily_summary: boolean;
  in_app_enabled: boolean;
  in_app_sound: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

// Default preferences for new users
const defaultPreferences: Omit<NotificationPreferences, "id" | "user_id"> = {
  email_enabled: true,
  email_critical: true,
  email_warning: false,
  email_info: false,
  email_daily_summary: false,
  in_app_enabled: true,
  in_app_sound: true,
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
};

export default function NotificationPreferencesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState<{ id: string; email?: string; full_name?: string; avatar_url?: string; role?: string } | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);

  // Load user and preferences
  useEffect(() => {
    const loadData = async () => {
      const supabase = createClient();

      // Get current user
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        router.push("/login");
        return;
      }

      // Get user profile
      const { data: profile } = await supabase
        .from("users")
        .select("full_name, avatar_url, role")
        .eq("id", authUser.id)
        .single();

      setUser({
        id: authUser.id,
        email: authUser.email,
        full_name: profile?.full_name,
        avatar_url: profile?.avatar_url,
        role: profile?.role,
      });

      // Get notification preferences
      const { data: prefs, error } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", authUser.id)
        .single();

      if (error && error.code !== "PGRST116") {
        // PGRST116 = no rows returned (which is fine, we'll use defaults)
        console.error("Error loading preferences:", error);
      }

      if (prefs) {
        setPreferences(prefs);
      } else {
        // Create default preferences object (not saved yet)
        setPreferences({
          id: "",
          user_id: authUser.id,
          ...defaultPreferences,
        });
      }

      setLoading(false);
    };

    loadData();
  }, [router]);

  // Save preferences
  const handleSave = async () => {
    if (!preferences || !user) return;
    setSaving(true);

    const supabase = createClient();

    // Prepare data for upsert
    const prefsData = {
      user_id: user.id,
      email_enabled: preferences.email_enabled,
      email_critical: preferences.email_critical,
      email_warning: preferences.email_warning,
      email_info: preferences.email_info,
      email_daily_summary: preferences.email_daily_summary,
      in_app_enabled: preferences.in_app_enabled,
      in_app_sound: preferences.in_app_sound,
      quiet_hours_enabled: preferences.quiet_hours_enabled,
      quiet_hours_start: preferences.quiet_hours_start,
      quiet_hours_end: preferences.quiet_hours_end,
    };

    const { error } = await supabase
      .from("notification_preferences")
      .upsert(prefsData, { onConflict: "user_id" });

    if (error) {
      console.error("Error saving preferences:", error);
      toast.error("Failed to save preferences");
    } else {
      toast.success("Notification preferences saved");
    }

    setSaving(false);
  };

  // Update a single preference field
  const updatePreference = <K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K]
  ) => {
    if (!preferences) return;
    setPreferences({ ...preferences, [key]: value });
  };

  if (loading) {
    return (
      <DashboardLayout user={{}}>
        <div className="p-4 md:p-6 flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout user={{
      email: user?.email,
      full_name: user?.full_name || undefined,
      avatar_url: user?.avatar_url || undefined,
      role: user?.role || undefined,
    }}>
      <div className="p-4 md:p-6 space-y-6 max-w-2xl">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Link
              href="/settings"
              className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </Link>
            <h1 className="text-2xl md:text-3xl font-bold">Notification Preferences</h1>
          </div>
          <p className="text-muted-foreground">
            Configure how you receive alerts and notifications
          </p>
        </div>

        {/* Email Notifications Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
              Email Notifications
            </CardTitle>
            <CardDescription>
              Receive important alerts via email
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Master Email Toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="email_enabled">Enable Email Notifications</Label>
                <p className="text-sm text-muted-foreground">
                  Receive notifications via email
                </p>
              </div>
              <Switch
                id="email_enabled"
                checked={preferences?.email_enabled || false}
                onCheckedChange={(checked) => updatePreference("email_enabled", checked)}
              />
            </div>

            {/* Email Options (disabled if master toggle is off) */}
            <div className={`space-y-4 pl-4 border-l-2 ${preferences?.email_enabled ? "border-primary" : "border-muted opacity-50"}`}>
              {/* Critical Alarms */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="email_critical">Critical Alarms</Label>
                  <p className="text-sm text-muted-foreground">
                    Device failures, communication loss, safe mode triggers
                  </p>
                </div>
                <Switch
                  id="email_critical"
                  checked={preferences?.email_critical || false}
                  onCheckedChange={(checked) => updatePreference("email_critical", checked)}
                  disabled={!preferences?.email_enabled}
                />
              </div>

              {/* Warning Alarms */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="email_warning">Warning Alarms</Label>
                  <p className="text-sm text-muted-foreground">
                    Performance issues, threshold warnings
                  </p>
                </div>
                <Switch
                  id="email_warning"
                  checked={preferences?.email_warning || false}
                  onCheckedChange={(checked) => updatePreference("email_warning", checked)}
                  disabled={!preferences?.email_enabled}
                />
              </div>

              {/* Daily Summary */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="email_daily_summary">Daily Summary</Label>
                  <p className="text-sm text-muted-foreground">
                    Receive a daily digest of system activity
                  </p>
                </div>
                <Switch
                  id="email_daily_summary"
                  checked={preferences?.email_daily_summary || false}
                  onCheckedChange={(checked) => updatePreference("email_daily_summary", checked)}
                  disabled={!preferences?.email_enabled}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* In-App Notifications Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
              In-App Notifications
            </CardTitle>
            <CardDescription>
              Notifications displayed in the app
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* In-App Toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="in_app_enabled">Enable In-App Notifications</Label>
                <p className="text-sm text-muted-foreground">
                  Show notifications in the notification bell
                </p>
              </div>
              <Switch
                id="in_app_enabled"
                checked={preferences?.in_app_enabled || false}
                onCheckedChange={(checked) => updatePreference("in_app_enabled", checked)}
              />
            </div>

            {/* Sound Toggle */}
            <div className={`flex items-center justify-between pl-4 border-l-2 ${preferences?.in_app_enabled ? "border-primary" : "border-muted opacity-50"}`}>
              <div className="space-y-0.5">
                <Label htmlFor="in_app_sound">Notification Sound</Label>
                <p className="text-sm text-muted-foreground">
                  Play a sound for new notifications
                </p>
              </div>
              <Switch
                id="in_app_sound"
                checked={preferences?.in_app_sound || false}
                onCheckedChange={(checked) => updatePreference("in_app_sound", checked)}
                disabled={!preferences?.in_app_enabled}
              />
            </div>
          </CardContent>
        </Card>

        {/* Quiet Hours Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
              Quiet Hours
            </CardTitle>
            <CardDescription>
              Don&apos;t disturb during specific hours
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Quiet Hours Toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="quiet_hours_enabled">Enable Quiet Hours</Label>
                <p className="text-sm text-muted-foreground">
                  Pause non-critical notifications during set hours
                </p>
              </div>
              <Switch
                id="quiet_hours_enabled"
                checked={preferences?.quiet_hours_enabled || false}
                onCheckedChange={(checked) => updatePreference("quiet_hours_enabled", checked)}
              />
            </div>

            {/* Time Inputs */}
            <div className={`grid grid-cols-2 gap-4 pl-4 border-l-2 ${preferences?.quiet_hours_enabled ? "border-primary" : "border-muted opacity-50"}`}>
              <div className="space-y-2">
                <Label htmlFor="quiet_hours_start">Start Time</Label>
                <Input
                  id="quiet_hours_start"
                  type="time"
                  value={preferences?.quiet_hours_start || "22:00"}
                  onChange={(e) => updatePreference("quiet_hours_start", e.target.value)}
                  disabled={!preferences?.quiet_hours_enabled}
                  className="min-h-[44px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quiet_hours_end">End Time</Label>
                <Input
                  id="quiet_hours_end"
                  type="time"
                  value={preferences?.quiet_hours_end || "07:00"}
                  onChange={(e) => updatePreference("quiet_hours_end", e.target.value)}
                  disabled={!preferences?.quiet_hours_enabled}
                  className="min-h-[44px]"
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Note: Critical alarms will always be sent regardless of quiet hours.
            </p>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="min-h-[44px] w-full sm:w-auto"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Saving...
              </>
            ) : (
              "Save Preferences"
            )}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
